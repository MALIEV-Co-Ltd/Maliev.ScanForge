import type { ReferenceVector } from "./reference-construction-values";
import {
  copySketchSourceRecordStore,
  type SketchSourceRecordStore,
} from "./sketch-source-records.ts";

/** Supplied state, not a claim about unobserved constructor initialization. */
export interface NativeSketchLineState {
  frame: SketchSourceRecordStore["frame"];
  start: ReferenceVector;
  middle: ReferenceVector;
  end: ReferenceVector;
  sourceRecords: readonly ReferenceVector[];
}
export interface NativeSketchLineRebuildPreparation {
  state: NativeSketchLineState;
  backendRequest:
    | { kind: "line"; points: readonly [ReferenceVector, ReferenceVector] }
    | undefined;
}
export interface NativeSketchLinePointEditPreparation {
  admitted: boolean;
  candidate: NativeSketchLineRebuildPreparation;
  /** Used only after the candidate backend fails; both are the saved old start. */
  recoveryPoints?: readonly [ReferenceVector, ReferenceVector];
}
function finite(n: number) {
  if (!Number.isFinite(n)) throw new Error("Sketch line arithmetic overflow.");
  return n;
}
function copyState(input: NativeSketchLineState): NativeSketchLineState {
  if (!Array.isArray(input.sourceRecords))
    throw new Error("Line state requires a source record collection.");
  const source = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: input.frame,
    children: [
      { id: "sources", kind: "line", records: input.sourceRecords },
      {
        id: "fields",
        kind: "line",
        records: [input.start, input.middle, input.end],
      },
    ],
  });
  const [start, middle, end] = source.children[1].records!;
  return {
    frame: source.frame,
    start,
    middle,
    end,
    sourceRecords: source.children[0].records!,
  };
}
function records(input: unknown, frame: unknown, minimum: number) {
  if (!Array.isArray(input) || input.length < minimum)
    throw new Error(
      `Sketch line replacement requires at least ${minimum} records.`,
    );
  return copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame,
    children: [{ id: "", kind: "line", records: input }],
  });
}
function prepare(
  start: ReferenceVector,
  end: ReferenceVector,
  frame: SketchSourceRecordStore["frame"],
  state: NativeSketchLineState,
): NativeSketchLineRebuildPreparation {
  // The direct native builder stores proposed fields before calling its backend.
  // Prior child records remain until that backend reports success.
  state.frame = frame;
  state.start = [...start];
  state.end = [...end];
  state.middle = [
    finite((end[0] + start[0]) * 0.5),
    finite((end[1] + start[1]) * 0.5),
    finite((end[2] + start[2]) * 0.5),
  ];
  return {
    state,
    backendRequest: { kind: "line", points: [[...start], [...end]] },
  };
}

/** First TWO records, XY only; distinct from local first/last replacement. */
export function prepareNativeSketchLineCollectionRebuild(
  input: unknown,
  previous: NativeSketchLineState,
): NativeSketchLineRebuildPreparation {
  const state = copyState(previous),
    source = records(input, state.frame, 2),
    points = source.children[0].records!;
  const a: ReferenceVector = [points[0][0], points[0][1], 0],
    b: ReferenceVector = [points[1][0], points[1][1], 0];
  const dy = a[1] - b[1],
    dx = a[0] - b[0];
  const length = Math.sqrt(finite(dy * dy + dx * dx + 0));
  if (length < Number.EPSILON) return { state, backendRequest: undefined };
  return prepare(a, b, source.frame, state);
}

/** First/LAST XYZ records; no collection coincidence precheck. */
export function prepareNativeSketchLineLocalReplacement(
  input: unknown,
  previous: NativeSketchLineState,
): NativeSketchLineRebuildPreparation {
  const state = copyState(previous),
    source = records(input, state.frame, 1),
    points = source.children[0].records!;
  return prepare(points[0], points[points.length - 1], source.frame, state);
}

