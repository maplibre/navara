import { type Events } from "@navaramap/engine";

import { generate_id_from_entity, isEntityEvent } from "../id";

// The WASM `Events` class exposes each stack only through a move-out
// `take_<key>()` method (reading a getter would deep-clone the array and every
// element). Stack keys and value types are derived from those methods.
export type JsEvents = {
  [
    K in keyof Events as K extends `take_${infer P}` ? P : never
  ]: Events[K] extends (...args: never[]) => infer R ? R : never;
};
export type JsEventsKey = keyof JsEvents;

/** One element of a stack (the value itself for the `Option` stacks). */
export type JsEventValue<K extends JsEventsKey> = JsEvents[K] extends unknown[]
  ? JsEvents[K][number]
  : JsEvents[K];

/**
 * One kind of frontend job: the engine emits `requested` when it wants the
 * frontend to run async work for an entity (fetch, worker task, mesh build),
 * `changed` while the entity is alive, and `removed` when the entity is
 * despawned — unconditionally, including while the job is still in flight.
 *
 * The dispatcher turns these into calls on this handler and owns the job
 * table; the handler never sees ordering, dedupe or abort bookkeeping.
 */
export type JobHandler<Req, Chg, Rem, Product> = {
  /** Used in error logs only. */
  name: string;
  events: {
    requested: JsEventsKey;
    changed?: JsEventsKey;
    removed: JsEventsKey;
  };
  /**
   * Called right away for every admitted `requested` event. After each
   * `await`, check `abort.signal.aborted` before touching shared state or
   * reporting to the engine: a removed job must not report. Resolving
   * `undefined` means "done, no product" (an empty geometry, a fetch whose
   * result went straight into the buffer store, ...); the job is then
   * forgotten, like one whose `start` failed.
   */
  start(ev: Req, abort: AbortController): Promise<Product | undefined>;
  /**
   * Applies a `changed` snapshot to a live product. Calls on one job never
   * overlap: a change arriving while `start` or a previous change is in
   * flight waits, and only the latest waiting one is applied.
   */
  change?(product: Product, ev: Chg): void | Promise<void>;
  /**
   * Called exactly once per `removed` event, when nothing is in flight for
   * the job any more: immediately for a live or unknown job (`product` is
   * `undefined` for an unknown one or one whose `start` failed), or once the
   * aborted `start` / `change` settles. The job's abort signal has fired by
   * then, so continuations still running after `start` see the removal.
   * `ev` is `undefined` only when the dispatcher itself is disposed while
   * the job is in flight.
   */
  teardown(product: Product | undefined, ev: Rem | undefined): void;
  /** Reports a rejected / thrown `start` to the engine (kind specific); a
   * kind without it gets the error logged instead. Not called once the job
   * was removed or the dispatcher disposed; an abort the handler fires on
   * its own still reports. */
  failed?(ev: Req, error: unknown): void;
};

type Job = {
  abort: AbortController;
  product?: unknown;
  /** Whether `start` or a `change` is outstanding; at most one is. */
  inFlight: boolean;
  /** The `removed` event that arrived while something was in flight. Kept
   * alive (not freed) until `teardown` has consumed it. */
  removedEv?: object;
  /** Latest `changed` event received while something was in flight. */
  pendingChange?: object;
};

type Registered = {
  handler: JobHandler<unknown, unknown, unknown, unknown>;
  jobs: Map<string, Job>;
  /** Jobs of this kind with a call outstanding. */
  inFlight: number;
};

/** A registered kind, as returned by {@link JobDispatcher.register}. */
export type RegisteredJobKind = {
  /** Jobs of this kind whose `start` or `change` has not settled yet. */
  inFlight(): number;
};

type SyncHandler = { key: JsEventsKey; handle: (ev: unknown) => void };

export type JobDispatcherOptions = {
  /** Called whenever a job's `start` settles with a product, i.e. something
   * new is on screen. */
  onSettled?: () => void;
};

const maybeFree = (ev: unknown) => {
  if (
    ev &&
    typeof ev === "object" &&
    "free" in ev &&
    typeof ev.free === "function"
  ) {
    ev.free();
  }
};

const isThenable = (v: unknown): v is Promise<void> =>
  typeof (v as { then?: unknown } | undefined)?.then === "function";

