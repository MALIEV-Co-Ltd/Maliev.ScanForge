import { CadClient } from "./cad/client";
import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import { analyzeIndexedMesh } from "./mesh-processing";
import { nativeBoundaryWalks } from "./scan-hole-boundary-order";
import { fitBoundaryCurve, type BoundaryCurveFit } from "./scan-boundary-fit";
import { nativeNoiseVertices } from "./scan-native-noise";
import { cleanupBoundaryFacets } from "./scan-boundary-cleanup";
import {
  smoothingRings,
  smoothingTargets,
  publishSmoothingTargets,
} from "./scan-smoothing-kernel";
import {
  checkProgress,
  publishSmoothedVertices,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";

export const BOUNDARY_SMOOTHING_DEFAULTS = {
  strength: 1,
  iterations: 1,
} as const;
interface Projection {
  curve: BoundaryCurveFit;
  point: Float32Array;
}

function* boundarySteps(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): Generator<Projection, ScanEditResult, Float32Array> {
  const strength = r.strength ?? BOUNDARY_SMOOTHING_DEFAULTS.strength;
  const repetitions = r.iterations ?? BOUNDARY_SMOOTHING_DEFAULTS.iterations;
  if (
    !Number.isFinite(strength) ||
    strength < 0 ||
    strength > 1 ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 1 ||
    repetitions > 100
  )
    throw new Error(
      "Boundary smoothing needs strength in [0,1] and 1–100 command repetitions.",
    );
  if (t.degenerateTriangles || t.nonManifoldEdges || t.nonManifoldVertices)
    throw new Error(
      "Boundary smoothing requires a mesh without degenerate triangles or nonmanifold topology; repair the source first.",
    );
  const inventory = [...t.boundaryLoops, ...t.boundaryChains];
  const requested = r.indices ?? inventory.map((_, i) => i);
  if (
    requested.some(
      (i) => !Number.isSafeInteger(i) || i < 0 || i >= inventory.length,
    )
  )
    throw new Error("Selection index is outside the mesh inventory.");
  const selected = new Set(requested.flatMap((i) => inventory[i]));
  const anchors = new Set<number>();
  const requestedBoundaries = new Set(requested);
  const anchoredBoundaries = new Set<number>();
  for (const anchor of r.anchors ?? []) {
    if (
      !anchor ||
      typeof anchor !== "object" ||
      !Number.isSafeInteger(anchor.boundary) ||
      !requestedBoundaries.has(anchor.boundary) ||
      !Number.isSafeInteger(anchor.point) ||
      anchor.point < 0 ||
      anchor.point >= inventory[anchor.boundary].length
    )
      throw new Error(
        "Each anchor must identify a point on a selected boundary.",
      );
    if (anchoredBoundaries.has(anchor.boundary))
      throw new Error("Only one anchor per boundary is currently supported.");
    anchoredBoundaries.add(anchor.boundary);
    anchors.add(inventory[anchor.boundary][anchor.point]);
  }
  const steps = 10 + Math.round(strength * 10);
  let vertices = Float64Array.from(t.vertices, Math.fround),
    fitted = 0,
    unfitted = 0,
    maxFitError = 0,
    outOfTolerance = 0;
  let current = t,
    removedFacets = 0,
    boundaries = 0;
  let faceOrder: Uint32Array | undefined, faceSlots: Int32Array | undefined;
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const walks = nativeBoundaryWalks(current, o.signal)
      .filter((walk) => walk.vertices.some((id) => selected.has(id)))
      .map((walk) => ({
        ...walk,
        faces: walk.faces.map((face) => (faceOrder ? faceOrder[face] : face)),
      }));
    boundaries = Math.max(boundaries, walks.length);
    for (let index = 0; index < walks.length; index++) {
      const walk = walks[index],
        movable = Uint32Array.from(
          walk.vertices.filter((id) => !anchors.has(id)),
        );
      const rings = smoothingRings(current);
      for (let step = 0; step < steps; step++) {
        checkProgress(
          o,
          (repetition + (index + step / steps) / Math.max(1, walks.length)) /
            repetitions,
          "Smoothing boundary vertices",
        );
        vertices = publishSmoothingTargets(
          vertices,
          movable,
          smoothingTargets(
            vertices,
            current.triangles,
            rings,
            movable,
            0.5,
            o.signal,
          ),
        );
      }
      const points = new Float64Array((walk.vertices.length + 1) * 3);
      walk.vertices.forEach((id, i) =>
        points.set(vertices.subarray(id * 3, id * 3 + 3), i * 3),
      );
      points.set(points.subarray(0, 3), walk.vertices.length * 3);
      let curve: BoundaryCurveFit;
      try {
        curve = fitBoundaryCurve(
          points,
          true,
          0.05 + Math.fround(Math.round(strength * 10) / 10) * 0.05,
          { ...o, onProgress: undefined },
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/singular or insufficient|coincident or degenerate/.test(
            error.message,
          )
        )
          throw error;
        unfitted++;
        continue;
      }
      const projected = yield {
        curve,
        point: Float32Array.from(
          vertices.subarray(walk.vertices[0] * 3, walk.vertices[0] * 3 + 3),
        ),
      };
      checkProgress(
        o,
        (repetition + (index + 1) / Math.max(1, walks.length)) / repetitions,
        "Projecting fitted boundary",
      );
      if (
        !(projected instanceof Float32Array) ||
        projected.length !== 3 ||
        projected.some((value) => !Number.isFinite(value))
      )
        throw new Error(
          "Boundary curve returned invalid projected coordinates.",
        );
      // Native whole-loop records keep local index zero and an unchanged point snapshot.
      vertices.set(projected, walk.vertices[0] * 3);
      const recordFaces = walk.faces.map((face) =>
        faceSlots ? faceSlots[face] : face,
      );
      if (recordFaces.some((face) => face < 0))
        throw new Error(
          "Boundary smoothing invalidated a retained face; original geometry retained.",
        );
      const faces = new Uint8Array(current.triangles.length / 3);
      if (recordFaces.length) faces[recordFaces[0]] = 1;
      for (let ring = 0; ring < 2; ring++) {
        const previous = faces.slice();
        for (let f = 0; f < faces.length; f++) {
          if (f % 4096 === 0 && o.signal?.aborted)
            throw new DOMException("Mesh operation cancelled.", "AbortError");
          if (previous[f])
            for (const neighbor of current.neighbors[f]) faces[neighbor] = 1;
        }
      }
      vertices = nativeNoiseVertices(
        { ...current, vertices },
        2,
        faces,
        false,
        { ...o, onProgress: undefined },
      );
      const cleanup = cleanupBoundaryFacets(
        { ...current, vertices },
        recordFaces,
        o.signal,
      );
      if (cleanup.retainedFaces) {
        const previousOrder = faceOrder;
        faceOrder = Uint32Array.from(cleanup.retainedFaces, (face) =>
          previousOrder ? previousOrder[face] : face,
        );
        faceSlots = new Int32Array(t.triangles.length / 3).fill(-1);
        for (let slot = 0; slot < faceOrder.length; slot++)
          faceSlots[faceOrder[slot]] = slot;
        current = analyzeIndexedMesh(vertices, cleanup.triangles, {
          ...o,
          onProgress: undefined,
        });
        removedFacets += cleanup.removed;
      } else current = { ...current, vertices };
      maxFitError = Math.max(maxFitError, curve.maxError);
      if (!curve.toleranceMet) outOfTolerance++;
      fitted++;
    }
  }
  checkProgress(o, 1, "Boundary smoothing complete");
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const sourceCorners = faceOrder
    ? Uint32Array.from(
        { length: faceOrder.length * 3 },
        (_, corner) => faceOrder![Math.floor(corner / 3)] * 3 + (corner % 3),
      )
    : undefined;
  const positions = publishSmoothedVertices(
    r,
    t,
    vertices,
    o,
    current.triangles,
    sourceCorners,
  );
  const changed =
    positions.length !== r.positions.length ||
    positions.some((value, index) => !Object.is(value, r.positions[index]));
  return {
    positions,
    diagnostics: {
      method: "Native boundary smoothing and fitted-curve projection",
      boundaries,
      fittedBoundaries: fitted,
      unfittedBoundaries: unfitted,
      outOfTolerance,
      maxFitError,
      removedFacets,
      iterations: repetitions,
      passesPerBoundary: steps,
      strength,
      changed,
    },
  };
}

export function runBoundarySmooth(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): ScanEditResult {
  const steps = boundarySteps(r, t, o);
  const result = steps.next();
  if (!result.done) {
    steps.return(undefined as never);
    throw new Error("Boundary smoothing requires an asynchronous CAD owner.");
  }
  return result.value;
}

/** GUI and MCP share this request-owned CAD driver and the same publication. */
export async function runBoundarySmoothAsync(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): Promise<ScanEditResult> {
  const steps = boundarySteps(r, t, o);
  let kernel: CadClient | undefined;
  try {
    let result = steps.next();
    while (!result.done) {
      kernel ??= new CadClient();
      const projected = await kernel.boundaryCurveProject(
        result.value.curve,
        result.value.point,
      );
      result = steps.next(projected);
    }
    return result.value;
  } finally {
    kernel?.dispose();
    steps.return(undefined as never);
  }
}
