import type { LoadWorkerMessage, LoadWorkerRequest } from "./loadWorker";
import LoadWorkerURL from "./loadWorker?worker&url";
import type { TimeSeriesFloodSeries, TimeSeriesFloodVariables } from "./series";

/**
 * Loads a series as `loadTimeSeriesFlood` does, in a worker of its own,
 * which `signal` terminates.
 */
export const loadInWorker = (
  url: string | URL,
  {
    variables,
    signal,
    onProgress,
  }: {
    variables?: TimeSeriesFloodVariables;
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
  },
) =>
  new Promise<TimeSeriesFloodSeries>((resolve, reject) => {
    signal?.throwIfAborted();
    const worker = new Worker(LoadWorkerURL, { type: "module" });
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      stop();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<LoadWorkerMessage>) => {
      if (data.type === "progress") return onProgress?.(data.fraction);
      stop();
      if (data.type === "done") resolve(data.series);
      else reject(new Error(data.message));
    };
    worker.onmessageerror = () => {
      stop();
      reject(new Error("The loading worker's result could not be received"));
    };
    worker.onerror = (event) => {
      stop();
      reject(new Error(event.message || "The loading worker failed"));
    };
    worker.postMessage({
      url: new URL(url, globalThis.location?.href).href,
      variables,
    } satisfies LoadWorkerRequest);
  });