const idOf = (ev: unknown): string | undefined =>
  isEntityEvent(ev) ? generate_id_from_entity(ev) : undefined;

const takeStack = <K extends JsEventsKey>(
  events: Events,
  key: K,
): (JsEventValue<K> & object)[] => {
  const take = events[`take_${key}` as keyof Events] as unknown as (
    this: Events,
  ) => JsEvents[K];
  const taken = take.call(events);
  if (taken === undefined || taken === null) return [];
  return (Array.isArray(taken) ? taken : [taken]) as (JsEventValue<K> &
    object)[];
};

/**
 * Consumes the per-frame engine events and dispatches them to the registered
 * handlers with no queueing: every `requested` starts its job in the same
 * tick (admission and priority are the engine's job), every `removed` aborts
 * or tears down, every `changed` applies or waits for the in-flight `start`.
 * Taken WASM event objects are freed here, once the handler that received
 * them has settled, so handlers never call `free()` on an event.
 */
export class JobDispatcher {
  private readonly sync: SyncHandler[] = [];
  private readonly registered: Registered[] = [];
  private readonly onSettled?: () => void;
  private disposed = false;
  private inFlightJobs = 0;

  constructor(options?: JobDispatcherOptions) {
    this.onSettled = options?.onSettled;
  }

  register<Req, Chg, Rem, Product>(
    handler: JobHandler<Req, Chg, Rem, Product>,
  ): RegisteredJobKind {
    const r: Registered = {
      handler: handler as JobHandler<unknown, unknown, unknown, unknown>,
      jobs: new Map(),
      inFlight: 0,
    };
    this.registered.push(r);
    return { inFlight: () => r.inFlight };
  }

  /** A synchronous, stateless handler; events are freed right after it. */
  registerSync<K extends JsEventsKey>(
    key: K,
    handle: (ev: JsEventValue<K>) => void,
  ) {
    this.sync.push({ key, handle: handle as (ev: unknown) => void });
  }

  /** Jobs whose `start` or `change` has not settled yet. */
  inFlight(): number {
    return this.inFlightJobs;
  }

  /** Per-kind job counts, for debug tooling. `name` is the handler's name. */
  stats(): { name: string; jobs: number; inFlight: number }[] {
    return this.registered.map((r) => ({
      name: r.handler.name,
      jobs: r.jobs.size,
      inFlight: r.inFlight,
    }));
  }

  tick(events: Events | undefined) {
    if (!events || this.disposed) return;

    for (const { key, handle } of this.sync) {
      for (const ev of takeStack(events, key)) {
        try {
          handle(ev);
        } catch (error) {
          console.error(`Event handler for "${key}" failed:`, error);
        } finally {
          maybeFree(ev);
        }
      }
    }

    for (const r of this.registered) {
      const { events: keys } = r.handler;
      const removed = takeStack(events, keys.removed);
      const requested = takeStack(events, keys.requested);
      const changed = keys.changed ? takeStack(events, keys.changed) : [];

      // An add and a remove of the same entity in one frame cancel out.
      const removedIds = new Set<string>();
      for (const ev of removed) {
        const id = idOf(ev);
        if (id !== undefined) removedIds.add(id);
      }

      for (const ev of requested) {
        const id = idOf(ev);
        if (id === undefined || removedIds.has(id) || r.jobs.has(id)) {
          maybeFree(ev);
          continue;
        }
        this.start(r, id, ev);
      }
      for (const ev of removed) {
        this.remove(r, idOf(ev), ev);
      }
      for (const ev of changed) {
        this.change(r, idOf(ev), ev);
      }
    }
  }

  /** Aborts every in-flight job and forgets the table. Live products are the
   * owner's to dispose (they are indexed outside the dispatcher). */
  dispose() {
    this.disposed = true;
    for (const r of this.registered) {
      for (const job of r.jobs.values()) {
        job.abort.abort();
      }
      r.jobs.clear();
      r.inFlight = 0;
    }
    this.inFlightJobs = 0;
  }

