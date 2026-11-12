import type { Input } from "./input";
import type { MeshSamplingOptions, MeshSeries, MeshStep } from "./mesh";
import { PropertyCollector, type PropertiesOption } from "./properties";
import {
  numberOf,
  readTable,
  recordOf,
  timeReader,
  type CoordinateColumns,
  type Table,
  type TimeOptions,
} from "./table";

export type MeshCsvOptions = MeshSamplingOptions &
  TimeOptions & {
    /**
     * CSV files of the values, one row per wet node (or face) and time; a
     * node without a row is dry. A file's header is its first line naming
     * every column asked for; lines before it are skipped. UTF-8 and
     * Shift_JIS are recognized. A field may be quoted, but not span lines.
     */
    inputs: Input[];
    /**
     * A CSV of the nodes: their `id`, their `position` and any column that
     * does not change over time, such as the ground height. Without it, each
     * value row carries its node's position, and the rows at one position
     * are one node.
     */
    nodes?: Input;
    /**
     * A CSV of the faces: their `id` and the ids of their nodes in order
     * around them. Without it, the nodes are triangulated (Delaunay) and the
     * triangles with an edge longer than `maxEdge` dropped.
     */
    faces?: Input;
    /**
     * The columns of `faces` holding the node ids, an empty field ending a
     * face of fewer nodes; all its columns but `id` by default.
     */
    faceNodes?: string[];
    /** The column holding the ids of nodes, faces and value rows (`"id"`). */
    id?: string;
    /**
     * Whether the values are at the nodes, interpolated linearly over the
     * triangles, or at the faces, each taken over its face (`"nodes"`).
     */
    valuesOn?: "nodes" | "faces";
    /**
     * Columns of a node's position in degrees, or with `projection`, its
     * easting and northing.
     */
    position: CoordinateColumns;
    /**
     * Column of the water level, or of the depth, which adds up to it with
     * the ground height. With `ground`, the ground height is stored as the
     * `ground` property, in the same datum as the levels, and the group's
     * `ground` attribute names it, so `loadTimeSeriesFlood` derives the
     * depth from it. A column is looked up in the value row, then in the
     * node's (or face's) row.
     */
    level?: string;
    ground?: string;
    depth?: string;
    /**
     * Properties stored with each node (or face): columns to parse as
     * numbers, or a callback given the value row merged over the node's row,
     * keyed by column, with the fields as strings.
     */
    properties?: PropertiesOption;
  };

/** A table of rows that do not change over time, by id. */
type Elements = {
  table: Table;
  ids: Map<string, number>;
  fields: string[][];
};

const elementsOf = async (
  input: Input,
  id: string,
  wanted: string[],
): Promise<Elements> => {
  const table = await readTable(input, [id, ...wanted]);
  const idIndex = table.index(id);
  const ids = new Map<string, number>();
  const fields: string[][] = [];
  for (const row of table.rows()) {
    const key = (row.fields[idIndex] ?? "").trim();
    if (ids.has(key)) {
      throw new Error(`${input.name}:${row.line}: id ${key} is repeated.`);
    }
    ids.set(key, fields.push(row.fields) - 1);
  }
  return { table, ids, fields };
};

