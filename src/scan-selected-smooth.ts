import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import {
  publishSmoothingTargets,
  smoothingRings,
  smoothingSelection,
  smoothingTargets,
} from "./scan-smoothing-kernel";
export function smoothSelectedVertices(
  topology: MeshTopology,
  selection: Uint8Array,
  iterations: number,
  strength: number,
  options: MeshProcessingOptions,
): Float64Array<ArrayBuffer> {
  let vertices = Float64Array.from(topology.vertices, Math.fround);
  const rings = smoothingRings(topology),
    movable = smoothingSelection(topology.triangles, selection);
  for (let step = 0; step < iterations; step++) {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    options.onProgress?.(step / iterations, "Smoothing selected vertices");
    vertices = publishSmoothingTargets(
      vertices,
      movable,
      smoothingTargets(
        vertices,
        topology.triangles,
        rings,
        movable,
        strength,
        options.signal,
      ),
    );
  }
  return vertices;
}
