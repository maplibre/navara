import { type Events } from "@navaramap/engine";

import { generate_id_from_entity, isEntityEvent } from "../id";

import { TransactionManager } from "./TransactionManager";

// The WASM `Events` class exposes each stack only through a move-out
// `take_<key>()` method (reading a getter would deep-clone the array and every
// element). Stack keys and value types are derived from those methods.
export type JsEvents = {
  [
    K in keyof Events as K extends `take_${infer P}` ? P : never
  ]: Events[K] extends (...args: never[]) => infer R ? R : never;
};
export type JsEventsKey = keyof JsEvents;

type EventsStacks = {
  [K in JsEventsKey]-?: JsEvents[K] extends unknown[]
    ? JsEvents[K]
    : JsEvents[K][];
};

type GetJsEventValue<K extends JsEventsKey> = EventsStacks[K] extends unknown[]
  ? EventsStacks[K][number]
  : EventsStacks[K];

type TransactionProcessOption<
  AddKey extends JsEventsKey,
  RemoveKey extends JsEventsKey,
  ChangeKey extends JsEventsKey,
> = {
  add: {
    key: AddKey;
    max?: number;
    /** Dispatch order for the pending stack. Events a `shouldProcess` gate
     * leaves behind are re-sorted against newer ones every pass, so this turns
     * the FIFO stack into a priority queue (stable: equal keys stay FIFO). */
    order?: (a: GetJsEventValue<AddKey>, b: GetJsEventValue<AddKey>) => number;
  };
  remove: {
    key: RemoveKey;
    max?: number;
  };
  change?: {
    key: ChangeKey;
    max?: number;
  };
};

type TransactionCallbackParams<
  AddKey extends JsEventsKey,
  RemoveKey extends JsEventsKey,
  ChangeKey extends JsEventsKey,
> =
  | { type: "add"; event: GetJsEventValue<AddKey> }
  | { type: "remove"; event: GetJsEventValue<RemoveKey> }
  | { type: "change"; event: GetJsEventValue<ChangeKey> };

const maybeFree = (ev: object | undefined) => {
  if (ev && "free" in ev && ev.free instanceof Function) {
    ev.free();
  }
};

const defaultGenerateEventId = <
  AddKey extends JsEventsKey,
  RemoveKey extends JsEventsKey,
  ChangeKey extends JsEventsKey,
>(
  ev: TransactionCallbackParams<AddKey, RemoveKey, ChangeKey>,
) => {
  const { event } = ev;

  if (!isEntityEvent(event)) {
    return;
  }
  const id = generate_id_from_entity(event);
  return id;
};

export class EventManager {
  stacks: EventsStacks = {
    camera_transform_updated: [],
    camera_frustum_updated: [],
    camera_flight_ended: [],
    data_requested: [],
    data_requester_removed: [],
    mesh_added: [],
    mesh_updated: [],
    mesh_geometry_replaced: [],
    mesh_removed: [],
    object_transform_updated: [],
    renderable_feature_added: [],
    renderable_feature_changed: [],
    renderable_feature_removed: [],
    texture_fragment_removed: [],
    texture_fragment_requested: [],
    update_sample_terrain_height: [],
    worker_task_delegated: [],
    worker_task_removed: [],
    hillshade_backfilled: [],
    hillshade_canceled: [],
  };
  // In-flight "add" event ids per transaction key, used to abort adds whose
  // matching remove arrives while they are still pending. Keyed by transaction
  // so one transaction's remove phase cannot wipe another's tracking.
  addedEventIds = new Map<string, Set<unknown>>();
  // Length of each stack's already-sorted prefix (see `sortPending`).
  private sortedLengths: Partial<Record<JsEventsKey, number>> = {};
  private transactionManager = new TransactionManager();

  needsUpdate() {
    return Object.values(this.stacks).some((v) => !!v.length);
  }

  pushEvents(events: Events | undefined) {
    if (!events) return;
    for (const k of Object.keys(this.stacks) as JsEventsKey[]) {
      // Move the stack out of WASM instead of reading a cloning getter.
      const take = events[`take_${k}` as keyof Events] as unknown as (
        this: Events,
      ) => JsEvents[JsEventsKey];
      const event = take.call(events);
      if (!event) continue;
      if (Array.isArray(event)) {
        (this.stacks[k] as unknown[]).push(...event);
      } else {
        (this.stacks[k] as unknown[]).push(event);
      }
    }
  }

