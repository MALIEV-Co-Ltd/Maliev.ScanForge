import type { ReferenceVector } from "./reference-construction-values";
import {
  nativeReferenceCircumcenter,
  nativeReferenceNormalize,
} from "./reference-geometry-numerics.ts";
import {
  copySketchSourceRecordStore,
  type SketchSourceRecordStore,
} from "./sketch-source-records.ts";

type ArcPoints = readonly [ReferenceVector, ReferenceVector, ReferenceVector];
type ArcRecords = readonly [
  ReferenceVector,
  ReferenceVector,
  ReferenceVector,
  ReferenceVector,
];

export interface NativeSketchArcRebuildPreparation {
  readonly frame: SketchSourceRecordStore["frame"];
  /** Internal endpoints can differ from retained source records after closure. */
  readonly points: ArcPoints;
  readonly center: ReferenceVector;
  /** Undefined preserves an unestablished prior radius until a branch writes it. */
  readonly radius: number | undefined;
  readonly closed: boolean;
  readonly sourceRecords: ArcRecords;
  /** Undefined when a record replacement retains geometry without fitting. */
  readonly fitSucceeded: boolean | undefined;
  /** Undefined means the native builder leaves the previous backend untouched. */
  readonly backendRequest:
    | {
        readonly kind: "arc";
        readonly points: ArcPoints;
        readonly center: ReferenceVector;
      }
    | undefined;
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Sketch arc arithmetic overflow.");
  return value;
}

/** Shared forward transform order used by native placed comparison and edits. */
function transformArcPoint(
  frame: SketchSourceRecordStore["frame"],
  point: ReferenceVector,
): ReferenceVector {
  const [a, b, c] = frame;
  return [
    finite(a[0] * point[0] + a[1] * point[1] + a[2] * point[2] + a[3]),
    finite(b[0] * point[0] + b[1] * point[1] + b[2] * point[2] + b[3]),
    finite(c[0] * point[0] + c[1] * point[1] + c[2] * point[2] + c[3]),
  ];
}

function squaredDistance(a: ReferenceVector, b: ReferenceVector): number {
  const dx = a[0] - b[0],
    dy = a[1] - b[1],
    dz = a[2] - b[2];
  return finite(dx * dx + dy * dy + dz * dz);
}

/** Reproduce translation arithmetic; center is updated by delta, not assigned. */
function translatePreparedArc(
  previous: NativeSketchArcRebuildPreparation,
  frame: SketchSourceRecordStore["frame"],
  delta: ReferenceVector,
  closed: boolean,
): NativeSketchArcRebuildPreparation {
  const move = (point: ReferenceVector): ReferenceVector => [
    finite(delta[0] + point[0]),
    finite(delta[1] + point[1]),
    finite(delta[2] + point[2]),
  ];
  const points = previous.points.map(move) as unknown as ArcPoints;
  const center = move(previous.center);
  return {
    frame,
    points,
    center,
    radius: previous.radius,
    closed,
    sourceRecords: [
      [...points[0]],
      [...points[1]],
      [...points[2]],
      [...center],
    ],
    fitSucceeded: undefined,
    backendRequest: {
      kind: "arc",
      points: [[...points[0]], [...points[1]], [...points[2]]],
      center: [...center],
    },
  };
}

/** The outer builder tests a determinant before calling the center/radius helper. */
function admittedDeterminant(
  a: ReferenceVector,
  b: ReferenceVector,
  c: ReferenceVector,
): boolean {
  const atA = finite(
    (c[0] - a[0]) * (b[0] - a[0]) +
      (c[1] - a[1]) * (b[1] - a[1]) +
      (c[2] - a[2]) * (b[2] - a[2]),
  );
  const atB = finite(
    (c[0] - b[0]) * (a[0] - b[0]) +
      (c[1] - b[1]) * (a[1] - b[1]) +
      (c[2] - b[2]) * (a[2] - b[2]),
  );
  const atC = finite(
    (a[1] - c[1]) * (b[1] - c[1]) +
      (a[0] - c[0]) * (b[0] - c[0]) +
      (a[2] - c[2]) * (b[2] - c[2]),
  );
  const determinant = finite(atC * atB + atC * atA + atB * atA);
  return Number.EPSILON <= Math.abs(determinant);
}

