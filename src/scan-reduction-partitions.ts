import {
  analyzeIndexedMesh,
  type MeshProcessingOptions,
  type MeshTopology,
} from "./mesh-processing";
import type { Positions } from "./types";
import {
  normalizeCutFans,
  residentSourceFanQuery,
} from "./scan-edge-directory";

// This is a working-set size, not an input-size limit. Borders stay fixed.
export const REDUCTION_PATCH_TRIANGLES = 8192;

function checkpoint(
  options: MeshProcessingOptions,
  fraction: number,
  stage: string,
) {
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  options.onProgress?.(fraction, stage);
}

function spread(value: number) {
  value = (value | (value << 16)) & 0x030000ff;
  value = (value | (value << 8)) & 0x0300f00f;
  value = (value | (value << 4)) & 0x030c30c3;
  return (value | (value << 2)) & 0x09249249;
}

/** Exact coordinate indexing prevents independent weld representatives moving a seam. */
function patchTopology(
  positions: Float32Array,
  options: MeshProcessingOptions,
): MeshTopology {
  const ids = new Map<string, number>();
  const vertices: number[] = [];
  const triangles = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${positions[i]},${positions[i + 1]},${positions[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = vertices.length / 3;
      ids.set(key, id);
      vertices.push(positions[i], positions[i + 1], positions[i + 2]);
    }
    triangles[i / 3] = id;
  }
  return analyzeIndexedMesh(new Float64Array(vertices), triangles, {
    ...options,
    tolerance: 1e-12,
    topologyCache: undefined,
  });
}

/** Spatial ordering costs eight bytes per input facet; topology is patch-sized. */
export function reduceSpatialMesh(
  positions: Positions,
  target: number,
  options: MeshProcessingOptions,
  reduce: (
    patch: Float32Array,
    target: number,
    topology: MeshTopology,
    progress: (fraction: number) => void,
  ) => Float32Array,
) {
  const original = positions.length / 9;
  if (!original || !Number.isInteger(original))
    throw new Error("Expected complete triangle coordinates.");
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  checkpoint(options, 0, "Preparing bounded polygon reduction");
  for (let i = 0; i < positions.length; i++) {
    if (i % 65536 === 0)
      checkpoint(
        options,
        (0.05 * i) / positions.length,
        "Measuring scan extent",
      );
    const value = Math.fround(positions[i]);
    if (!Number.isFinite(value))
      throw new Error("Mesh coordinates must be finite Float32 values.");
    min[i % 3] = Math.min(min[i % 3], value);
    max[i % 3] = Math.max(max[i % 3], value);
  }
  const order = new Uint32Array(original),
    codes = new Uint32Array(original);
  for (let f = 0; f < original; f++) {
    if (f % 8192 === 0)
      checkpoint(
        options,
        0.05 + (0.05 * f) / original,
        "Ordering spatial patches",
      );
    let code = 0;
    for (let axis = 0; axis < 3; axis++) {
      const center =
        (positions[f * 9 + axis] +
          positions[f * 9 + axis + 3] +
          positions[f * 9 + axis + 6]) /
        3;
      const cell =
        max[axis] === min[axis]
          ? 0
          : Math.max(
              0,
              Math.min(
                1023,
                Math.floor(
                  (1023 * (center - min[axis])) / (max[axis] - min[axis]),
                ),
              ),
            );
      code |= spread(cell) << axis;
    }
    codes[f] = code;
    order[f] = f;
  }
  // Typed sorting avoids per-facet objects; original facet index breaks ties.
  order.sort((a, b) => codes[a] - codes[b] || a - b);
  checkpoint(options, 0.1, "Reducing spatial patches");
  const output = new Float32Array(positions.length);
  const sourceFanValid = residentSourceFanQuery(positions, options);
  let written = 0,
    protectedPatches = 0;
  for (let start = 0; start < original; start += REDUCTION_PATCH_TRIANGLES) {
    const count = Math.min(REDUCTION_PATCH_TRIANGLES, original - start);
    const patch = new Float32Array(count * 9);
    for (let f = 0; f < count; f++)
      for (let c = 0; c < 9; c++)
        patch[f * 9 + c] = positions[order[start + f] * 9 + c];
    const report = (fraction: number) =>
      checkpoint(
        options,
        0.1 + (0.85 * (start + count * fraction)) / original,
        "Reducing spatial patches",
      );
    report(0);
    const initial = patchTopology(patch, { signal: options.signal });
    const topology =
      initial.nonManifoldEdges ||
      initial.inconsistentEdges ||
      initial.duplicateTriangles ||
      initial.degenerateTriangles
        ? undefined
        : normalizeCutFans(initial, sourceFanValid, options);
    let result: Float32Array = patch;
    // Spatial cuts can create disconnected fans at a vertex. Preserve these
    // patches, and any invalid original patches, rather than changing seams.
    if (!topology) protectedPatches++;
    else
      result = reduce(
        patch,
        Math.max(1, Math.ceil((count * target) / original)),
        topology,
        report,
      );
    output.set(result, written);
    written += result.length;
    report(1);
  }
  checkpoint(options, 0.95, "Packing reduced scan");
  const result = output.slice(0, written);
  checkpoint(options, 1, "Polygon reduction complete");
  return { positions: result, protectedPatches };
}
