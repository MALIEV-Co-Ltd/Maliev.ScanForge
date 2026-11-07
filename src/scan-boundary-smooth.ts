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
    anchors.add(inventory[anchor.boundary][anchor.point]);
  }
  if (
    r.anchors?.length === 2 &&
    r.anchors[0].boundary >= t.boundaryLoops.length
  )
    throw new Error("Two anchors require a closed boundary.");
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
      const walk = walks[index];
      const offsets = walk.vertices.flatMap((id, i) =>
        anchors.has(id) ? [i] : [],
      );
      if (offsets.length === 2) {
        const distance = offsets[1] - offsets[0];
        if (Math.min(distance, walk.vertices.length - distance) < 3)
          throw new Error(
            "Two boundary anchors must leave at least two points between them on each side.",
          );
      }
      const segments =
        offsets.length > 1
          ? offsets.map((start, i) => {
              const end = offsets[(i + 1) % offsets.length];
              const ids: number[] = [],
                faces: number[] = [];
              for (let at = start; ; at = (at + 1) % walk.vertices.length) {
                ids.push(walk.vertices[at]);
                if (at === end) break;
                faces.push(walk.faces[at]);
              }
              return { ids, faces, open: true };
            })
          : [{ ids: walk.vertices, faces: walk.faces, open: false }];
      let walkFitted = false,
        walkUnfitted = false,
        walkOutOfTolerance = false;
      for (const [segmentIndex, segment] of segments.entries()) {
        const movable = Uint32Array.from(
          segment.ids.filter((id) => !anchors.has(id)),
        );
        const rings = smoothingRings(current);
        for (let step = 0; step < steps; step++) {
          checkProgress(
            o,
            (repetition +
              (index +
                (segmentIndex + (0.8 * step) / steps) / segments.length) /
                Math.max(1, walks.length)) /
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
        const points = new Float64Array(
          (segment.ids.length + (segment.open ? 0 : 1)) * 3,
        );
        segment.ids.forEach((id, i) =>
          points.set(vertices.subarray(id * 3, id * 3 + 3), i * 3),
        );
        if (!segment.open)
          points.set(points.subarray(0, 3), segment.ids.length * 3);
        let curve: BoundaryCurveFit;
        try {
          curve = fitBoundaryCurve(
            points,
            !segment.open,
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
          walkUnfitted = true;
          continue;
        }
        const projectionIds = segment.open
          ? segment.ids.slice(1, -1)
          : [walk.vertices[0]];
        for (
          let projectionIndex = 0;
          projectionIndex < projectionIds.length;
          projectionIndex += 128
        ) {
          const chunk = projectionIds.slice(
            projectionIndex,
            projectionIndex + 128,
          );
          const point = new Float32Array(chunk.length * 3);
          chunk.forEach((id, i) =>
            point.set(vertices.subarray(id * 3, id * 3 + 3), i * 3),
          );
          const projected = yield {
            curve,
            point,
          };
          checkProgress(
            o,
            (repetition +
              (index +
                (segmentIndex +
                  0.8 +
                  (0.2 * (projectionIndex + chunk.length)) /
                    projectionIds.length) /
                  segments.length) /
                Math.max(1, walks.length)) /
              repetitions,
            "Projecting fitted boundary",
          );
          if (
            !(projected instanceof Float32Array) ||
            projected.length !== point.length ||
            projected.some((value) => !Number.isFinite(value))
          )
            throw new Error(
              "Boundary curve returned invalid projected coordinates.",
            );
          chunk.forEach((id, i) =>
            vertices.set(projected.subarray(i * 3, i * 3 + 3), id * 3),
          );
        }
        const recordFaces = segment.faces.map((face) =>
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
        if (!curve.toleranceMet) walkOutOfTolerance = true;
        walkFitted = true;
      }
      if (walkFitted) fitted++;
      if (walkUnfitted) unfitted++;
      if (walkOutOfTolerance) outOfTolerance++;
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