/**
 * Pure preparation of the observed native arc builder. Prior radius, closed
 * flag and source records are explicit because early failure does not reset
 * them uniformly. The caller owns backend execution and outer transaction
 * policy. In particular, a closed request remains an arc request with equal
 * internal endpoints; do not silently convert it to a successful circle.
 *
 * This internal canonical carrier accepts empty or complete prior collections.
 * It rejects malformed/nonfinite input and arithmetic overflow before returning
 * a new state. Those checks are application policy, not native inferred limits.
 * No shared editor, scene, history or MCP state is published by this function.
 */
export function prepareNativeSketchArcRebuild(
  input: unknown,
  placement: unknown,
  previous: unknown,
  close: unknown,
): NativeSketchArcRebuildPreparation {
  if (!Array.isArray(input) || input.length !== 3)
    throw new Error("Arc rebuild requires exactly three source points.");
  if (!previous || typeof previous !== "object" || Array.isArray(previous))
    throw new Error("Invalid prior arc state.");
  const prior = previous as Record<string, unknown>;
  if (
    Object.keys(prior).some(
      (key) => !["radius", "closed", "sourceRecords"].includes(key),
    ) ||
    !Object.hasOwn(prior, "radius") ||
    (prior.radius !== undefined &&
      (typeof prior.radius !== "number" || !Number.isFinite(prior.radius))) ||
    typeof prior.closed !== "boolean" ||
    typeof close !== "boolean" ||
    !Array.isArray(prior.sourceRecords) ||
    ![0, 4].includes(prior.sourceRecords.length)
  )
    throw new Error("Invalid arc rebuild state or closure flag.");
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [
      { id: "input", kind: "arc", records: input },
      { id: "prior", kind: "arc", records: prior.sourceRecords },
    ],
  });
  let [a, b, c] = copied.children[0].records!.map((p): ReferenceVector => [
    p[0],
    p[1],
    0,
  ]);
  let center: ReferenceVector = [...b];
  let radius = prior.radius,
    closed = prior.closed;
  if (squaredDistance(a, b) < 1e-4 || squaredDistance(c, b) < 1e-4) {
    const midpoint: ReferenceVector = [
      finite((a[0] + c[0]) * 0.5),
      finite((a[1] + c[1]) * 0.5),
      (a[2] + c[2]) * 0.5,
    ];
    const delta: ReferenceVector = [
      midpoint[0] - a[0],
      midpoint[1] - a[1],
      midpoint[2] - a[2],
    ];
    radius = Math.sqrt(
      finite(delta[1] * delta[1] + delta[0] * delta[0] + delta[2] * delta[2]),
    );
    const direction = nativeReferenceNormalize(delta);
    b = [
      finite(radius * direction[1] + midpoint[0]),
      finite(-direction[0] * radius + midpoint[1]),
      finite(radius * 0 + midpoint[2]),
    ];
  }
  const oldRecords = copied.children[1].records!;
  const records: [
    ReferenceVector,
    ReferenceVector,
    ReferenceVector,
    ReferenceVector,
  ] = [[...a], [...b], [...c], [...(oldRecords.length ? oldRecords[3] : b)]];
  let fitSucceeded = false;
  if (admittedDeterminant(a, b, c)) {
    const fit = nativeReferenceCircumcenter(a, b, c, true);
    center = [fit.center[0], fit.center[1], fit.center[2]];
    radius = -3.4028234663852886e38;
    if (fit.nondegenerate) {
      const dy = c[1] - center[1],
        dx = c[0] - center[0],
        dz = c[2] - center[2];
      radius = Math.sqrt(finite(dy * dy + dx * dx + dz * dz));
    }
    if (0 < radius) {
      center = [center[0], center[1], 0];
      records[3] = [...center];
      fitSucceeded = true;
      if (close || squaredDistance(a, c) < 1e-8) {
        closed = true;
        a = [...c];
      }
    }
  }
  return {
    frame: copied.frame,
    points: [a, b, c],
    center,
    radius,
    closed,
    sourceRecords: records,
    fitSucceeded,
    backendRequest: fitSucceeded
      ? { kind: "arc", points: [[...a], [...b], [...c]], center: [...center] }
      : undefined,
  };
}