  forEachStack<Key extends JsEventsKey>(
    key: Key,
    cb: (value: GetJsEventValue<Key>) => void,
    max = 100,
  ) {
    let idx = 0;
    for (const value of this.stacks[key]) {
      if (idx === max) {
        break;
      }

      cb(value as GetJsEventValue<Key>);

      maybeFree(value);

      idx++;
    }

    // Remove processed events
    this.stacks[key].splice(0, idx);
    const sorted = this.sortedLengths[key];
    if (sorted !== undefined) {
      this.sortedLengths[key] = Math.max(0, sorted - idx);
    }
  }

  /** Order the stack for dispatch. Pushes only append, so only the events
   * added since the last pass are sorted and merged into the already sorted
   * prefix (the prefix wins ties, keeping equal keys FIFO). */
  private sortPending<Key extends JsEventsKey>(
    key: Key,
    order: (a: GetJsEventValue<Key>, b: GetJsEventValue<Key>) => number,
  ) {
    const stack = this.stacks[key] as GetJsEventValue<Key>[];
    const sortedLength = Math.min(this.sortedLengths[key] ?? 0, stack.length);
    if (sortedLength < stack.length) {
      const added = stack.splice(sortedLength).sort(order);
      const merged: GetJsEventValue<Key>[] = [];
      let i = 0;
      let j = 0;
      while (i < stack.length && j < added.length) {
        merged.push(order(stack[i], added[j]) <= 0 ? stack[i++] : added[j++]);
      }
      for (; i < stack.length; i++) merged.push(stack[i]);
      for (; j < added.length; j++) merged.push(added[j]);
      this.stacks[key] = merged as EventsStacks[Key];
    }
    this.sortedLengths[key] = this.stacks[key].length;
  }

  private removeAt(key: JsEventsKey, index: number) {
    this.stacks[key].splice(index, 1);
    const sorted = this.sortedLengths[key];
    if (sorted !== undefined && index < sorted) {
      this.sortedLengths[key] = sorted - 1;
    }
  }

  async forEachStackAsync<Key extends JsEventsKey>(
    key: Key,
    cb: (value: GetJsEventValue<Key>) => Promise<void>,
    max = 100,
    shouldProcess?: (value: GetJsEventValue<Key>) => boolean,
    order?: (a: GetJsEventValue<Key>, b: GetJsEventValue<Key>) => number,
  ) {
    const promises = [];

    if (order) {
      this.sortPending(key, order);
    }

    let idx = 0;
    const removedIndices = [];
    for (const value of this.stacks[key]) {
      if (idx === max) {
        break;
      }

      const v = value as GetJsEventValue<Key>;

      if (shouldProcess && !shouldProcess(v)) {
        idx++;
        continue;
      }

      promises.push(cb(v));

      removedIndices.push(idx);

      idx++;
    }

    const removedEvs = [];

    let offset = 0;
    for (const idx of removedIndices) {
      // Remove processed events
      const i = idx - offset;
      removedEvs.push(this.stacks[key][i]);
      this.removeAt(key, i);
      offset++;
    }

    // A single failing handler must not reject the whole batch: the other
    // handlers' results still count and the processed events below must be
    // freed exactly once regardless.
    const settled = await Promise.allSettled(promises);
    for (const s of settled) {
      if (s.status === "rejected") {
        console.error(`Event handler for "${key}" failed:`, s.reason);
      }
    }

    for (const e of removedEvs) {
      maybeFree(e);
    }
  }

  // Remove duplicated events before it's proceeded.
  // For example, if MeshAdd event and MeshRemove event are exist, it should be considered as duplicated.
  removeDuplicatedTransactionEvents<
    AddKey extends JsEventsKey,
    RemoveKey extends JsEventsKey,
    ChangeKey extends JsEventsKey,
  >(options: TransactionProcessOption<AddKey, RemoveKey, ChangeKey>) {
    const addedEventsMap = new Map<string, number>();
    const changedEventsMap = options.change ? new Map<string, number>() : null;

    this.stacks[options.add.key].forEach((added, index) => {
      if (isEntityEvent(added)) {
        const id = generate_id_from_entity(added);
        addedEventsMap.set(id, index);
      }
    });

    if (changedEventsMap && options.change) {
      this.stacks[options.change.key].forEach((changed, index) => {
        if (isEntityEvent(changed)) {
          const id = generate_id_from_entity(changed);
          changedEventsMap.set(id, index);
        }
      });
    }

    // Track indices to remove from each stack
    const addedIndicesToRemove = new Set<number>();
    const changedIndicesToRemove = new Set<number>();
    const removedIndicesToSkip = new Set<number>();

    this.stacks[options.remove.key].forEach((removed, removeIdx) => {
      if (!isEntityEvent(removed)) return;

      const removedId = generate_id_from_entity(removed);

      const addedIdx = addedEventsMap.get(removedId);
      let foundMatch = false;

      if (addedIdx !== undefined) {
        addedIndicesToRemove.add(addedIdx);
        foundMatch = true;
      }

      if (changedEventsMap && options.change) {
        const changedIdx = changedEventsMap.get(removedId);
        if (changedIdx !== undefined) {
          changedIndicesToRemove.add(changedIdx);
        }
      }

      if (foundMatch) {
        removedIndicesToSkip.add(removeIdx);
      }
    });

    if (addedIndicesToRemove.size > 0) {
      this.removeStacksByIndices(options.add.key, addedIndicesToRemove);
    }

    if (changedIndicesToRemove.size > 0 && options.change) {
      this.removeStacksByIndices(options.change.key, changedIndicesToRemove);
    }

    if (removedIndicesToSkip.size > 0) {
      this.removeStacksByIndices(options.remove.key, removedIndicesToSkip);
    }
  }

