import type { ReferenceVector } from "./reference-construction-values";
import {
  nativeReferenceCircumcenter,
  nativeReferenceNormalize,
} from "./reference-geometry-numerics.ts";
import {
  copySketchSourceRecordStore,
  type SketchSourceRecordStore,
} from "./sketch-source-records.ts";

export interface NativeSketchCircleRebuildPreparation {
  readonly frame: SketchSourceRecordStore["frame"];
  readonly sourceRecords: readonly [
    ReferenceVector,
    ReferenceVector,
    ReferenceVector,
    ReferenceVector,
  ];
  /** Undefined for center translation, which performs no fit. */
  readonly fitSucceeded: boolean | undefined;
  /** Always issued by the native builder, including its failed-fit sentinel. */
  readonly backendRequest: {
    readonly kind: "circle";
    readonly center: ReferenceVector;
    readonly radius: number;
  };
}

/**
 * Prepare the native three-point circle rebuild's local state. Retain A/B/C,
 * flatten Z, fit in the observed order, and replace the entire four-record
 * collection even on fit failure. The failed-fit center is B, not the generic
 * circumcenter helper's centroid. Owner placement is copied, not applied.
 *
 * This stops before the kernel call. The caller must rebuild/clear backend
 * state even for a negative radius request, then preserve the separate backend
 * result. Publication, rollback and derived display remain the shared editor's
 * responsibility; this preparation neither publishes nor reports acceptance.
 */
export function prepareNativeSketchCircleRebuild(
  input: unknown,
  placement: unknown,
): NativeSketchCircleRebuildPreparation {
  if (!Array.isArray(input) || input.length !== 3)
    throw new Error("Circle rebuild requires exactly three source points.");
  const source = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [{ id: "", kind: "circle", records: input }],
  });
  const points = source.children[0].records!.map((point): ReferenceVector => [
    point[0],
    point[1],
    0,
  ]);
  const [a, b, c] = points;
  const fit = nativeReferenceCircumcenter(a, b, c, true);
  let center: ReferenceVector = [b[0], b[1], 0];
  let radius = -Number.MAX_VALUE;
  let fitSucceeded = false;
  if (fit.nondegenerate) {
    const dy = c[1] - fit.center[1];
    const dx = c[0] - fit.center[0];
    const dz = c[2] - fit.center[2];
    const squared = dy * dy + dx * dx + dz * dz;
    if (!Number.isFinite(squared))
      throw new Error("Sketch circle radius arithmetic overflow.");
    const fittedRadius = Math.sqrt(squared);
    // Strict fit threshold; the later backend has a distinct inclusive test.
    if (2 ** -23 < fittedRadius) {
      center = [fit.center[0], fit.center[1], 0];
      radius = fittedRadius;
      fitSucceeded = true;
    }
  }
  return {
    frame: source.frame,
    sourceRecords: [a, b, c, center],
    fitSucceeded,
    backendRequest: { kind: "circle", center: [...center], radius },
  };
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Sketch circle edit arithmetic overflow.");
  return value;
}

/**
 * Compare in the supplied world placement, then translate from a fourth center
 * or refit the inverse-transformed first three points. Translation preserves
 * stored placement; refitting adopts the supplied placement. The inverse is a
 * transpose with Y/X/Z accumulation, not a general affine inverse.
 */
export function prepareNativeSketchCirclePlacedReplacement(
  input: unknown,
  placement: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): {
  route: "translate" | "refit";
  preparation: NativeSketchCircleRebuildPreparation;
} {
  if (!Array.isArray(input) || input.length < 3)
    throw new Error(
      "Placed circle replacement requires at least three records.",
    );
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [{ id: "input", kind: "circle", records: input }],
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
    previous.sourceRecords.slice(0, 3).every((point, index) => {
      const world = copied.frame.map((row) =>
        finite(
          row[0] * point[0] + row[1] * point[1] + row[2] * point[2] + row[3],
        ),
      );
      const dx = finite(world[0] - records[index][0]),
        dy = finite(world[1] - records[index][1]),
        dz = finite(world[2] - records[index][2]);
      return finite(dx * dx + dy * dy + dz * dz) < 1e-5;
    })
  ) {
    // Exact prior points select the existing local XYZ translation producer;
    // the converted target still goes through delta subtraction and addition.
    return prepareNativeSketchCircleLocalReplacement(
      [...previous.sourceRecords.slice(0, 3), local(records[3])],
      previous,
    );
  }
  return {
    route: "refit",
    preparation: prepareNativeSketchCircleRebuild(
      records.slice(0, 3).map(local),
      copied.frame,
    ),
  };
}

function copyCircleEditRecords(
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
) {
  if (!Array.isArray(input) || input.length < 3)
    throw new Error(
      "Circle collection editing requires at least three records.",
    );
  return copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [{ id: "input", kind: "circle", records: input }],
  });
}

/** Refit first three local records, regardless of any fourth center record. */
export function prepareNativeSketchCircleCollectionRebuild(
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): NativeSketchCircleRebuildPreparation {
  const copied = copyCircleEditRecords(input, previous);
  return prepareNativeSketchCircleRebuild(
    copied.children[0].records!.slice(0, 3),
    copied.frame,
  );
}

