import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { fitBoundaryCurve } from "./scan-boundary-fit";
import { nativeBoundaryWalks } from "./scan-hole-boundary-order";

export interface SpatialBoundaryCurve {
  degree: 3;
  poles: number[];
  knots: number[];
  periodic: boolean;
  maxError: number;
  meanError: number;
  toleranceMet: boolean;
}

/** Fit retained boundary walks without mutating the source mesh or publishing partial output. */
export function fitSpatialBoundaries(
  topology: MeshTopology,
  indices: number[] | undefined,
  tolerance: number,
  options: MeshProcessingOptions = {},
): SpatialBoundaryCurve[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Boundary fitting tolerance must be positive and finite.");
  if (
    topology.degenerateTriangles ||
    topology.nonManifoldEdges ||
    topology.nonManifoldVertices
  )
    throw new Error(
      "Spatial boundary fitting requires nondegenerate manifold topology.",
    );
  const inventory = [...topology.boundaryLoops, ...topology.boundaryChains];
  const selected = indices ?? inventory.map((_, i) => i);
  if (!selected.length) throw new Error("Select at least one boundary.");
  if (selected.length > 1024)
    throw new Error("Spatial sketch exceeds the 1024 boundary limit.");
  if (
    selected.some(
      (i) => !Number.isSafeInteger(i) || i < 0 || i >= inventory.length,
    )
  )
    throw new Error("Selection index is outside the mesh boundary inventory.");
  if (new Set(selected).size !== selected.length)
    throw new Error("Boundary selection indices must be unique.");
  if (selected.some((i) => i >= topology.boundaryLoops.length))
    throw new Error(
      "Spatial boundary fitting currently requires closed boundaries.",
    );
  if (selected.reduce((sum, i) => sum + inventory[i].length, 0) > 200000)
    throw new Error("Spatial sketch exceeds the 200000 boundary point limit.");
  const keys = new Set(selected.map((i) => inventory[i][0]));
  const walks = nativeBoundaryWalks(topology, options.signal).filter((walk) =>
    walk.vertices.some((id) => keys.has(id)),
  );
  if (walks.length !== selected.length || walks.some((walk) => !walk.closed))
    throw new Error(
      "Selected boundaries could not be resolved as closed walks.",
    );
  const curves: SpatialBoundaryCurve[] = [];
  for (const [index, walk] of walks.entries()) {
    if (options.signal?.aborted)
      throw new DOMException("Boundary fitting cancelled.", "AbortError");
    const ids = [...walk.vertices, walk.vertices[0]];
    const points = new Float64Array(ids.length * 3);
    ids.forEach((id, i) =>
      points.set(topology.vertices.subarray(id * 3, id * 3 + 3), i * 3),
    );
    let curve: ReturnType<typeof fitBoundaryCurve>;
    try {
      curve = fitBoundaryCurve(points, true, tolerance, {
        ...options,
        onProgress: undefined,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /Native basis control count/i.test(error.message)
      )
        throw new Error(
          "Spatial boundary fitting exceeds the 32-pole evaluator limit.",
        );
      throw error;
    }
    curves.push({
      degree: 3,
      poles: Array.from(curve.poles),
      knots: curve.knots,
      periodic: curve.periodic,
      maxError: curve.maxError,
      meanError: curve.meanError,
      toleranceMet: curve.toleranceMet,
    });
    options.onProgress?.(
      (index + 1) / walks.length,
      "Fitting spatial boundaries",
    );
  }
  if (options.signal?.aborted)
    throw new DOMException("Boundary fitting cancelled.", "AbortError");
  return curves;
}