/**
 * Replace local records on an already prepared arc. The native replacement
 * clears closure first. With more than three records and all three defining
 * points strictly within squared distance 1e-5 of the INTERNAL points, it
 * retains those points, center and radius, regenerates the source collection,
 * and still calls the backend. Otherwise it refits the first three records.
 *
 * This is not the placed-record or individual control-point edit operation.
 * Finite canonical input and minimum/maximum record admission are application
 * policy; invalid requests do not partially clear the caller's staged state.
 */
export function prepareNativeSketchArcLocalReplacement(
  input: unknown,
  previous: NativeSketchArcRebuildPreparation,
): {
  route: "retain" | "refit";
  preparation: NativeSketchArcRebuildPreparation;
} {
  if (!Array.isArray(input) || input.length < 3)
    throw new Error("Arc local replacement requires at least three records.");
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [{ id: "input", kind: "arc", records: input }],
  });
  const records = copied.children[0].records!;
  if (
    records.length > 3 &&
    previous.points.every(
      (point, index) => squaredDistance(point, records[index]) < 1e-5,
    )
  ) {
    // The retained branch performs literal +0 arithmetic, including on -0.
    return {
      route: "retain",
      preparation: translatePreparedArc(
        previous,
        copied.frame,
        [0, 0, 0],
        false,
      ),
    };
  }
  return {
    route: "refit",
    preparation: prepareNativeSketchArcRebuild(
      records.slice(0, 3),
      copied.frame,
      {
        radius: previous.radius,
        closed: false,
        sourceRecords: previous.sourceRecords,
      },
      false,
    ),
  };
}

/**
 * Native placed-record edit on an already prepared arc. The supplied frame
 * places the old internal points for comparison. If they match the first three
 * records, the fourth WORLD point drives a local center delta and no fit runs.
 * That branch preserves stored placement and can produce nonzero local Z.
 * Otherwise the first three points are converted, flattened and refitted with
 * the supplied placement. Both branches clear closure before their operation.
 *
 * The inverse uses the transposed rotation with Y/X/Z accumulation, not a
 * general affine inverse. This finite raw-frame carrier does not authorize
 * non-rigid public authoring; the shared editor must retain rigid validation.
 */
export function prepareNativeSketchArcPlacedReplacement(
  input: unknown,
  placement: unknown,
  previous: NativeSketchArcRebuildPreparation,
): {
  route: "translate" | "refit";
  preparation: NativeSketchArcRebuildPreparation;
} {
  if (!Array.isArray(input) || input.length < 3)
    throw new Error("Placed arc replacement requires at least three records.");
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [{ id: "input", kind: "arc", records: input }],
  });
  const records = copied.children[0].records!;
  const [a, b, c] = copied.frame;
  const local = (point: ReferenceVector): ReferenceVector => {
    const x = finite(point[0] - a[3]),
      y = finite(point[1] - b[3]),
      z = finite(point[2] - c[3]);
    return [
      finite(y * b[0] + x * a[0] + z * c[0]),
      finite(y * b[1] + x * a[1] + z * c[1]),
      finite(y * b[2] + x * a[2] + z * c[2]),
    ];
  };
  if (
    records.length > 3 &&
    previous.points.every(
      (point, index) =>
        squaredDistance(
          transformArcPoint(copied.frame, point),
          records[index],
        ) < 1e-5,
    )
  ) {
    const target = local(records[3]);
    const delta: ReferenceVector = [
      finite(target[0] - previous.center[0]),
      finite(target[1] - previous.center[1]),
      finite(target[2] - previous.center[2]),
    ];
    const retainedFrame = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [],
    }).frame;
    return {
      route: "translate",
      preparation: translatePreparedArc(previous, retainedFrame, delta, false),
    };
  }
  return {
    route: "refit",
    preparation: prepareNativeSketchArcRebuild(
      records.slice(0, 3).map(local),
      copied.frame,
      {
        radius: previous.radius,
        closed: false,
        sourceRecords: previous.sourceRecords,
      },
      false,
    ),
  };
}