/** Local replacement may translate XYZ from a fourth record instead of fitting. */
export function prepareNativeSketchCircleLocalReplacement(
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): {
  route: "translate" | "refit";
  preparation: NativeSketchCircleRebuildPreparation;
} {
  const copied = copyCircleEditRecords(input, previous);
  const records = copied.children[0].records!;
  const near =
    records.length > 3 &&
    records.slice(0, 3).every((p, index) => {
      const old = previous.sourceRecords[index];
      const dx = finite(old[0] - p[0]),
        dy = finite(old[1] - p[1]),
        dz = finite(old[2] - p[2]);
      return finite(dx * dx + dy * dy + dz * dz) < 1e-5;
    });
  if (!near)
    return {
      route: "refit",
      preparation: prepareNativeSketchCircleRebuild(
        records.slice(0, 3),
        copied.frame,
      ),
    };
  const center = previous.backendRequest.center;
  const delta = records[3].map((value, i) => finite(value - center[i]));
  const move = (point: ReferenceVector): ReferenceVector => [
    finite(point[0] + delta[0]),
    finite(point[1] + delta[1]),
    finite(point[2] + delta[2]),
  ];
  const movedCenter = move(center);
  return {
    route: "translate",
    preparation: {
      frame: copied.frame,
      sourceRecords: [
        move(previous.sourceRecords[0]),
        move(previous.sourceRecords[1]),
        move(previous.sourceRecords[2]),
        movedCenter,
      ],
      fitSucceeded: undefined,
      backendRequest: {
        kind: "circle",
        center: [...movedCenter],
        radius: previous.backendRequest.radius,
      },
    },
  };
}

/**
 * Refit one local defining point (0..2), or translate center XY (3) without
 * fitting. Circle preparations retain internal A/B/C as their first three
 * source records; unlike closed arcs there is no endpoint substitution.
 */
export function prepareNativeSketchCirclePointEdit(
  index: unknown,
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): NativeSketchCircleRebuildPreparation {
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 3
  )
    throw new Error("Circle point index must be an integer from 0 to 3.");
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [{ id: "input", kind: "circle", records: [input] }],
  });
  const point = copied.children[0].records![0];
  if (index < 3) {
    const points = previous.sourceRecords.slice(0, 3).map((p) => [...p]);
    points[index] = [...point];
    return prepareNativeSketchCircleRebuild(points, copied.frame);
  }
  const center = previous.backendRequest.center;
  const dx = finite(point[0] - center[0]);
  const dy = finite(point[1] - center[1]);
  const move = (p: ReferenceVector): ReferenceVector => [
    finite(p[0] + dx),
    finite(p[1] + dy),
    finite(p[2] + 0),
  ];
  const movedCenter = move(center);
  return {
    frame: copied.frame,
    sourceRecords: [
      move(previous.sourceRecords[0]),
      move(previous.sourceRecords[1]),
      move(previous.sourceRecords[2]),
      movedCenter,
    ],
    fitSucceeded: undefined,
    backendRequest: {
      kind: "circle",
      center: [...movedCenter],
      radius: previous.backendRequest.radius,
    },
  };
}

/** Transform local A/B/C then refit; stored placement is not transformed. */
export function prepareNativeSketchCircleTransform(
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): NativeSketchCircleRebuildPreparation {
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: input,
    children: [
      {
        id: "points",
        kind: "circle",
        records: previous.sourceRecords.slice(0, 3),
      },
    ],
  });
  const points = copied.children[0].records!.map((p) =>
    copied.frame.map((row) =>
      finite(row[0] * p[0] + row[1] * p[1] + row[2] * p[2] + row[3]),
    ),
  );
  return prepareNativeSketchCircleRebuild(points, previous.frame);
}

/** Resize retained defining directions around the center without fitting. */
export function prepareNativeSketchCircleRadiusEdit(
  input: unknown,
  previous: NativeSketchCircleRebuildPreparation,
): NativeSketchCircleRebuildPreparation {
  if (typeof input !== "number" || !Number.isFinite(input))
    throw new Error("Circle radius must be finite.");
  let radius = input < 0 ? -input : input;
  if (radius < 2 ** -23) radius = 0.01;
  const copied = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [
      { id: "points", kind: "circle", records: previous.sourceRecords },
    ],
  });
  const center = previous.backendRequest.center;
  const points = copied.children[0]
    .records!.slice(0, 3)
    .map((point, index): ReferenceVector => {
      const delta = point.map((value, i) => finite(value - center[i]));
      const squared = finite(
        delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2],
      );
      // The middle guard compares squared length, unlike the normalization helper.
      const direction =
        index === 1 && squared < Number.EPSILON
          ? [0, 1, 0]
          : nativeReferenceNormalize(delta);
      return [
        finite(direction[0] * radius + center[0]),
        finite(direction[1] * radius + center[1]),
        finite(direction[2] * radius + center[2]),
      ];
    });
  return {
    frame: copied.frame,
    sourceRecords: [points[0], points[1], points[2], [...center]],
    fitSucceeded: undefined,
    backendRequest: { kind: "circle", center: [...center], radius },
  };
}
