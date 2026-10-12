import type { MeshTopology, MeshProcessingOptions } from "./mesh-processing";
import {
  repatchSpatialBoundary,
  computeAngleWeightedNormals,
} from "./scan-defeature-repatch";
import {
  retainFacets,
  appendFacets,
  compactIndexedTopology,
} from "./scan-defeature-topology";
import {
  checkProgress,
  crossProduct,
  subtract,
  pointAt,
  finiteOutput,
  edgeId,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";

/** Geometry edits invalidate component summaries while retaining indexed facet adjacency. */
export function runDefeature(
  r: ScanEditRequest,
  original: MeshTopology,
  options: MeshProcessingOptions,
): ScanEditResult {
  const selection = r.selection!;
  if (!selection?.some(Boolean) || selection.every(Boolean))
    throw new Error("Select a bounded patch, leaving surrounding triangles.");
  const marked = new Uint8Array(selection.length);
  let vertexNormals = computeAngleWeightedNormals(original);
  for (let f = 0; f < selection.length; f++)
    if (selection[f])
      for (const adjacent of original.neighbors[f])
        if (!selection[adjacent]) marked[adjacent] = 1;
  checkProgress(options, 0, "Removing selected facets");
  const retained = retainFacets(
    original,
    Uint8Array.from(selection, (v) => Number(!v)),
    { ...options, onProgress: undefined },
  );
  let topology = retained.topology;
  let target = Uint8Array.from(retained.oldFaces, (f) => marked[f]);
  // Retain the largest area component touching the removed patch, preserving
  // unrelated components. Triangle count is not an area comparison.
  const touching = topology.components.filter((component) =>
    component.some((f) => target[f]),
  );
  const area = (component: number[]) =>
    component.reduce((sum, f) => {
      const [a, b, c] = [0, 1, 2].map((k) =>
        pointAt(topology.vertices, topology.triangles[f * 3 + k]),
      );
      return (
        sum + Math.hypot(...crossProduct(subtract(b, a), subtract(c, a))) / 2
      );
    }, 0);
  let largest: number[] | undefined,
    largestArea = -Infinity;
  for (const component of touching) {
    const value = area(component);
    if (value > largestArea) {
      largest = component;
      largestArea = value;
    }
  }
  const keep = new Uint8Array(topology.triangles.length / 3).fill(1);
  for (const component of touching)
    if (component !== largest) for (const f of component) keep[f] = 0;
  const prunedTriangles = keep.reduce((n, v) => n + Number(!v), 0);
  if (prunedTriangles) {
    const next = retainFacets(topology, keep, {
      ...options,
      onProgress: undefined,
    });
    target = Uint8Array.from(next.oldFaces, (f) => target[f]);
    topology = next.topology;
  }
  let attempts = 0,
    filled = 0,
    inserted = 0;
  while (attempts < 2) {
    const loop = topology.boundaryLoops.find((ids) => {
      const rim = ids.map(
        (id, i) =>
          topology.edges.get(edgeId(id, ids[(i + 1) % ids.length]))![0].face,
      );
      const eligible =
        rim.some((f) => target[f]) && rim.every((f) => target[f]);
      // Boundary mask cleanup happens for rejected as well as accepted loops.
      for (const f of rim) target[f] = 0;
      return eligible;
    });
    if (!loop) break;
    attempts++;
    checkProgress(options, 0.2 + attempts * 0.1, "Repatching selected seam");
    const patch = repatchSpatialBoundary(topology, loop, {
      signal: options.signal,
      vertexNormals,
      onProgress: (_, remaining) =>
        checkProgress(
          options,
          0.3 + 0.4 * (1 - remaining / loop.length),
          "Advancing spatial seam",
        ),
    });
    if (!patch.completed)
      throw new Error(
        `Defeature could not close the selected seam (${patch.reason}); the original mesh is retained.`,
      );
    const vertices = new Float64Array(
      topology.vertices.length + patch.insertedVertices.length,
    );
    vertices.set(topology.vertices);
    vertices.set(patch.insertedVertices, topology.vertices.length);
    inserted += patch.insertedVertices.length / 3;
    topology = appendFacets(topology, vertices, patch.triangles, {
      ...options,
      onProgress: undefined,
    });
    // The fill wrapper refreshes normals before another boundary is attempted.
    vertexNormals = computeAngleWeightedNormals(topology);
    // Appended facets have no target bit; existing facets keep their identities.
    const nextTarget = new Uint8Array(topology.triangles.length / 3);
    nextTarget.set(target);
    target = nextTarget;
    filled++;
  }
  if (!filled)
    throw new Error(
      "Selected patch has no closed seam bounded by retained adjacent facets.",
    );
  checkProgress(options, 0.9, "Publishing indexed mesh");
  topology = compactIndexedTopology(topology, {
    ...options,
    onProgress: undefined,
  });
  const positions = finiteOutput(
    Array.from(topology.triangles).flatMap((id) =>
      pointAt(topology.vertices, id),
    ),
  );
  // Store output precision in the indexed representation. Publication transfers
  // only a copy; the worker retains this canonical source and adjacency.
  if (options.topologyCache) {
    options.topologyCache.positions = positions;
    options.topologyCache.tolerance = options.tolerance ?? 1e-6;
    options.topologyCache.topology = topology;
  }
  return {
    positions,
    diagnostics: {
      removedTriangles: selection.reduce((n, v) => n + v, 0),
      prunedTriangles,
      filledHoles: filled,
      fillAttempts: attempts,
      insertedVertices: inserted,
      method:
        "Spatial advancing-corner repatching with retained indexed adjacency",
    },
  };
}