/** Reads the mesh and its values from CSV files. */
export const readMeshCsv = async (
  options: MeshCsvOptions,
): Promise<MeshSeries> => {
  const {
    inputs,
    nodes,
    faces,
    id = "id",
    valuesOn = "nodes",
    position,
    level,
    ground,
    depth,
    minDepth = 0.01,
    time,
    interval = 0,
    properties,
  } = options;
  if (!inputs.length) throw new Error("No input.");
  if (!level === !depth) throw new Error("Give either level or depth.");
  if (depth && !ground) throw new Error("A depth needs the ground.");
  if (faces && !nodes) throw new Error("Faces need the nodes.");
  const timing = timeReader(options);
  const files = timing.kept(inputs, interval);

  const xs: number[] = [];
  const ys: number[] = [];
  const nodeTable = nodes && (await elementsOf(nodes, id, position));
  if (nodeTable) {
    const xi = nodeTable.table.index(position[0]);
    const yi = nodeTable.table.index(position[1]);
    for (const fields of nodeTable.fields) {
      xs.push(numberOf(fields[xi]));
      ys.push(numberOf(fields[yi]));
    }
  }
  const faceTable = faces && (await elementsOf(faces, id, []));
  // The table the value rows refer to, whose columns they may leave out.
  const elements = valuesOn === "faces" ? faceTable : nodeTable;
  const lookup = (column: string | undefined) =>
    column !== undefined && elements?.table.header.includes(column)
      ? elements.table.index(column)
      : -1;
  const staticLevel = lookup(level);
  const staticGround = lookup(ground);
  const staticDepth = lookup(depth);
  // Without nodes, the rows carry the positions; nodes are keyed by them.
  const nodeAt = new Map<string, number>();

  const collector = properties && new PropertyCollector(properties, true);
  const inRows = (column: string | undefined) =>
    column !== undefined && lookup(column) === -1 ? [column] : [];
  const wanted = [
    ...(elements ? [id] : position),
    ...inRows(level),
    ...inRows(ground),
    ...inRows(depth),
    ...(time ? [time] : []),
    ...(Array.isArray(properties) ? properties.flatMap(inRows) : []),
  ];
  const byTime = new Map<
    number,
    { index: number[]; levels: number[]; properties: Record<string, number[]> }
  >();
  // The ground of each node (or face), however a row gave it.
  const grounds: number[] = [];
  for (const input of files) {
    const table = await readTable(input, wanted);
    const at = (column: string | undefined) =>
      column === undefined ? -1 : table.index(column);
    const idIndex = at(id);
    const [xi, yi] = position.map(at);
    const [levelIndex, groundIndex, depthIndex, timeIndex] = [
      level,
      ground,
      depth,
      time,
    ].map(at);
    const fileTime = timing.fileTime(input);
    for (const { fields, line } of table.rows()) {
      const where = `${input.name}:${line}`;
      let element: number;
      if (elements) {
        const key = (fields[idIndex] ?? "").trim();
        const found = elements.ids.get(key);
        if (found === undefined) throw new Error(`${where}: no id ${key}.`);
        element = found;
      } else {
        const key = `${fields[xi]},${fields[yi]}`;
        element = nodeAt.get(key) ?? xs.length;
        if (element === xs.length) {
          xs.push(numberOf(fields[xi]));
          ys.push(numberOf(fields[yi]));
          if (!Number.isFinite(xs[element]) || !Number.isFinite(ys[element])) {
            throw new Error(`${where}: the position is not numbers.`);
          }
        }
        nodeAt.set(key, element);
      }
      const own = elements?.fields[element];
      const value = (rowIndex: number, staticIndex: number) =>
        numberOf(rowIndex !== -1 ? fields[rowIndex] : own?.[staticIndex]);
      const groundValue = value(groundIndex, staticGround);
      if (Number.isFinite(groundValue)) grounds[element] = groundValue;
      const depthValue = depth ? value(depthIndex, staticDepth) : undefined;
      if (depthValue !== undefined && !(depthValue >= minDepth)) continue;
      const levelValue =
        depthValue === undefined
          ? value(levelIndex, staticLevel)
          : groundValue + depthValue;
      // An empty or non-numeric level is a dry node, like a missing row.
      if (!Number.isFinite(levelValue)) continue;

      const t = fileTime ?? timing.secondsOf((fields[timeIndex] ?? "").trim());
      let step = byTime.get(t);
      if (!step)
        byTime.set(t, (step = { index: [], levels: [], properties: {} }));
      step.index.push(element);
      step.levels.push(levelValue);
      if (collector) {
        const record = {
          ...(own && elements && recordOf(elements.table.header, own)),
          ...recordOf(table.header, fields),
        };
        const values = collector.collect(record);
        // A property first seen on a later row is missing on the earlier ones.
        for (const name of collector.names) {
          const list = (step.properties[name] ??= new Array<number>(
            step.index.length - 1,
          ).fill(NaN));
          list.push(values[name] ?? NaN);
        }
      }
    }
  }
  if (elements) {
    elements.fields.forEach((own, e) => {
      const g = numberOf(own[staticGround]);
      if (staticGround !== -1 && Number.isFinite(g)) grounds[e] = g;
    });
  }
  const steps = [...byTime].sort(([a], [b]) => a - b);
  if (!steps.length) throw new Error("No wet nodes.");

  let faceList: MeshSeries["faces"];
  if (faceTable) {
    const nodeIndex = nodeTable?.ids ?? new Map<string, number>();
    const columns =
      options.faceNodes ?? faceTable.table.header.filter((c) => c !== id);
    const indices = columns.map((c) => {
      const i = faceTable.table.index(c);
      if (i === -1) throw new Error(`${faces.name} has no column ${c}.`);
      return i;
    });
    const starts = [0];
    const ring: number[] = [];
    faceTable.fields.forEach((fields, f) => {
      for (const i of indices) {
        const key = (fields[i] ?? "").trim();
        if (!key) break;
        const n = nodeIndex.get(key);
        if (n === undefined) {
          throw new Error(`${faces.name}: face ${f} has no node ${key}.`);
        }
        ring.push(n);
      }
      starts.push(ring.length);
    });
    faceList = {
      starts: Int32Array.from(starts),
      nodes: Int32Array.from(ring),
    };
  }

  const elementCount =
    valuesOn === "faces" ? (faceTable?.fields.length ?? 0) : xs.length;
  return {
    source: files.length === 1 ? files[0].name : `${files.length} files`,
    x: xs,
    y: ys,
    faces: faceList,
    valuesOn,
    ground: ground
      ? Float64Array.from({ length: elementCount }, (_, e) => grounds[e] ?? NaN)
      : undefined,
    times: steps.map(([t]) => t),
    step: (k): MeshStep => steps[k][1],
    properties: collector,
  };
};