/** Supplied-frame transpose conversion, preserving native endpoint accumulation. */
export function prepareNativeSketchLinePlacedReplacement(
  input: unknown,
  placement: unknown,
  previous: NativeSketchLineState,
): NativeSketchLineRebuildPreparation {
  const state = copyState(previous),
    source = records(input, placement, 1),
    points = source.children[0].records!;
  const [a, b, c] = source.frame;
  const local = (p: ReferenceVector, last: boolean): ReferenceVector => {
    const x = finite(p[0] - a[3]),
      y = finite(p[1] - b[3]),
      z = finite(p[2] - c[3]);
    const coordinate = (i: number) =>
      finite(
        last ? b[i] * y + a[i] * x + c[i] * z : a[i] * x + b[i] * y + c[i] * z,
      );
    return [coordinate(0), coordinate(1), coordinate(2)];
  };
  return prepare(
    local(points[0], false),
    local(points[points.length - 1], true),
    source.frame,
    state,
  );
}

/** Endpoint handles check candidate length, not distance moved by the handle. */
export function prepareNativeSketchLinePointEdit(
  index: number,
  target: unknown,
  previous: NativeSketchLineState,
): NativeSketchLinePointEditPreparation {
  if (!Number.isInteger(index) || index < 0 || index > 1)
    throw new Error("Line point index must be 0 or 1.");
  const state = copyState(previous),
    point = records([target], state.frame, 1).children[0].records![0],
    start = index === 0 ? point : state.start,
    end = index === 1 ? point : state.end;
  const dy = start[1] - end[1],
    dx = start[0] - end[0],
    dz = start[2] - end[2];
  if (Math.sqrt(finite(dy * dy + dx * dx + dz * dz)) < 0.0001)
    return { admitted: false, candidate: { state, backendRequest: undefined } };
  // Both native recovery buffers contain old start, including Z. They do not
  // contain the old endpoint pair. Keep recovery arithmetic lazy: the native
  // direct builder runs again only after the first backend reports failure.
  const recoveryPoints: [ReferenceVector, ReferenceVector] = [
    [...state.start],
    [...state.start],
  ];
  return {
    admitted: true,
    candidate: prepare(start, end, state.frame, state),
    recoveryPoints,
  };
}

/** Caller requests this only after a failed point-edit candidate backend build. */
export function prepareNativeSketchLinePointRecovery(
  edit: NativeSketchLinePointEditPreparation,
): NativeSketchLineRebuildPreparation {
  if (!edit.admitted || !edit.candidate.backendRequest || !edit.recoveryPoints)
    throw new Error("No admitted line point edit to recover.");
  return prepareNativeSketchLineLocalReplacement(
    edit.recoveryPoints,
    edit.candidate.state,
  );
}

/** Raw affine endpoint transform; stored placement stays separate and unchanged. */
export function prepareNativeSketchLineTransform(
  transformation: unknown,
  previous: NativeSketchLineState,
): NativeSketchLineRebuildPreparation {
  const state = copyState(previous),
    matrix = records([], transformation, 0).frame;
  const apply = (p: ReferenceVector): ReferenceVector => {
    const coordinate = (i: number) => {
      const r = matrix[i];
      return finite(r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + r[3]);
    };
    return [coordinate(0), coordinate(1), coordinate(2)];
  };
  return prepare(apply(state.start), apply(state.end), state.frame, state);
}

/**
 * Complete from the backend's ACTUAL success and midpoint result. An existing
 * edge alone is insufficient: the native line backend also checks a converted
 * body's first edge. Concrete provider parity remains outside this pure state
 * boundary. No success is fabricated from point separation or edge existence.
 */
export function completeNativeSketchLineRebuild(
  preparation: NativeSketchLineRebuildPreparation,
  backendSucceeded: boolean,
  backendMiddle?: unknown,
): { state: NativeSketchLineState; builderSucceeded: boolean } {
  const state = copyState(preparation.state);
  if (typeof backendSucceeded !== "boolean")
    throw new Error("Line backend result must be boolean.");
  if (!backendSucceeded) return { state, builderSucceeded: false };
  if (!preparation.backendRequest)
    throw new Error("No line backend build was requested.");
  const source = records([backendMiddle], state.frame, 1),
    middle = source.children[0].records![0];
  state.start = [state.start[0], state.start[1], 0];
  state.end = [state.end[0], state.end[1], 0];
  state.middle = [middle[0], middle[1], 0];
  state.sourceRecords = [[...state.start], [...state.end]];
  return { state, builderSucceeded: true };
}