  removeStacksByIndices(key: JsEventsKey, removedIndices: Set<number>) {
    const sortedIndices = [...removedIndices].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      maybeFree(this.stacks[key][idx]);
      this.removeAt(key, idx);
    }
  }

  processTransactionEvents<
    AddKey extends JsEventsKey,
    RemoveKey extends JsEventsKey,
    ChangeKey extends JsEventsKey,
  >(
    transactionKey: string,
    options: TransactionProcessOption<AddKey, RemoveKey, ChangeKey>,
    cb: (
      ev: TransactionCallbackParams<AddKey, RemoveKey, ChangeKey>,
    ) => Promise<void>,
    handlers?: {
      shouldProcess?: (
        ev: TransactionCallbackParams<AddKey, RemoveKey, ChangeKey>,
      ) => boolean;
      generateEventId?: (
        ev: TransactionCallbackParams<AddKey, RemoveKey, ChangeKey>,
      ) => string;
      onAbort?: (ev: GetJsEventValue<RemoveKey>) => void | Promise<void>;
    },
  ) {
    const {
      shouldProcess,
      generateEventId = defaultGenerateEventId,
      onAbort,
    } = handlers ?? {};

    this.removeDuplicatedTransactionEvents(options);

    const addedEventIds = this.addedEventIds.get(transactionKey) ?? new Set();
    this.addedEventIds.set(transactionKey, addedEventIds);

    const transaction = this.transactionManager
      .getOrInsert(transactionKey)
      .then(() =>
        this.forEachStackAsync(
          options.add.key,
          (event) => {
            if (onAbort) {
              addedEventIds.add(generateEventId({ type: "add", event }));
            }
            return cb({ type: "add", event });
          },
          options.add.max,
          shouldProcess
            ? (event) => shouldProcess({ type: "add", event })
            : undefined,
          options.add.order,
        ),
      )
      .then(() => {
        if (onAbort) {
          addedEventIds.clear();
        }
        return this.forEachStackAsync(
          options.remove.key,
          (event) => cb({ type: "remove", event }),
          options.remove.max,
          shouldProcess
            ? (event) => shouldProcess({ type: "remove", event })
            : undefined,
        );
      });

    // Handle an abort process to an add event.
    if (onAbort && addedEventIds.size) {
      for (const event of this.stacks[options.remove.key]) {
        if (!event) continue;
        const removeEv = event as GetJsEventValue<RemoveKey>;
        const id = generateEventId({ type: "remove", event: removeEv });
        if (id && addedEventIds.has(id)) {
          // Contain both sync throws and async rejections: an abort handler
          // failure must not escape into the caller (or become an unhandled
          // rejection) and must not stop the remaining aborts.
          try {
            Promise.resolve(onAbort(removeEv)).catch((err) => {
              console.error(
                `onAbort handler for "${transactionKey}" failed:`,
                err,
              );
            });
          } catch (err) {
            console.error(
              `onAbort handler for "${transactionKey}" failed:`,
              err,
            );
          }
          addedEventIds.delete(id);
        }
      }
    }

    if (options.change) {
      const change = options.change;
      transaction
        .then(() =>
          this.forEachStackAsync(
            change.key,
            (event) => cb({ type: "change", event }),
            change.max,
            shouldProcess
              ? (event) => shouldProcess({ type: "change", event })
              : undefined,
          ),
        )
        .end();
    } else {
      transaction.end();
    }
  }
}
