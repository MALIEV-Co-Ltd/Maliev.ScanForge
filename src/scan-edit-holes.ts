import { ShapeUtils, Vector2 } from "three";
import { holeFillTitle, type HoleFillProgress } from "./hole-fill-progress";
import type { Vec3 } from "./types";
import type { MeshTopology, MeshProcessingOptions } from "./mesh-processing";
import { analyzeIndexedMesh } from "./mesh-processing";
import { fitCurvatureSurface } from "./scan-defeature-surface";
import { fairHolePatch } from "./scan-hole-fair";
import { flatHoleTriangles } from "./scan-hole-flat";
import { nativeHoleBoundaryWalks } from "./scan-hole-boundary-order";
import { holeBoundaryDiameters } from "./scan-hole-diameter";
import {
  bridgeAttachmentNormals,
  bridgeInsideBoundary,
  bridgeIntersectsMesh,
  refineBridgeStrip,
  validBridgePatch,
} from "./scan-bridge-geometry";
import {
  computeAngleWeightedNormals,
  repatchSpatialBoundary,
} from "./scan-defeature-repatch";
import {
  HoleRefinementError,
  boundedHoleSurface,
  holeSurface,
  refineHolePatch,
  validHolePatch,
} from "./scan-hole-refine";
import {
  pointAt,
  subtract,
  crossProduct,
  dotProduct,
  edgeId,
  checkProgress,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";

/** Fill a constrained disk with shared rim vertices and density-matched interior facets. */
export function runHoleFill(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): ScanEditResult {
  if (r.batch && (r.mode ?? "entire") !== "entire")
    throw new Error("Batch filling requires entire holes.");
  if (r.batch && r.algorithm !== undefined && r.algorithm !== "tangent")
    throw new Error(
      "Batch filling uses Tangent; omit the selected-hole algorithm.",
    );
  const requestedAlgorithm = r.batch ? "tangent" : (r.algorithm ?? "automatic");
  if (
    requestedAlgorithm === "surfaceRecovery" &&
    (r.mode ?? "entire") !== "entire"
  )
    throw new Error("Surface recovery requires an entire closed hole.");
  const bridging = r.mode === "bridge";
  const boundaries = bridging
    ? [...t.boundaryLoops, ...t.boundaryChains]
    : t.boundaryLoops;
  const ids = r.indices ?? (bridging ? [0] : t.boundaryLoops.map((_, i) => i));
  const selected = [...new Set(ids)];
  if (bridging && ids.length !== 1)
    throw new Error("A bridge needs exactly one start boundary.");
  if (ids.some((i) => !Number.isInteger(i) || i < 0 || i >= boundaries.length))
    throw new Error(
      bridging
        ? "Choose an exposed start boundary."
        : "Choose closed hole boundaries.",
    );
  const destination = r.endBoundary ?? ids[0];
  if (
    bridging &&
    (!Number.isInteger(destination) ||
      destination < 0 ||
      destination >= boundaries.length)
  )
    throw new Error("Choose an exposed destination boundary.");
  const diameter = bridging ? 0 : (r.diameter ?? 0);
  if (!Number.isFinite(diameter) || diameter < 0)
    throw new Error("Hole diameter must be finite and nonnegative.");
  if (!bridging && (t.nonManifoldEdges || t.inconsistentEdges))
    throw new Error(
      "Repair nonmanifold edges and inconsistent winding before filling holes.",
    );
  const output: number[] = [];
  const diameters =
    diameter && selected.length
      ? holeBoundaryDiameters(t, o.signal)
      : undefined;
  let cachedVertices: number[] | undefined,
    cachedTriangles: number[] | undefined;
  let filledHoles = 0,
    skippedHoles = 0,
    surfaceFitHoles = 0,
    interpolatedSurfaceHoles = 0,
    surfaceBlendFallbackHoles = 0,
    surfaceBlendLimitedHoles = 0,
    boundedFallbackHoles = 0,
    surfaceFitMaxRms = 0;
  const surfaceFallbackReasons = new Set<string>();
  const methods = new Set<string>();
  const batch = !bridging && r.action === "fillHoles";
  const report = o.onProgress;
  const reportBatch = (
    phase: HoleFillProgress["phase"] = "closing",
    internalStage?: string,
  ) => {
    if (o.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const details: HoleFillProgress = {
      kind: "holeFill",
      phase,
      processed: filledHoles + skippedHoles,
      total: selected.length,
      closed: filledHoles,
      skipped: skippedHoles,
    };
    report?.(
      details.processed / Math.max(1, details.total),
      internalStage ?? holeFillTitle(details),
      details,
    );
  };
  // Preserve solver checkpoints for cancellation/diagnostics; the worker presents
  // the stable batch title from details instead of these internal stage names.
  if (batch)
    o = {
      ...o,
      onProgress: (_fraction, stage) => reportBatch("closing", stage),
    };
  const skipHole = () => {
    skippedHoles++;
    if (batch) reportBatch();
  };
  checkProgress(o, 0, "Estimating boundary tangents");
  const vertexNormals =
    bridging || !selected.length
      ? new Float64Array(0)
      : computeAngleWeightedNormals(t);
  for (const index of selected) {
    checkProgress(
      o,
      filledHoles / Math.max(1, ids.length),
      "Triangulating selected holes",
    );
    if (diameters && !(diameters[index] < diameter + 2 ** -23)) {
      skipHole();
      continue;
    }
    let original = boundaries[index];
    const nativeAutomatic =
      requestedAlgorithm === "automatic" && (r.mode ?? "entire") === "entire";
    const nativeTangent =
      (requestedAlgorithm === "tangent" ||
        (nativeAutomatic && original.length <= 40)) &&
      (r.mode ?? "entire") === "entire";
    if (nativeTangent) {
      const wanted = new Set(original);
      const ordered = nativeHoleBoundaryWalks(t, o.signal).find(
        (walk) =>
          walk.length === original.length && walk.every((id) => wanted.has(id)),
      );
      if (!ordered) {
        skipHole();
        continue;
      }
      original = [...ordered];
    }
    let loop = [...original];
    if (bridging) {
      const target = boundaries[destination];
      const start = r.start ?? 0,
        end = r.end ?? Math.floor(target.length / 2);
      const startCount =
        original.length - (index < t.boundaryLoops.length ? 0 : 1);
      const endCount =
        target.length - (destination < t.boundaryLoops.length ? 0 : 1);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < 0 ||
        start >= startCount ||
        end >= endCount
      )
        throw new Error("Choose a valid exposed edge index on each boundary.");
      const firstUses = t.edges.get(
        edgeId(original[start], original[(start + 1) % original.length]),
      );
      const secondUses = t.edges.get(
        edgeId(target[end], target[(end + 1) % target.length]),
      );
      if (firstUses?.length !== 1 || secondUses?.length !== 1)
        throw new Error(
          "Bridge attachments must each be exposed manifold edges.",
        );
      const a = firstUses[0],
        b = secondUses[0];
      loop = [a.to, a.from, b.to, b.from];
      if (new Set(loop).size !== 4)
        throw new Error(
          "Bridge edges must be separate and cannot share a vertex.",
        );
    } else if (r.mode === "partial") {
      const start = r.start ?? 0,
        end = r.end ?? Math.floor(original.length / 2);
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end < 0 ||
        start >= loop.length ||
        end >= loop.length ||
        start === end
      )
        throw new Error(
          "Partial filling needs two different boundary vertex indices.",
        );
      loop = [];
      let i = start;
      while (i !== end) {
        loop.push(original[i]);
        i = (i + 1) % original.length;
      }
      loop.push(original[end]);
    }
    if (loop.length < 3) {
      skipHole();
      continue;
    }
    const first = t.edges.get(edgeId(loop[0], loop[1]))?.[0];
    if (first?.from === loop[0]) loop.reverse();
    const points = loop.map((id) => pointAt(t.vertices, id));
    const n: Vec3 = [0, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      n[0] += (p[1] - q[1]) * (p[2] + q[2]);
      n[1] += (p[2] - q[2]) * (p[0] + q[0]);
      n[2] += (p[0] - q[0]) * (p[1] + q[1]);
    });
    const norm = Math.hypot(...n);
    if (norm < (o.tolerance ?? 1e-6) ** 2) {
      if (bridging)
        throw new Error("Bridge edges form a degenerate or crossing strip.");
      skipHole();
      continue;
    }
    const unit = n.map((v) => v / norm) as Vec3;
    const tangent = crossProduct(
      unit,
      Math.abs(unit[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
    );
    const tn = Math.hypot(...tangent);
    const u = tangent.map((v) => v / tn) as Vec3,
      v = crossProduct(unit, u);
    const projected = points.map(
      (p) =>
        new Vector2(
          dotProduct(subtract(p, points[0]), u),
          dotProduct(subtract(p, points[0]), v),
        ),
    );
    // Preserve any rail already attached to the retained mesh.
    const splitBridgeRails =
      r.mode === "bridge" &&
      ![1, 3].some((i) =>
        t.edges.has(edgeId(loop[i], loop[(i + 1) % loop.length])),
      );
    if (bridging) {
      const boundary = original.map((id) => {
        const delta = subtract(pointAt(t.vertices, id), points[0]);
        return new Vector2(dotProduct(delta, u), dotProduct(delta, v));
      });
      if (
        (index === destination &&
          index < t.boundaryLoops.length &&
          !bridgeInsideBoundary(
            boundary,
            loop.map((id) => original.indexOf(id)),
            false,
          )) ||
        loop.some(
          (id, i) =>
            (t.edges.get(edgeId(id, loop[(i + 1) % loop.length]))?.length ??
              0) > 1 ||
            t.edges.get(edgeId(id, loop[(i + 1) % loop.length]))?.[0]?.from ===
              id,
        )
      ) {
        throw new Error(
          "Bridge crosses the boundary or would create a nonmanifold edge.",
        );
      }
    }
    const orient = (a: Vector2, b: Vector2, c: Vector2) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const eps = (o.tolerance ?? 1e-6) ** 2;
    let unsafe = false;
    for (let i = 0; i < projected.length; i++)
      for (let j = i + 1; j < projected.length; j++) {
        const a = projected[i],
          b = projected[(i + 1) % projected.length],
          c = projected[j],
          d = projected[(j + 1) % projected.length];
        if (j === i + 1 || (i === 0 && j === projected.length - 1)) continue;
        if (
          orient(a, b, c) * orient(a, b, d) <= eps &&
          orient(c, d, a) * orient(c, d, b) <= eps &&
          Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
            Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + Math.sqrt(eps) &&
          Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
            Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + Math.sqrt(eps)
        )
          unsafe = true;
      }
    if (unsafe) {
      if (bridging) throw new Error("Bridge edges form a self-crossing strip.");
      skipHole();
      continue;
    }
    const planar = points.every(
      (p) =>
        Math.abs(dotProduct(subtract(p, points[0]), unit)) <=
        Math.max(o.tolerance ?? 1e-6, 1e-5),
    );
    // A planar rim may surround a curved surface (for example a circular hole
    // in a dome). Coplanar rim coordinates alone must not force a flat cap.
    const boundaryNormals =
      r.mode === "bridge"
        ? bridgeAttachmentNormals(t, loop)
        : loop.map((id) => pointAt(vertexNormals, id));
    const curvedTangents = boundaryNormals.some((normal) => {
      const alignment = dotProduct(normal, unit);
      return alignment > 0.2 && alignment < Math.cos((5 * Math.PI) / 180);
    });
    const method = nativeAutomatic
      ? original.length <= 40
        ? "tangent"
        : "curvature"
      : requestedAlgorithm === "automatic" ||
          requestedAlgorithm === "surfaceRecovery"
        ? planar && !curvedTangents
          ? "flat"
          : "tangent"
        : requestedAlgorithm;
    if (method === "flat" && !planar) {
      if (bridging)
        throw new Error("A flat bridge requires coplanar attachment edges.");
      skipHole();
      continue;
    }
    let triangles = ShapeUtils.triangulateShape(projected, []);
    const nativeFlat =
      r.algorithm === "flat" && (r.mode ?? "entire") === "entire";
    if (nativeFlat) {
      const patch = flatHoleTriangles(t, original, unit, o.signal);
      if (!patch) {
        skipHole();
        continue;
      }
      const mapping = new Map(loop.map((id, i) => [id, i]));
      triangles = patch.map((face) => face.map((id) => mapping.get(id)!));
    }
    if (triangles.length !== points.length - 2) {
      if (bridging) throw new Error("Bridge edges cannot form a valid strip.");
      skipHole();
      continue;
    }
    // A complete flat patch must not double an existing flat surface.
    if (planar && !bridging) {
      let overlap = false;
      for (let face = 0; face < t.triangles.length / 3; face++) {
        if (face % 4096 === 0) checkProgress(o, 0, "Checking cap overlap");
        const vertices = [0, 1, 2].map((c) =>
          pointAt(t.vertices, t.triangles[face * 3 + c]),
        );
        if (
          !vertices.every(
            (p) => Math.abs(dotProduct(subtract(p, points[0]), unit)) <= 1e-5,
          )
        )
          continue;
        const center = vertices[0].map(
          (value, axis) => (value + vertices[1][axis] + vertices[2][axis]) / 3,
        ) as Vec3;
        const delta = subtract(center, points[0]),
          x = dotProduct(delta, u),
          y = dotProduct(delta, v);
        let inside = false;
        for (
          let i = 0, j = projected.length - 1;
          i < projected.length;
          j = i++
        ) {
          const a = projected[i],
            b = projected[j];
          if (
            a.y > y !== b.y > y &&
            x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
          )
            inside = !inside;
        }
        if (inside) {
          overlap = true;
          break;
        }
      }
      if (overlap) {
        skipHole();
        continue;
      }
    }
    const rimCount = points.length;
    let surface = holeSurface(
      points,
      projected,
      boundaryNormals,
      points[0],
      u,
      v,
      unit,
      method,
    );
    let interpolatedSurface = false;
    let blendFallback = false,
      blendLimited = false;
    let supportBounds: [number, number] | undefined;
    let fittedRms: number | undefined,
      fallbackReason = "";
    if (
      !bridging &&
      (r.mode ?? "entire") === "entire" &&
      method !== "flat" &&
      requestedAlgorithm === "surfaceRecovery"
    ) {
      const fitted = fitCurvatureSurface(t, original, {
        signal: o.signal,
        interpolate: true,
        vertexNormals,
      });
      if (fitted.surface) {
        const model = fitted.surface;
        interpolatedSurface = !!model.interpolated;
        if (interpolatedSurface)
          supportBounds = model.heightBounds(unit, points[0]);
        surface = (p) => {
          const world = points[0].map(
            (value, k) => value + u[k] * p.x + v[k] * p.y,
          ) as Vec3;
          return model.evaluate(model.project(world));
        };
        fittedRms = model.fitRms;
      } else {
        surface = boundedHoleSurface(points, projected, points[0], u, v, unit);
        fallbackReason = fitted.reason ?? "unsupported surrounding surface";
      }
    }
    // The native spatial routine expects the retained rim direction, unlike
    // the positive projected orientation used by our constrained refinement.
    if (
      method !== "flat" &&
      !fallbackReason &&
      (r.mode ?? "entire") === "entire"
    ) {
      const patch = repatchSpatialBoundary(t, original, {
        vertexNormals,
        maxIterations: nativeTangent
          ? 10000
          : Math.min(10000, Math.max(64, original.length * 8)),
        signal: o.signal,
        onProgress: () => checkProgress(o, 0.25, "Interpolating hole surface"),
      });
      if (nativeTangent && !patch.completed) {
        if (selected.length <= 1)
          throw new HoleRefinementError(
            `Tangent filling could not close the boundary (${patch.reason}); the hole was left unchanged.`,
          );
        skipHole();
        continue;
      }
      if (patch.completed) {
        const mapping = new Map(loop.map((id, i) => [id, i]));
        const candidatePoints = [...points],
          candidateProjection = [...projected];
        for (let i = 0; i < patch.insertedVertices.length / 3; i++) {
          const p = pointAt(patch.insertedVertices, i),
            delta = subtract(p, points[0]);
          const xy = new Vector2(dotProduct(delta, u), dotProduct(delta, v));
          mapping.set(t.vertices.length / 3 + i, candidatePoints.length);
          candidatePoints.push(nativeTangent ? p : surface(xy));
          candidateProjection.push(xy);
        }
        const candidate: number[][] = [];
        for (let i = 0; i < patch.triangles.length; i += 3)
          candidate.push(
            [0, 1, 2].map((k) => mapping.get(patch.triangles[i + k])!),
          );
        if (validHolePatch(candidateProjection, candidate, rimCount)) {
          points.push(...candidatePoints.slice(rimCount));
          projected.push(...candidateProjection.slice(rimCount));
          triangles = candidate;
        } else if (nativeTangent) {
          if (selected.length <= 1)
            throw new HoleRefinementError(
              "Tangent filling produced an invalid cap; the hole was left unchanged.",
            );
          skipHole();
          continue;
        }
      }
    }
    triangles = triangles.map((tri) =>
      orient(projected[tri[0]], projected[tri[1]], projected[tri[2]]) < 0
        ? [tri[0], tri[2], tri[1]]
        : tri,
    );
    if (
      !(splitBridgeRails
        ? validBridgePatch(projected, triangles)
        : validHolePatch(projected, triangles, rimCount))
    ) {
      if (bridging) throw new Error("Bridge strip triangulation is invalid.");
      skipHole();
      continue;
    }
    if (r.mode === "bridge" && method !== "flat") {
      if (splitBridgeRails)
        triangles = refineBridgeStrip(
          points,
          projected,
          boundaryNormals,
          unit,
          o,
          method,
        );
      else {
        const center = projected
          .reduce((sum, p) => sum.add(p), new Vector2())
          .multiplyScalar(0.25);
        projected.push(center);
        points.push(surface(center));
        triangles = [
          [0, 1, 4],
          [1, 2, 4],
          [2, 3, 4],
          [3, 0, 4],
        ];
      }
    }
    // Partial arcs retain their chord contract; bridge rails are refined separately.
    if ((r.mode ?? "entire") === "entire" && !nativeFlat && !nativeTangent) {
      // Cap interior diagonals must not reuse edges already inside the retained
      // mesh. Such edges would acquire extra incident faces or duplicate facets.
      const forbiddenEdges = new Set<string>();
      for (let a = 0; a < rimCount; a++) {
        if (a % 128 === 0)
          checkProgress(o, 0, "Constraining hole triangulation");
        for (let b = a + 2; b < rimCount; b++) {
          if (a === 0 && b === rimCount - 1) continue;
          if (t.edges.has(edgeId(loop[a], loop[b])))
            forbiddenEdges.add(edgeId(a, b));
        }
      }
      try {
        const refined = refineHolePatch(
          points,
          projected,
          triangles,
          rimCount,
          surface,
          o,
          forbiddenEdges,
        );
        triangles = refined.triangles;
        if (interpolatedSurface) {
          const blended = fairHolePatch(
            t,
            loop,
            points,
            projected,
            triangles,
            u,
            v,
            unit,
            boundaryNormals,
            surface,
            o,
            supportBounds,
          );
          blendFallback = !blended.applied;
          blendLimited = blended.limitedVertices > 0;
        }
      } catch (error) {
        if (
          selected.length <= 1 ||
          o.signal?.aborted ||
          !(error instanceof HoleRefinementError)
        )
          throw error;
        // Refinement changes only this hole's local patch. Nothing has been
        // appended to output or the successor topology until it succeeds.
        skipHole();
        continue;
      }
    }
    if (
      !(splitBridgeRails
        ? validBridgePatch(projected, triangles)
        : validHolePatch(projected, triangles, rimCount))
    ) {
      if (bridging)
        throw new Error("Bridge refinement creates an invalid strip.");
      skipHole();
      continue;
    }
    if (
      triangles.some((tri) => {
        const [a, b, c] = tri.map((id) => points[id].map(Math.fround) as Vec3);
        return !(
          dotProduct(crossProduct(subtract(b, a), subtract(c, a)), unit) > eps
        );
      })
    ) {
      if (bridging)
        throw new Error("Bridge creates degenerate or inverted facets.");
      skipHole();
      continue;
    }
    if (bridging && bridgeIntersectsMesh(t, points, triangles, loop, o))
      throw new Error("Bridge intersects the retained scan surface.");
    for (let tri of triangles) {
      if (orient(projected[tri[0]], projected[tri[1]], projected[tri[2]]) < 0)
        tri = [tri[0], tri[2], tri[1]];
      const [a, b, c] = tri.map((i) => points[i]);
      output.push(...a, ...b, ...c);
    }
    if (o.topologyCache) {
      cachedVertices ??= Array.from(t.vertices);
      cachedTriangles ??= Array.from(t.triangles);
      const mapping = new Map(loop.map((id, i) => [i, id]));
      for (const tri of triangles)
        for (const id of tri) {
          if (!mapping.has(id)) {
            mapping.set(id, cachedVertices.length / 3);
            cachedVertices.push(...points[id]);
          }
          cachedTriangles.push(mapping.get(id)!);
        }
    }
    methods.add(method);
    if (fittedRms !== undefined) {
      surfaceFitHoles++;
      if (interpolatedSurface) interpolatedSurfaceHoles++;
      if (blendFallback) surfaceBlendFallbackHoles++;
      if (blendLimited) surfaceBlendLimitedHoles++;
      surfaceFitMaxRms = Math.max(surfaceFitMaxRms, fittedRms);
    }
    if (fallbackReason) {
      boundedFallbackHoles++;
      surfaceFallbackReasons.add(fallbackReason);
    }
    filledHoles++;
    if (batch) reportBatch();
  }
  if (batch) reportBatch("finalizing");
  let positions: Float32Array | undefined;
  if (!output.length)
    positions = r.positions instanceof Float32Array ? r.positions : undefined;
  else {
    positions = new Float32Array(r.positions.length + output.length);
    positions.set(r.positions);
    positions.set(output, r.positions.length);
    if (positions.some((value) => !Number.isFinite(value)))
      throw new Error("Coordinates exceed Float32 output precision.");
  }
  if (o.topologyCache && cachedVertices && cachedTriangles) {
    // Appending a patch preserves every existing edge use. Copy the map, sharing
    // untouched immutable records, and copy only arrays receiving a new face.
    // If Float32 output changes old coordinates, refresh from scratch so newly
    // degenerate facets cannot retain stale adjacency.
    const edges = t.vertices.every((value) => Math.fround(value) === value)
      ? new Map(t.edges)
      : undefined;
    if (edges) {
      for (
        let corner = t.triangles.length;
        corner < cachedTriangles.length;
        corner += 3
      ) {
        for (let k = 0; k < 3; k++) {
          const from = cachedTriangles[corner + k],
            to = cachedTriangles[corner + ((k + 1) % 3)];
          const key = edgeId(from, to),
            uses = edges.get(key) ?? [];
          edges.set(key, [...uses, { face: corner / 3, from, to }]);
        }
      }
    }
    const topology = analyzeIndexedMesh(
      Float64Array.from(cachedVertices, Math.fround),
      new Uint32Array(cachedTriangles),
      { ...o, onProgress: undefined },
      edges,
    );
    o.topologyCache.positions = positions;
    o.topologyCache.tolerance = o.tolerance ?? 1e-6;
    o.topologyCache.topology = topology;
  }
  if (batch) reportBatch("complete");
  else checkProgress(o, 1, "Hole filling complete");
  return {
    positions,
    diagnostics: {
      algorithm: requestedAlgorithm,
      batch: !!r.batch,
      changed: filledHoles > 0,
      filledHoles,
      skippedHoles,
      addedTriangles: output.length / 9,
      surfaceFitHoles,
      interpolatedSurfaceHoles,
      surfaceBlendFallbackHoles,
      surfaceBlendLimitedHoles,
      surfaceFitMaxRms,
      boundedFallbackHoles,
      surfaceFallbackReasons: [...surfaceFallbackReasons].join("; "),
      method: [...methods].join(", ") || "none",
      mode: r.mode ?? "entire",
    },
  };
}
