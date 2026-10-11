import type { Positions } from "./types";

/** A selected region takes precedence; hidden triangles never drive alignment. */
export function alignmentTriangleMask(
  triangles: number,
  selection?: Uint8Array | null,
  hidden: readonly number[] = [],
): Uint8Array | undefined {
  if (selection && selection.length !== triangles)
    throw new Error("Alignment selection does not match the scan.");
  const priority = selection?.some((value) => value !== 0) ?? false;
  if (!priority && hidden.length === 0) return undefined;
  const mask = priority
    ? new Uint8Array(selection!)
    : new Uint8Array(triangles).fill(1);
  for (const index of hidden) {
    if (!Number.isInteger(index) || index < 0 || index >= triangles)
      throw new Error("Invalid hidden alignment triangle.");
    mask[index] = 0;
  }
  return mask;
}

/** Deterministic bounded samples from eligible triangle vertices, without a full subset copy. */
export function sampleAlignmentRegion(
  positions: Positions,
  mask: Uint8Array,
  requested: number,
  checkpoint: () => void = () => {},
): Float64Array {
  if (
    positions.length % 9 ||
    mask.length !== positions.length / 9 ||
    mask.some((value) => value !== 0 && value !== 1)
  )
    throw new Error("Invalid alignment triangle selection.");
  if (!Number.isSafeInteger(requested) || requested < 3)
    throw new Error("Alignment requires at least three samples.");
  let eligible = 0;
  for (let face = 0; face < mask.length; face++) {
    if (face % 4096 === 0) checkpoint();
    if (mask[face]) eligible += 3;
  }
  if (eligible < 3)
    throw new Error("No visible triangles in the alignment region.");
  const count = Math.min(eligible, requested);
  const output = new Float64Array(count * 3);
  let vertex = 0,
    next = 0;
  for (let face = 0; face < mask.length && next < count; face++) {
    if (face % 4096 === 0) checkpoint();
    if (!mask[face]) continue;
    for (let corner = 0; corner < 3; corner++, vertex++) {
      if (vertex !== Math.floor((next * eligible) / count)) continue;
      for (let axis = 0; axis < 3; axis++)
        output[next * 3 + axis] = positions[face * 9 + corner * 3 + axis];
      next++;
      if (next === count) break;
    }
  }
  return output;
}
