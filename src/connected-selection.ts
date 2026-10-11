import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import type { Positions } from "./types";

/** Angle mode grows over welded manifold edges; all-connected mode uses the existing edge-component inventory. */
export function growConnectedSelection(
  positions: Positions,
  seeds: Uint8Array,
  options: MeshProcessingOptions & {
    angleDegrees: number;
    allConnected?: boolean;
  },
): Uint8Array {
  if (!(seeds instanceof Uint8Array) || seeds.length !== positions.length / 9)
    throw new Error("Selection mask must have one byte per triangle.");
  if (seeds.some((value) => value !== 0 && value !== 1))
    throw new Error("Selection mask values must be zero or one.");
  if (
    !Number.isFinite(options.angleDegrees) ||
    options.angleDegrees < 0 ||
    options.angleDegrees > 90
  )
    throw new Error(
      "Connected selection angle must be between 0 and 90 degrees.",
    );
  const topology = analyzeMesh(positions, options);
  // Reuse the topology component inventory when angle filtering is disabled.
  if (options.allConnected) {
    const result = new Uint8Array(seeds);
    for (const component of topology.components)
      if (component.some((face) => seeds[face]))
        for (const face of component) result[face] = 1;
    options.onProgress?.(1, "Connected selection complete");
    return result;
  }
  const normals = new Float64Array(seeds.length * 3);
  for (let face = 0; face < seeds.length; face++) {
    if (face % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Selection cancelled.", "AbortError");
    const i = face * 9;
    const ux = positions[i + 3] - positions[i],
      uy = positions[i + 4] - positions[i + 1],
      uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i],
      vy = positions[i + 7] - positions[i + 1],
      vz = positions[i + 8] - positions[i + 2];
    const x = uy * vz - uz * vy,
      y = uz * vx - ux * vz,
      z = ux * vy - uy * vx;
    const length = Math.hypot(x, y, z);
    if (length > 0) {
      normals[face * 3] = x / length;
      normals[face * 3 + 1] = y / length;
      normals[face * 3 + 2] = z / length;
    }
  }
  const result = new Uint8Array(seeds);
  const neighbors = Array.from({ length: seeds.length }, () => [] as number[]);
  const threshold = Math.cos((options.angleDegrees * Math.PI) / 180);
  for (const uses of topology.edges.values()) {
    if (uses.length !== 2) continue;
    const a = uses[0].face,
      b = uses[1].face;
    const dot =
      normals[a * 3] * normals[b * 3] +
      normals[a * 3 + 1] * normals[b * 3 + 1] +
      normals[a * 3 + 2] * normals[b * 3 + 2];
    if (Math.abs(dot) + 1e-12 >= threshold) {
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < seeds.length; i++) if (seeds[i]) queue.push(i);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (cursor % 4096 === 0) {
      if (options.signal?.aborted)
        throw new DOMException("Selection cancelled.", "AbortError");
      options.onProgress?.(
        0.9 + (0.1 * cursor) / seeds.length,
        "Growing connected selection",
      );
    }
    for (const neighbor of neighbors[queue[cursor]])
      if (!result[neighbor]) {
        result[neighbor] = 1;
        queue.push(neighbor);
      }
  }
  options.onProgress?.(1, "Connected selection complete");
  return result;
}
