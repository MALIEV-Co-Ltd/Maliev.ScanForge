import type { CadAlignmentInput } from "./cad/alignment-reference";
import { cylinderReference } from "./scan-tools-reference";
import type { ScanToolOperation } from "./scan-tools";
import type { Entity } from "./types";

type UnrollOperation = Extract<ScanToolOperation, { kind: "unroll" }>;
export type UnrollCommandInput =
  | UnrollOperation
  | {
      kind: "unroll";
      cylinderId: string;
      offsetDegrees?: number;
      instances?: number;
    };

/** Exact bodies are candidates; the shared command validates their analytic faces. */
export function isUnrollReferenceCandidate(entity: Entity): boolean {
  return !!entity.kernelId || cylinderReference(entity) !== null;
}

/** Exact CAD is authoritative; display tessellation must not perturb its radius. */
export async function bindUnrollReference(
  input: Extract<UnrollCommandInput, { cylinderId: string }>,
  source: Entity,
  entities: Entity[],
  inspect: (kernelId: string) => Promise<CadAlignmentInput[]>,
  check: () => void,
) {
  if (input.cylinderId === source.id)
    throw Error("Unroll requires a separate cylinder reference.");
  const entity = entities.find((row) => row.id === input.cylinderId);
  if (!entity) throw Error("Choose an existing cylinder reference for Unroll.");
  check();
  let reference = entity.kernelId ? null : cylinderReference(entity);
  let faceIndex: number | undefined;
  if (entity.kernelId) {
    const faces = await inspect(entity.kernelId);
    check();
    const cylinders = faces.filter((face) => face.kind === "cylinder");
    const face = cylinders[0];
    if (
      !face ||
      face.kind !== "cylinder" ||
      cylinders.length !== 1 ||
      faces.some((face) => !["cylinder", "plane"].includes(face.kind))
    )
      throw Error(
        "Unroll requires a single exact cylinder surface, optionally with planar caps.",
      );
    reference = {
      center: [...face.location],
      axis: [...face.axis],
      radius: face.radius,
    };
    faceIndex = face.faceIndex;
  }
  if (
    !reference ||
    ![...reference.center, ...reference.axis, reference.radius].every(
      Number.isFinite,
    ) ||
    reference.radius <= 0 ||
    Math.hypot(...reference.axis) === 0
  )
    throw Error("Choose a valid cylinder reference for Unroll.");
  check();
  return {
    operation: {
      kind: "unroll" as const,
      ...reference,
      ...(input.offsetDegrees !== undefined
        ? { offsetDegrees: input.offsetDegrees }
        : {}),
      ...(input.instances !== undefined ? { instances: input.instances } : {}),
    },
    reference: {
      cylinderEntityId: entity.id,
      referenceKind: entity.kernelId ? "exact-cad" : "construction",
      ...(faceIndex !== undefined ? { faceIndex } : {}),
      ...reference,
    },
  };
}
