import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import type { Positions } from "./types";

/** Resident comparison samples only: no edges, fans, components or adjacency. */
export function weldScanSamples(
  positions: Positions,
  options: MeshProcessingOptions = {},
): Pick<MeshTopology, "vertices" | "triangles"> {
  const tolerance = options.tolerance ?? 1e-6;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  check();
  if (!positions.length || positions.length % 9)
    throw new Error("Expected complete triangle coordinates.");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Weld tolerance must be positive and finite.");
  const cache = options.topologyCache;
  if (
    cache?.positions === positions &&
    cache.tolerance === tolerance &&
    cache.topology
  ) {
    options.onProgress?.(1, "Reusing comparison samples");
    check();
    return {
      vertices: cache.topology.vertices,
      triangles: cache.topology.triangles,
    };
  }
  for (let index = 0; index < positions.length; index++) {
    if (index % 12288 === 0) check();
    if (!Number.isFinite(positions[index]))
      throw new Error("Mesh coordinates must be finite.");
  }
  const vertices: number[] = [],
    triangles = new Uint32Array(positions.length / 3),
    cells = new Map<string, number[]>();
  const origin = [positions[0], positions[1], positions[2]];
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 12288 === 0) {
      check();
      options.onProgress?.(
        i / positions.length,
        "Indexing original comparison samples",
      );
      check();
    }
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    const cx = Math.floor((x - origin[0]) / tolerance),
      cy = Math.floor((y - origin[1]) / tolerance),
      cz = Math.floor((z - origin[2]) / tolerance);
    if (![cx, cy, cz].every(Number.isSafeInteger))
      throw new Error(
        "Coordinate range exceeds weld precision; increase tolerance.",
      );
    let id = -1;
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const candidate of cells.get(
            `${cx + dx},${cy + dy},${cz + dz}`,
          ) ?? []) {
            if (
              Math.hypot(
                vertices[candidate * 3] - x,
                vertices[candidate * 3 + 1] - y,
                vertices[candidate * 3 + 2] - z,
              ) <= tolerance
            ) {
              id = candidate;
              break search;
            }
          }
        }
    if (id < 0) {
      id = vertices.length / 3;
      vertices.push(x, y, z);
      const key = `${cx},${cy},${cz}`,
        cell = cells.get(key);
      if (cell) cell.push(id);
      else cells.set(key, [id]);
    }
    triangles[i / 3] = id;
  }
  check();
  options.onProgress?.(1, "Original comparison samples ready");
  check();
  return { vertices: new Float64Array(vertices), triangles };
}
