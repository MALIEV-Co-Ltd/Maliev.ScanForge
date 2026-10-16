import { ShapeUtils, Vector2 } from "three";
import type { Vec3 } from "./types";
import type { MeshTopology, MeshProcessingOptions } from "./mesh-processing";
import { analyzeIndexedMesh } from "./mesh-processing";
import {
  bridgeAttachmentNormals,
  bridgeInsideBoundary,
  refineBridgeStrip,
  validBridgePatch,
} from "./scan-bridge-geometry";
import {
  computeAngleWeightedNormals,
  repatchSpatialBoundary,
} from "./scan-defeature-repatch";
import {
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
  finiteOutput,
  inventoryOf,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";

/** Fill a constrained disk with shared rim vertices and density-matched interior facets. */
export function runHoleFill(
  r: ScanEditRequest,
  t: MeshTopology,
  o: MeshProcessingOptions,
): ScanEditResult {
  const ids = r.indices ?? t.boundaryLoops.map((_, i) => i);
  if (
    ids.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= t.boundaryLoops.length,
    )
  )
    throw new Error("Choose closed hole boundaries.");
  const diameter = r.diameter ?? 0;
  if (!Number.isFinite(diameter) || diameter < 0)
    throw new Error("Hole diameter must be finite and nonnegative.");
  if (t.nonManifoldEdges || t.inconsistentEdges)
    throw new Error(
      "Repair nonmanifold edges and inconsistent winding before filling holes.",
    );
  const output: number[] = [],
    inventory = inventoryOf(t);
  const cachedVertices = o.topologyCache ? Array.from(t.vertices) : undefined;
  const cachedTriangles = o.topologyCache ? Array.from(t.triangles) : undefined;
  let filledHoles = 0,
    skippedHoles = 0;
  const methods = new Set<string>();
  checkProgress(o, 0, "Estimating boundary tangents");
  const vertexNormals = computeAngleWeightedNormals(t);
  for (const index of [...new Set(ids)]) {
    checkProgress(
      o,
      filledHoles / Math.max(1, ids.length),
      "Triangulating selected holes",
    );
    if (diameter && inventory.boundaries[index].diameter > diameter) {
      skippedHoles++;
      continue;
    }
    const original = t.boundaryLoops[index];
    let loop = [...original];
    if (r.mode === "partial" || r.mode === "bridge") {
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
      if (r.mode === "partial") {
        loop = [];
        let i = start;
        while (i !== end) {
          loop.push(original[i]);
          i = (i + 1) % original.length;
        }
        loop.push(original[end]);
      } else {
        const nextStart = (start + 1) % original.length,
          nextEnd = (end + 1) % original.length;
        if (new Set([start, nextStart, end, nextEnd]).size !== 4)
          throw new Error("Bridge edges must be separate.");
        // Follow boundary order to create a strip connecting the chosen edge pair.
        loop = [
          original[start],
          original[nextStart],
          original[end],
          original[nextEnd],
        ];
      }
    }
    if (loop.length < 3) {
      skippedHoles++;
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
      skippedHoles++;
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
    if (r.mode === "bridge") {
      const boundary = original.map((id) => {
        const delta = subtract(pointAt(t.vertices, id), points[0]);
        return new Vector2(dotProduct(delta, u), dotProduct(delta, v));
      });
      if (
        !bridgeInsideBoundary(
          boundary,
          loop.map((id) => original.indexOf(id)),
        ) ||
        loop.some(
          (id, i) =>
            (t.edges.get(edgeId(id, loop[(i + 1) % loop.length]))?.length ??
              0) > 1,
        )
      ) {
        skippedHoles++;
        continue;
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
      skippedHoles++;
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
    const method =
      r.algorithm === "automatic" || !r.algorithm
        ? planar && !curvedTangents
          ? "flat"
          : "tangent"
        : r.algorithm;
    if (method === "flat" && !planar) {
      skippedHoles++;
      continue;
    }
    let triangles = ShapeUtils.triangulateShape(projected, []);
    if (triangles.length !== points.length - 2) {
      skippedHoles++;
      continue;
    }
    // A complete flat patch must not double an existing flat surface.
    if (planar) {
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
        skippedHoles++;
        continue;
      }
    }
    const rimCount = points.length;
    const surface = holeSurface(
      points,
      projected,
      boundaryNormals,
      points[0],
      u,
      v,
      unit,
      method,
    );
    // The native spatial routine expects the retained rim direction, unlike
    // the positive projected orientation used by our constrained refinement.
    if (method !== "flat" && (r.mode ?? "entire") === "entire") {
      const patch = repatchSpatialBoundary(t, original, {
        vertexNormals,
        maxIterations: Math.min(10000, Math.max(64, original.length * 8)),
        signal: o.signal,
        onProgress: () => checkProgress(o, 0.25, "Interpolating hole surface"),
      });
      if (patch.completed) {
        const mapping = new Map(loop.map((id, i) => [id, i]));
        const candidatePoints = [...points],
          candidateProjection = [...projected];
        for (let i = 0; i < patch.insertedVertices.length / 3; i++) {
          const p = pointAt(patch.insertedVertices, i),
            delta = subtract(p, points[0]);
          const xy = new Vector2(dotProduct(delta, u), dotProduct(delta, v));
          mapping.set(t.vertices.length / 3 + i, candidatePoints.length);
          candidatePoints.push(surface(xy));
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
      skippedHoles++;
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
    if ((r.mode ?? "entire") === "entire") {
      const refined = refineHolePatch(
        points,
        projected,
        triangles,
        rimCount,
        surface,
        o,
      );
      triangles = refined.triangles;
    }
    if (
      !(splitBridgeRails
        ? validBridgePatch(projected, triangles)
        : validHolePatch(projected, triangles, rimCount))
    ) {
      skippedHoles++;
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
      skippedHoles++;
      continue;
    }
    for (let tri of triangles) {
      if (orient(projected[tri[0]], projected[tri[1]], projected[tri[2]]) < 0)
        tri = [tri[0], tri[2], tri[1]];
      const [a, b, c] = tri.map((i) => points[i]);
      output.push(...a, ...b, ...c);
    }
    if (cachedVertices && cachedTriangles) {
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
    filledHoles++;
  }
  const positions = finiteOutput([...r.positions, ...output]);
  if (o.topologyCache && cachedVertices && cachedTriangles) {
    const topology = analyzeIndexedMesh(
      Float64Array.from(cachedVertices, Math.fround),
      new Uint32Array(cachedTriangles),
      { ...o, onProgress: undefined },
    );
    o.topologyCache.positions = positions;
    o.topologyCache.tolerance = o.tolerance ?? 1e-6;
    o.topologyCache.topology = topology;
  }
  checkProgress(o, 1, "Hole filling complete");
  return {
    positions,
    diagnostics: {
      filledHoles,
      skippedHoles,
      addedTriangles: output.length / 9,
      method: [...methods].join(", ") || "none",
      mode: r.mode ?? "entire",
    },
  };
}
