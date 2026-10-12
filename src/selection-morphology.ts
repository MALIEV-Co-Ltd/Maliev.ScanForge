import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import type { Positions } from "./types";

/** One welded edge ring, respecting hidden triangles as selection barriers. */
export function morphTriangleSelection(
  positions: Positions,
  mask: Uint8Array,
  operation: "grow" | "shrink" | "boundary",
  hidden: readonly number[] = [],
  options: MeshProcessingOptions = {},
): Uint8Array {
  if (!(mask instanceof Uint8Array) || mask.length !== positions.length / 9)
    throw new Error("Selection mask must have one byte per triangle.");
  if (mask.some((value) => value !== 0 && value !== 1))
    throw new Error("Selection mask values must be zero or one.");
  if (!["grow", "shrink", "boundary"].includes(operation))
    throw new Error("Unknown selection morphology operation.");
  if (
    hidden.some(
      (face) => !Number.isInteger(face) || face < 0 || face >= mask.length,
    )
  )
    throw new Error("Hidden triangle index is out of range.");
  if (!positions.length) {
    if (options.signal?.aborted)
      throw new DOMException("Selection cancelled.", "AbortError");
    return new Uint8Array();
  }
  const topology = analyzeMesh(positions, options);
  const hiddenSet = new Set(hidden);
  const visibleMask = new Uint8Array(mask);
  for (const face of hiddenSet) visibleMask[face] = 0;
  const result =
    operation === "boundary"
      ? new Uint8Array(mask.length)
      : new Uint8Array(visibleMask);
  let cursor = 0;
  for (const uses of topology.edges.values()) {
    if (cursor++ % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Selection cancelled.", "AbortError");
    const visible = uses.filter((use) => !hiddenSet.has(use.face));
    if (operation === "boundary") {
      if (visible.length === 1) result[visible[0].face] = 1;
      continue;
    }
    if (operation === "grow") {
      if (visible.some((use) => visibleMask[use.face]))
        for (const use of visible) result[use.face] = 1;
    } else if (uses.some((use) => !visibleMask[use.face])) {
      for (const use of visible) result[use.face] = 0;
    }
  }
  options.onProgress?.(1, "Selection morphology complete");
  return result;
}