  private start(r: Registered, id: string, ev: object) {
    const job: Job = {
      abort: new AbortController(),
      inFlight: true,
    };
    this.inFlightJobs++;
    r.inFlight++;
    r.jobs.set(id, job);

    let promise: Promise<unknown>;
    try {
      promise = Promise.resolve(r.handler.start(ev, job.abort));
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (product) => {
        job.product = product;
        this.settleStart(r, id, job, ev);
      },
      (error) => {
        // A kind with a `failed` hook treats failures as routine (a 404 tile
        // is reported to the engine, not logged); only unexpected ones log.
        if (job.removedEv === undefined && !this.disposed) {
          if (r.handler.failed) {
            try {
              r.handler.failed(ev, error);
            } catch (e) {
              console.error(`Job "${r.handler.name}" failed handler threw:`, e);
            }
          } else {
            console.error(`Job "${r.handler.name}" failed to start:`, error);
          }
        }
        this.settleStart(r, id, job, ev);
      },
    );
  }

  private settleStart(r: Registered, id: string, job: Job, ev: object) {
    maybeFree(ev);
    const product = job.product;
    if (this.finish(r, id, job)) return;
    if (product !== undefined) this.onSettled?.();
  }

  private remove(r: Registered, id: string | undefined, ev: object) {
    const job = id === undefined ? undefined : r.jobs.get(id);
    if (!job) {
      this.teardown(r, undefined, ev);
      maybeFree(ev);
      return;
    }
    job.abort.abort();
    if (job.inFlight) {
      maybeFree(job.removedEv);
      job.removedEv = ev;
      return;
    }
    r.jobs.delete(id as string);
    this.teardown(r, job.product, ev);
    maybeFree(ev);
  }

  private change(r: Registered, id: string | undefined, ev: object) {
    const job = id === undefined ? undefined : r.jobs.get(id);
    if (!job || !r.handler.change || job.removedEv !== undefined) {
      maybeFree(ev);
      return;
    }
    if (job.inFlight) {
      maybeFree(job.pendingChange);
      job.pendingChange = ev;
      return;
    }
    if (job.product === undefined) {
      maybeFree(ev);
      return;
    }
    this.applyChange(r, id as string, job, ev);
  }

  private applyChange(r: Registered, id: string, job: Job, ev: object) {
    let result: void | Promise<void>;
    try {
      result = r.handler.change?.(job.product, ev);
    } catch (error) {
      console.error(`Job "${r.handler.name}" failed to change:`, error);
      maybeFree(ev);
      return;
    }
    // A synchronous change (a uniform or material update, the bulk case) is
    // settled here; only one that returned a promise holds the job in flight.
    if (!isThenable(result)) {
      maybeFree(ev);
      return;
    }
    job.inFlight = true;
    this.inFlightJobs++;
    r.inFlight++;
    result
      .catch((error) => {
        console.error(`Job "${r.handler.name}" failed to change:`, error);
      })
      .finally(() => {
        maybeFree(ev);
        this.finish(r, id, job);
      });
  }

  /**
   * The async call on `job` settled. Runs the deferred teardown when a
   * `removed` arrived (or the dispatcher was disposed) meanwhile, otherwise
   * applies the change that waited; returns whether the job is gone.
   */
  private finish(r: Registered, id: string, job: Job): boolean {
    job.inFlight = false;
    if (!this.disposed) {
      this.inFlightJobs--;
      r.inFlight--;
    }
    if (job.removedEv === undefined && !this.disposed) {
      const change = job.pendingChange;
      job.pendingChange = undefined;
      if (job.product === undefined) {
        // Nothing to change or tear down: a later `removed` is handled as for
        // an unknown id. Some entities are despawned without one, so keeping
        // the entry would leak it.
        maybeFree(change);
        r.jobs.delete(id);
      } else if (change !== undefined) {
        this.applyChange(r, id, job, change);
      }
      return false;
    }

    if (r.jobs.get(id) === job) r.jobs.delete(id);
    maybeFree(job.pendingChange);
    job.pendingChange = undefined;
    this.teardown(r, job.product, job.removedEv);
    maybeFree(job.removedEv);
    job.removedEv = undefined;
    return true;
  }

  private teardown(r: Registered, product: unknown, ev: object | undefined) {
    try {
      r.handler.teardown(product, ev);
    } catch (error) {
      console.error(`Job "${r.handler.name}" failed to tear down:`, error);
    }
  }
}
