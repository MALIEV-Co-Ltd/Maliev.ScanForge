import type { Positions, Vec3 } from "./types";

function validateTriangles(positions: Positions): void {
  if (positions.length % 9)
    throw new Error("Selection requires complete triangle coordinates.");
  for (let i = 0; i < positions.length; i++)
    if (!Number.isFinite(positions[i]))
      throw new Error("Selection requires finite triangle coordinates.");
}

function validateMask(mask: Uint8Array, triangles?: number): void {
  if (
    !(mask instanceof Uint8Array) ||
    (triangles !== undefined && mask.length !== triangles)
  )
    throw new Error("Selection mask must have one byte per triangle.");
  for (let i = 0; i < mask.length; i++)
    if (mask[i] !== 0 && mask[i] !== 1)
      throw new Error("Selection mask values must be zero or one.");
}

/** Select triangle centroids inside a world-coordinate spherical brush. */
export function selectTriangles(
  positions: Positions,
  center: Vec3,
  radius: number,
  previous?: Uint8Array,
  operation: "add" | "remove" = "add",
): Uint8Array {
  validateTriangles(positions);
  if (
    center.length !== 3 ||
    !center.every(Number.isFinite) ||
    !Number.isFinite(radius) ||
    radius <= 0
  )
    throw new Error("Brush requires a finite XYZ center and positive radius.");
  if (operation !== "add" && operation !== "remove")
    throw new Error("Brush operation must be add or remove.");
  const triangles = positions.length / 9;
  if (previous !== undefined) validateMask(previous, triangles);
  const result = previous
    ? new Uint8Array(previous)
    : new Uint8Array(triangles);
  for (let i = 0; i < positions.length; i += 9) {
    const x = positions[i]! / 3 + positions[i + 3]! / 3 + positions[i + 6]! / 3,
      y = positions[i + 1]! / 3 + positions[i + 4]! / 3 + positions[i + 7]! / 3,
      z = positions[i + 2]! / 3 + positions[i + 5]! / 3 + positions[i + 8]! / 3;
    if (Math.hypot(x - center[0], y - center[1], z - center[2]) <= radius)
      result[i / 9] = operation === "add" ? 1 : 0;
  }
  return result;
}

export function selectionCount(mask: Uint8Array): number {
  validateMask(mask);
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i]!;
  return count;
}

/** Partition triangles in original order, retaining winding and Float32 storage. */
export function partitionTriangles(
  positions: Positions,
  mask: Uint8Array,
): { selected: Float32Array; remainder: Float32Array } {
  validateTriangles(positions);
  validateMask(mask, positions.length / 9);
  // Reject coordinates beyond the output representation rather than emit Infinity.
  for (let i = 0; i < positions.length; i++)
    if (!Number.isFinite(Math.fround(positions[i]!)))
      throw new Error("Triangle coordinates exceed Float32 representation.");
  const count = selectionCount(mask);
  const selected = new Float32Array(count * 9),
    remainder = new Float32Array(positions.length - count * 9);
  let selectedCursor = 0,
    remainderCursor = 0;
  for (let triangle = 0; triangle < mask.length; triangle++)
    for (let coordinate = 0; coordinate < 9; coordinate++) {
      const value = positions[triangle * 9 + coordinate]!;
      if (mask[triangle]) selected[selectedCursor++] = value;
      else remainder[remainderCursor++] = value;
    }
  return { selected, remainder };
}
