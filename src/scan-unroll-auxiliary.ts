import { Vector3 } from "three";
import type { Entity, Positions, SavedSketch, Vec3 } from "./types";
import type { ScanToolOperation } from "./scan-tools";
import {
  createReferenceFrameEntity,
  validateReferenceFrameEntity,
} from "./reference-frame";

type Unroll = Extract<ScanToolOperation, { kind: "unroll" }>;
export interface RollMapping {
  version: 1;
  sourceEntityId: string;
  meshEntityId: string;
  sketchId: string;
  radius: number;
  offsetDegrees: number;
  instances: number;
}

export function copyRollMapping(value: unknown): RollMapping {
  const data = value as RollMapping;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    Object.keys(data).length !== 7 ||
    Object.keys(data).some(
      (key) =>
        ![
          "version",
          "sourceEntityId",
          "meshEntityId",
          "sketchId",
          "radius",
          "offsetDegrees",
          "instances",
        ].includes(key),
    ) ||
    data.version !== 1 ||
    !Number.isFinite(data.radius) ||
    data.radius <= 0 ||
    data.radius > 1e9 ||
    !Number.isFinite(data.offsetDegrees) ||
    !Number.isSafeInteger(data.instances) ||
    data.instances < 1 ||
    data.instances > 3000000 ||
    [data.sourceEntityId, data.meshEntityId, data.sketchId].some(
      (id) => typeof id !== "string" || !id.length || id.length > 200,
    )
  )
    throw Error("Invalid Unroll frame mapping.");
  return { ...data };
}
export function validateRollMappingEntity(
  entity: Entity,
): RollMapping | undefined {
  if (entity.rollMapping === undefined) return undefined;
  if (entity.kind !== "referenceFrame")
    throw Error("Unroll mapping requires a coordinate frame.");
  validateReferenceFrameEntity(entity);
  return copyRollMapping(entity.rollMapping);
}

/** Native frame conversion cycles (N,U,V) and offsets -radius*N to recover the cylinder. */
export function createUnrollAuxiliaries(
  operation: Unroll,
  output: Positions,
  identity: {
    frameId: string;
    sketchId: string;
    sourceEntityId: string;
    meshEntityId: string;
  },
): { frame: Entity; sketch: SavedSketch } {
  if (!output.length || output.length % 9)
    throw Error(
      "Unroll produced no complete facets; no objects were published.",
    );
  const axis = new Vector3(...operation.axis).normalize();
  const u = new Vector3(
    Math.abs(axis.x) < 0.9 ? 1 : 0,
    Math.abs(axis.x) < 0.9 ? 0 : 1,
    0,
  );
  u.addScaledVector(axis, -u.dot(axis)).normalize();
  const v = new Vector3().crossVectors(axis, u);
  const angle = (((operation.offsetDegrees ?? 0) % 360) * Math.PI) / 180;
  const radial = u
    .clone()
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(v, -Math.sin(angle));
  const tangent = v
    .multiplyScalar(Math.cos(angle))
    .addScaledVector(u, Math.sin(angle));
  const origin = new Vector3(...operation.center).addScaledVector(
    radial,
    operation.radius,
  );
  const frame = createReferenceFrameEntity(
    {
      origin: origin.toArray() as Vec3,
      u: tangent.toArray() as Vec3,
      v: axis.toArray() as Vec3,
      normal: radial.toArray() as Vec3,
    },
    operation.radius,
    identity.frameId,
    "Roll frame",
  );
  frame.visible = false;
  frame.rollMapping = copyRollMapping({
    version: 1,
    radius: operation.radius,
    sourceEntityId: identity.sourceEntityId,
    meshEntityId: identity.meshEntityId,
    sketchId: identity.sketchId,
    offsetDegrees: operation.offsetDegrees ?? 0,
    instances: operation.instances ?? 1,
  });
  let low = Infinity,
    high = -Infinity;
  for (let i = 1; i < output.length; i += 3) {
    if (!Number.isFinite(output[i]))
      throw Error("Invalid Unroll axial bounds.");
    low = Math.min(low, output[i]);
    high = Math.max(high, output[i]);
  }
  const circumference = operation.radius * (Math.PI * 2);
  return {
    frame,
    sketch: {
      id: identity.sketchId,
      name: "Sketch",
      visible: true,
      sketch: {
        version: 1,
        frame: {
          origin: [0, 0, 0],
          u: [1, 0, 0],
          v: [0, 1, 0],
          normal: [0, 0, 1],
        },
        points: [
          { id: "start", x: circumference, y: low },
          { id: "end", x: circumference, y: high },
        ],
        segments: [{ id: "seam", a: "start", b: "end" }],
        constraints: [],
      },
    },
  };
}
