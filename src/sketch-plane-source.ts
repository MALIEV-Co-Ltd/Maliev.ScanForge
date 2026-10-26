import { validateReferenceFrameEntity } from "./reference-frame";
import { datumFrame } from "./origin";
import { validatePlaneFrame, planeFrameBasis } from "./plane-frame";
import { validateSketchFrame, type SketchFrame } from "./sketch-frame";
import type { Entity, Vec3 } from "./types";

export type CoordinateFramePlane = "XY" | "YZ" | "XZ";

export type SketchPlaneSelection =
  | { frame: SketchFrame }
  | {
      planeSourceId: string;
      normalOffset: number;
      framePlane?: CoordinateFramePlane;
    };

export function isSketchPlaneSource(entity: Entity): boolean {
  return (
    (entity.kind === "referenceFrame" &&
      entity.coordinateFrame !== undefined) ||
    ((entity.kind === "plane" || entity.kind === "cad") &&
      (entity.planeFrame !== undefined ||
        (entity.kind === "plane" && entity.fit?.kind === "plane")))
  );
}

/** Copy a rigid placement and move along its unit normal, in world millimetres. */
export function offsetSketchPlane(
  frame: SketchFrame,
  offset: number,
): SketchFrame {
  validateSketchFrame(frame);
  if (
    typeof offset !== "number" ||
    !Number.isFinite(offset) ||
    Math.abs(offset) > 1e9
  )
    throw new Error("Sketch normal offset must be finite and within ±1e9 mm.");
  const result = structuredClone(frame);
  result.origin = frame.origin.map(
    (value, i) => value + frame.normal[i] * offset,
  ) as Vec3;
  validateSketchFrame(result);
  return result;
}

/** A source plane supplies a detached placement, not a live sketch dependency. */
export function resolveSketchPlaneSource(
  entities: readonly Entity[],
  sourceId: string,
  normalOffset = 0,
  framePlane: CoordinateFramePlane = "XY",
): SketchFrame {
  if (typeof sourceId !== "string" || !sourceId)
    throw new Error("Sketch plane source identity is required.");
  const matches = entities.filter((entity) => entity.id === sourceId);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "Sketch plane source identity is ambiguous."
        : "Sketch plane source is missing.",
    );
  const entity = matches[0];
  if (!["XY", "YZ", "XZ"].includes(framePlane))
    throw new Error("Unknown coordinate-frame plane.");
  if (entity.kind === "referenceFrame") {
    const { frame } = validateReferenceFrameEntity(entity)!;
    const selected: SketchFrame =
      framePlane === "XY"
        ? frame
        : framePlane === "YZ"
          ? {
              origin: frame.origin,
              u: frame.v,
              v: frame.normal,
              normal: frame.u,
            }
          : {
              origin: frame.origin,
              u: frame.normal,
              v: frame.u,
              normal: frame.v,
            };
    return offsetSketchPlane(selected, normalOffset);
  }
  if (framePlane !== "XY")
    throw new Error("Frame-plane selection requires a coordinate system.");
  if (!isSketchPlaneSource(entity))
    throw new Error("Sketch source must be a reference plane.");
  let frame: SketchFrame;
  if (entity.planeFrame !== undefined) {
    const stored = entity.planeFrame;
    validatePlaneFrame(stored, entity.positions, entity.kind);
    const { u, v } = planeFrameBasis(stored);
    const n = stored.normal;
    frame = {
      origin: [...stored.center],
      u,
      v,
      normal: [...n],
    };
  } else {
    frame = datumFrame(entity.fit!.center, entity.fit!.axis);
  }
  return offsetSketchPlane(frame, normalOffset);
}
