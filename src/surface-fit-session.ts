import type { Entity, Positions } from "./types";
import { tessellatePatch, type SurfaceFitResult } from "./surfaces";
import { DEFAULT_FREEFORM_COLOR } from "./appearance";

export interface SurfaceFitSession {
  source: Entity;
  scan: Positions;
  triangles: number;
  preview?: SurfaceFitResult;
}

/** Freeze the selected, visible region without altering triangle slots on the scan. */
export function beginSurfaceFit(
  source: Entity,
  selection: Uint8Array | null,
  hidden: readonly number[],
): SurfaceFitSession {
  if (source.kind !== "mesh" || source.surfacePatch)
    throw new Error("Select a triangle scan to fit a surface.");
  if (!source.positions.length || source.positions.length % 9)
    throw new Error("Scan must contain complete triangles.");
  const count = source.positions.length / 9;
  if (selection && selection.length !== count)
    throw new Error("Triangle selection does not match the scan.");
  if (selection?.some((value) => value !== 0 && value !== 1))
    throw new Error("Triangle selection must be binary.");
  if (
    hidden.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= count,
    )
  )
    throw new Error("Hidden triangle indices must refer to the current scan.");
  const excluded = new Set(hidden);
  const ids: number[] = [];
  for (let i = 0; i < count; i++)
    if (selection?.[i] && !excluded.has(i)) ids.push(i);
  if (!ids.length)
    throw new Error("Select a visible scan region before fitting a surface.");
  const scan = new Float32Array(ids.length * 9);
  for (let i = 0; i < ids.length; i++)
    for (let j = 0; j < 9; j++) {
      const value = source.positions[ids[i] * 9 + j];
      if (!Number.isFinite(value))
        throw new Error("Selected scan coordinates must be finite.");
      scan[i * 9 + j] = value;
      if (!Number.isFinite(scan[i * 9 + j]))
        throw new Error("Selected scan exceeds Float32 coordinate range.");
    }
  return { source, scan, triangles: ids.length };
}

export function surfaceFitSourceUnchanged(
  session: SurfaceFitSession,
  entities: Entity[],
): boolean {
  return entities.some(
    (entity) =>
      entity.id === session.source.id &&
      entity.positions === session.source.positions,
  );
}

export function surfaceFitEntity(
  session: SurfaceFitSession,
  id: string,
  appearance?: { name?: string; color?: string },
): Entity {
  if (!session.preview)
    throw new Error("Apply a surface fit before accepting it.");
  return {
    id,
    name: appearance?.name ?? "Fitted surface",
    kind: "mesh",
    positions: tessellatePatch(session.preview.patch, 32, 32),
    surfacePatch: session.preview.patch,
    surfaceScanId: session.source.id,
    color: appearance?.color ?? DEFAULT_FREEFORM_COLOR,
    visible: true,
    opacity: 1,
  };
}

export function acceptSurfaceFit(
  session: SurfaceFitSession,
  entities: Entity[],
  id: string,
): Entity[] {
  if (!surfaceFitSourceUnchanged(session, entities))
    throw new Error("The scan changed; start a new surface fit.");
  return [...entities, surfaceFitEntity(session, id)];
}
