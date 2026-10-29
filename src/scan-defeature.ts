import type { MeshTopology, MeshProcessingOptions } from "./mesh-processing";
import { repatchCurvatureSurface } from "./scan-defeature-surface";
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
  let retainedSourceFaces = retained.oldFaces;
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
    retainedSourceFaces = next.oldFaces.map((f) => retainedSourceFaces[f]);
    topology = next.topology;
  }
  let attempts = 0,
    filled = 0,
    inserted = 0,
    curvaturePatches = 0,
    fitRms = 0;
  const fallbacks: string[] = [];
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
    const patchOptions = {
      signal: options.signal,
      vertexNormals,
      onProgress: (_: number, remaining: number) =>
        checkProgress(
          options,
          0.3 + 0.4 * (1 - remaining / loop.length),
          "Advancing spatial seam",
        ),
    };
    const surface = repatchCurvatureSurface(topology, loop, patchOptions);
    const patch =
      surface.patch ?? repatchSpatialBoundary(topology, loop, patchOptions);
    if (surface.patch) {
      curvaturePatches++;
      fitRms = Math.max(fitRms, surface.fitRms ?? 0);
    } else fallbacks.push(surface.reason ?? "unsupported surface");
    if (!patch.completed)
      throw new Error(
        `Defeature could not close the selected seam (${patch.reason}; curvature reconstruction: ${surface.reason ?? "unavailable"}); the original mesh is retained.`,
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
  // Welded adjacency guides the patch, but cannot round unrelated source corners.
  const coordinates = new Float32Array(topology.triangles.length * 3);
  let retainedCornersDiffer = false;
  for (let f = 0; f < topology.triangles.length / 3; f++) {
    if (f % 4096 === 0) checkProgress(options, 0.9, "Publishing indexed mesh");
    if (f < retainedSourceFaces.length) {
      const source = retainedSourceFaces[f] * 9;
      for (let i = 0; i < 9; i++) {
        coordinates[f * 9 + i] = r.positions[source + i];
        const vertex = topology.triangles[f * 3 + Math.floor(i / 3)] * 3;
        if (
          !Object.is(
            coordinates[f * 9 + i],
            topology.vertices[vertex + (i % 3)],
          )
        )
          retainedCornersDiffer = true;
      }
    } else {
      for (let corner = 0; corner < 3; corner++) {
        const vertex = topology.triangles[f * 3 + corner] * 3;
        for (let axis = 0; axis < 3; axis++)
          coordinates[f * 9 + corner * 3 + axis] =
            topology.vertices[vertex + axis];
      }
    }
  }
  const positions = finiteOutput(coordinates);
  // Reuse adjacency only when it describes the published corner coordinates.
  if (options.topologyCache) {
    options.topologyCache.positions = positions;
    options.topologyCache.tolerance = options.tolerance ?? 1e-6;
    // Raw retained corners may choose different weld representatives on reopening.
    options.topologyCache.topology = retainedCornersDiffer
      ? undefined
      : topology;
  }
  return {
    positions,
    diagnostics: {
      removedTriangles: selection.reduce((n, v) => n + v, 0),
      prunedTriangles,
      filledHoles: filled,
      fillAttempts: attempts,
      insertedVertices: inserted,
      curvaturePatches,
      curvatureFitRms: fitRms,
      curvatureFallback: fallbacks.join("; "),
      method: curvaturePatches
        ? "Curvature-fitted surface reconstruction with retained indexed adjacency"
        : "Spatial advancing-corner repatching with retained indexed adjacency",
    },
  };
}
