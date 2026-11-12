// The worker a `TimeSeriesFloodMeshDesc` loads its `url` in, so decoding the
// chunks and deriving the properties leave the page responsive.
import {
  loadTimeSeriesFlood,
  type TimeSeriesFloodSeries,
  type TimeSeriesFloodVariables,
} from "./series";

/** What to load: an absolute URL, as the worker's own differs from the page's. */
export type LoadWorkerRequest = {
  url: string;
  variables?: TimeSeriesFloodVariables;
};

export type LoadWorkerMessage =
  | { type: "progress"; fraction: number }
  | { type: "done"; series: TimeSeriesFloodSeries }
  | { type: "error"; message: string };

const post = (message: LoadWorkerMessage, transfer: Transferable[] = []) =>
  self.postMessage(message, { transfer });

/** The series' buffers, moved to the page rather than copied. */
const buffersOf = (series: TimeSeriesFloodSeries) => {
  const views = [
    series.nodes,
    series.heightBases,
    series.texels,
    series.flow,
    ...Array.from(series.fields.values(), (field) => field.data),
  ];
  return [
    ...new Set(views.flatMap((view) => (view ? [view.buffer] : []))),
  ] as ArrayBuffer[];
};

self.onmessage = async ({
  data: { url, variables },
}: MessageEvent<LoadWorkerRequest>) => {
  try {
    const series = await loadTimeSeriesFlood({
      url,
      variables,
      onProgress: (fraction) => post({ type: "progress", fraction }),
    });
    post({ type: "done", series }, buffersOf(series));
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