/**
 * Edit one native local arc record. A/B/C edits refit the internal points while
 * carrying the existing closure flag. Center editing translates XY only; its
 * supplied Z is ignored, existing Z receives +0, and closure/radius are retained.
 * Unlike collection replacement, neither route clears closure in advance.
 * Index/finite validation is application policy and precedes staged mutation.
 */
export function prepareNativeSketchArcPointEdit(
  index: unknown,
  input: unknown,
  previous: NativeSketchArcRebuildPreparation,
): {
  route: "translate" | "refit";
  preparation: NativeSketchArcRebuildPreparation;
} {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 3
  )
    throw new Error(
      "Arc point index must be an integer from zero through three.",
    );
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [{ id: "input", kind: "arc", records: [input] }],
  });
  const point = copied.children[0].records![0];
  if (index === 3) {
    const delta: ReferenceVector = [
      finite(point[0] - previous.center[0]),
      finite(point[1] - previous.center[1]),
      0,
    ];
    return {
      route: "translate",
      preparation: translatePreparedArc(
        previous,
        copied.frame,
        delta,
        previous.closed,
      ),
    };
  }
  const points = previous.points.map((p) => [...p]);
  points[index] = [...point];
  return {
    route: "refit",
    preparation: prepareNativeSketchArcRebuild(
      points,
      copied.frame,
      {
        radius: previous.radius,
        closed: previous.closed,
        sourceRecords: previous.sourceRecords,
      },
      previous.closed,
    ),
  };
}

/**
 * Transform internal LOCAL A/B/C and refit with the unchanged stored frame and
 * existing closure flag. The builder flattens transformed local Z. This is not
 * an owner-placement transform or a general affine transform of a kernel edge.
 * Raw finite matrix admission here does not define public transform eligibility.
 */
export function prepareNativeSketchArcTransform(
  input: unknown,
  previous: NativeSketchArcRebuildPreparation,
): NativeSketchArcRebuildPreparation {
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: input,
    children: [{ id: "points", kind: "arc", records: previous.points }],
  });
  const points = copied.children[0].records!.map((point) =>
    transformArcPoint(copied.frame, point),
  );
  return prepareNativeSketchArcRebuild(
    points,
    previous.frame,
    {
      radius: previous.radius,
      closed: previous.closed,
      sourceRecords: previous.sourceRecords,
    },
    previous.closed,
  );
}

/**
 * Rebuild from the first three local collection records while carrying closure.
 * Unlike local/placed replacement this always fits, never uses the fourth point
 * as a target, and does not clear closure. Extra records still undergo finite
 * canonical input and resource admission before staged mutation.
 */
export function prepareNativeSketchArcCollectionRebuild(
  input: unknown,
  previous: NativeSketchArcRebuildPreparation,
): NativeSketchArcRebuildPreparation {
  if (!Array.isArray(input) || input.length < 3)
    throw new Error("Arc collection rebuild requires at least three records.");
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [{ id: "input", kind: "arc", records: input }],
  });
  return prepareNativeSketchArcRebuild(
    copied.children[0].records!.slice(0, 3),
    copied.frame,
    {
      radius: previous.radius,
      closed: previous.closed,
      sourceRecords: previous.sourceRecords,
    },
    previous.closed,
  );
}
