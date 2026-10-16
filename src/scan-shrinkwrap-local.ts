import { analyzeMesh, type MeshTopology } from "./mesh-processing";
import { Vector2 } from "three";
import { holeSurface } from "./scan-hole-refine";
import { computeAngleWeightedNormals } from "./scan-defeature-repatch";
import { fitCurvatureSurface } from "./scan-defeature-surface";
import { runHoleFill } from "./scan-edit-holes";
import {
  checkProgress as reportProgress,
  crossProduct,
  subtract,
  pointAt,
  edgeId,
} from "./scan-edit";
import type { Positions, Vec3 } from "./types";
import type { ScanToolResult } from "./scan-tools-reduction";
import type { ShrinkwrapOptions } from "./scan-shrinkwrap";

type Face = [number, number, number];
const CAP = 500_000;
function checkProgress(
  options: ShrinkwrapOptions,
  fraction: number,
  stage: string,
) {
  reportProgress(options, fraction, stage);
  if (options.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
}
const pointKey = (p: ArrayLike<number>, i: number) =>
  `${p[i]},${p[i + 1]},${p[i + 2]}`;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...subtract(a, b));
export function localBoundaryRadius(points: readonly Vec3[], center: Vec3) {
  let radius = 0;
  for (const p of points) radius = Math.max(radius, distance(p, center));
  return radius;
}
function validTopology(t: MeshTopology) {
  if (
    t.degenerateTriangles ||
    t.duplicateTriangles ||
    t.nonManifoldEdges ||
    t.nonManifoldVertices ||
    t.inconsistentEdges
  )
    throw new Error(
      "Repair invalid selected topology before local ShrinkWrap.",
    );
}

/** Conforming source-facet refinement and local hole repair. Original facets are
 * retained geometrically: no nearest-point projection can jump to another sheet.
 * Outside facets are copied first, in original relative order, without arithmetic.
 * Shared boundary edges remain unsplit; thickness vanishes at shared vertices. */
export function shrinkwrapLocalMesh(
  positions: Positions,
  options: ShrinkwrapOptions,
): ScanToolResult {
  checkProgress(options, 0, "Admitting local ShrinkWrap");
  const spacing = options.sampleInterval ?? 0.5,
    gap = options.gapFill ?? 0,
    thickness = options.extraThickness ?? 0,
    deviation = options.maxDeviation ?? 0.1;
  if (
    !Number.isFinite(spacing) ||
    spacing <= 0 ||
    !Number.isFinite(deviation) ||
    deviation <= 0 ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    !Number.isFinite(thickness) ||
    thickness < 0
  )
    throw new Error(
      "ShrinkWrap spacing/deviation must be positive; gap/thickness must be nonnegative and finite.",
    );
  if (
    options.organicShape !== undefined &&
    typeof options.organicShape !== "boolean"
  )
    throw new Error("Organic shape must be boolean.");
  if (options.scope !== "selected" && options.scope !== "isolated")
    throw new Error("Local ShrinkWrap requires selected or isolated scope.");
  if (options.targets?.length)
    throw new Error("Local scope cannot include additional targets.");
  if (!positions.length || positions.length % 9)
    throw new Error("Expected complete triangle coordinates.");
  const mask = options.selection;
  if (
    !(mask instanceof Uint8Array) ||
    mask.length !== positions.length / 9 ||
    mask.some((x) => x > 1)
  )
    throw new Error(
      "Local selection mask must have one binary entry per source triangle.",
    );
  const count = mask.reduce((sum, x) => sum + x, 0);
  if (!count)
    throw new Error(
      "The selected triangle region is empty; select a nonempty region.",
    );
  if (count > CAP)
    throw new Error(
      "Local ShrinkWrap supports at most 500,000 selected triangles; select a smaller region.",
    );
  const selected = new Float32Array(count * 9);
  const outsideCount = mask.length - count;
  let cursor = 0;
  for (let f = 0; f < mask.length; f++) {
    if (f % 4096 === 0)
      checkProgress(options, 0.03, "Reading selected source facets");
    for (let k = 0; k < 9; k++) {
      const value = positions[f * 9 + k];
      if (!Number.isFinite(value))
        throw new Error("Source coordinates must be finite.");
      if (Math.fround(value) !== value)
        throw new Error(
          "Local ShrinkWrap requires Float32-representable parent coordinates to preserve unchanged geometry.",
        );
      if (mask[f]) {
        selected[cursor++] = value;
      }
    }
  }
  // Only selected topology is resident; the parent is streamed once to discover
  // shared vertices. This avoids a whole multi-million-face adjacency graph.
  let topology = analyzeMesh(selected, {
    signal: options.signal,
    tolerance: 1e-12,
  });
  validTopology(topology);
  const vertexKeys = new Map<string, number>();
  for (let i = 0; i < topology.vertices.length; i += 3)
    vertexKeys.set(pointKey(topology.vertices, i), i / 3);
  for (let i = 0; i < selected.length; i += 3)
    if (!vertexKeys.has(pointKey(selected, i)))
      throw new Error(
        "Selected vertices are too close for exact fixed-seam topology; repair them first.",
      );
  const seamVertices = new Set<number>();
  for (let f = 0; f < mask.length; f++) {
    if (f % 4096 === 0)
      checkProgress(options, 0.1, "Resolving fixed parent seam");
    if (!mask[f])
      for (let c = 0; c < 3; c++) {
        const id = vertexKeys.get(pointKey(positions, f * 9 + c * 3));
        if (id !== undefined) seamVertices.add(id);
      }
  }
  const seamKeys = new Set(
    [...seamVertices].map((id) => pointKey(topology.vertices, id * 3)),
  );
  const fixedEdges = new Set<string>();
  for (const [key, uses] of topology.edges)
    if (
      uses.length === 1 &&
      seamVertices.has(uses[0].from) &&
      seamVertices.has(uses[0].to)
    )
      fixedEdges.add(key);
  const components = topology.components.length;
  const eligible = topology.boundaryLoops.flatMap((loop, index) =>
    loop.every((id) => !seamVertices.has(id)) ? [index] : [],
  );
  const organicSurfaces: {
    center: Vec3;
    radius: number;
    evaluate: (p: Vec3) => Vec3;
  }[] = [];
  if (options.organicShape && gap > 0) {
    const normals = computeAngleWeightedNormals(topology);
    for (const index of eligible) {
      const loop = topology.boundaryLoops[index],
        points = loop.map((id) => pointAt(topology.vertices, id));
      const center = points.reduce(
        (sum, p) => sum.map((v, k) => v + p[k] / points.length) as Vec3,
        [0, 0, 0],
      );
      const radius = localBoundaryRadius(points, center);
      if (radius * 2 > gap * 1.01) continue;
      const fitted = fitCurvatureSurface(topology, loop, {
        signal: options.signal,
      });
      if (fitted.surface) {
        const model = fitted.surface;
        organicSurfaces.push({
          center,
          radius,
          evaluate: (p) => model.evaluate(model.project(p)),
        });
      } else {
        const normal = points.reduce(
          (sum, p, i) => {
            const n = crossProduct(
              subtract(points[(i + 1) % points.length], center),
              subtract(p, center),
            );
            return sum.map((v, k) => v + n[k]) as Vec3;
          },
          [0, 0, 0],
        );
        const length = Math.hypot(...normal);
        if (!length) continue;
        const unit = normal.map((x) => x / length) as Vec3;
        const tangent = crossProduct(
          unit,
          Math.abs(unit[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0],
        );
        const u = tangent.map((x) => x / Math.hypot(...tangent)) as Vec3,
          v = crossProduct(unit, u);
        const project = (p: Vec3) => {
          const delta = subtract(p, center);
          return new Vector2(
            delta.reduce((sum, x, k) => sum + x * u[k], 0),
            delta.reduce((sum, x, k) => sum + x * v[k], 0),
          );
        };
        const surface = holeSurface(
          points,
          points.map(project),
          loop.map((id) => pointAt(normals, id)),
          center,
          u,
          v,
          unit,
          "tangent",
        );
        organicSurfaces.push({
          center,
          radius,
          evaluate: (p) => surface(project(p)),
        });
      }
    }
  }
  let filledHoles = 0,
    generatedSource = 0;
  if (gap > 0 && eligible.length) {
    const filled = runHoleFill(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions: selected,
        indices: eligible,
        diameter: gap,
        algorithm: options.organicShape ? "automatic" : "flat",
      },
      topology,
      { signal: options.signal, tolerance: 1e-12 },
    );
    filledHoles = Number(filled.diagnostics.filledHoles ?? 0);
    if (filled.positions && filled.positions.length > selected.length) {
      generatedSource = (filled.positions.length - selected.length) / 9;
      topology = analyzeMesh(filled.positions, {
        signal: options.signal,
        tolerance: 1e-12,
      });
      validTopology(topology);
    }
  }
  const vertices: Vec3[] = Array.from(
    { length: topology.vertices.length / 3 },
    (_, i) => pointAt(topology.vertices, i),
  );
  const fixed = new Set<number>();
  vertices.forEach((p, i) => {
    if (seamKeys.has(pointKey(p, 0))) fixed.add(i);
  });
  // Remap exact seam edges after a fill topology rebuild.
  fixedEdges.clear();
  for (const [key, uses] of topology.edges)
    if (uses.length === 1 && fixed.has(uses[0].from) && fixed.has(uses[0].to))
      fixedEdges.add(key);
  const sizes = vertices.map(() => spacing);
  for (const key of fixedEdges) {
    const [a, b] = key.split(":").map(Number),
      length = distance(vertices[a], vertices[b]);
    sizes[a] = Math.max(sizes[a], length);
    sizes[b] = Math.max(sizes[b], length);
  }
  let faces: Face[] = [];
  let generatedFlags: boolean[] = [];
  // One interior seed allows a nonzero offset even on a one-triangle selection.
  for (let f = 0; f < topology.triangles.length; f += 3) {
    const [a, b, c] = Array.from(topology.triangles.slice(f, f + 3));
    const center = vertices[a].map(
      (x, k) => (x + vertices[b][k] + vertices[c][k]) / 3,
    ) as Vec3;
    const m = vertices.length;
    vertices.push(center);
    sizes.push(spacing);
    faces.push([a, b, m], [b, c, m], [c, a, m]);
    generatedFlags.push(f / 3 >= count, f / 3 >= count, f / 3 >= count);
  }
  if (faces.length > CAP)
    throw new Error(
      "Local sample interval exceeds the 500,000 generated triangle budget; select a smaller region.",
    );
  for (let pass = 0; pass < 24; pass++) {
    checkProgress(
      options,
      0.25 + pass * 0.015,
      "Refining selected surface at requested spacing",
    );
    const splits = new Map<string, number>();
    for (const face of faces)
      for (let k = 0; k < 3; k++) {
        const a = face[k],
          b = face[(k + 1) % 3],
          key = edgeId(a, b);
        if (
          fixedEdges.has(key) ||
          splits.has(key) ||
          distance(vertices[a], vertices[b]) <=
            Math.max(spacing, (sizes[a] + sizes[b]) * 0.75) * 1.000001
        )
          continue;
        const id = vertices.length;
        splits.set(key, id);
        vertices.push(
          vertices[a].map((x, j) => (x + vertices[b][j]) / 2) as Vec3,
        );
        sizes.push((sizes[a] + sizes[b]) / 2);
        if (vertices.length > CAP)
          throw new Error(
            "Local sample interval exceeds the vertex budget; select a smaller region.",
          );
      }
    if (!splits.size) break;
    const next: Face[] = [],
      nextFlags: boolean[] = [];
    let faceIndex = 0;
    for (const [a, b, c] of faces) {
      const start = next.length;
      const ab = splits.get(edgeId(a, b)),
        bc = splits.get(edgeId(b, c)),
        ca = splits.get(edgeId(c, a));
      if (ab !== undefined && bc !== undefined && ca !== undefined)
        next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      else if (ab !== undefined && bc !== undefined)
        next.push([ab, b, bc], [a, ab, c], [ab, bc, c]);
      else if (bc !== undefined && ca !== undefined)
        next.push([bc, c, ca], [b, bc, a], [bc, ca, a]);
      else if (ca !== undefined && ab !== undefined)
        next.push([ca, a, ab], [c, ca, b], [ca, ab, b]);
      else if (ab !== undefined) next.push([a, ab, c], [ab, b, c]);
      else if (bc !== undefined) next.push([b, bc, a], [bc, c, a]);
      else if (ca !== undefined) next.push([c, ca, b], [ca, a, b]);
      else next.push([a, b, c]);
      for (let k = start; k < next.length; k++)
        nextFlags.push(generatedFlags[faceIndex]);
      faceIndex++;
    }
    if (next.length > CAP)
      throw new Error(
        "Local sample interval exceeds the 500,000 generated triangle budget; select a smaller region.",
      );
    faces = next;
    generatedFlags = nextFlags;
    if (pass === 23)
      throw new Error(
        "Requested spacing cannot be accommodated at the fixed seam; grow the selection.",
      );
  }
  const supported = new Uint8Array(vertices.length);
  faces.forEach((face, i) => {
    if (!generatedFlags[i]) for (const id of face) supported[id] = 1;
  });
  if (options.organicShape && generatedSource > 0) {
    vertices.forEach((p, id) => {
      if (supported[id]) return;
      const model = organicSurfaces.reduce<
        (typeof organicSurfaces)[number] | undefined
      >(
        (best, candidate) =>
          !best ||
          distance(p, candidate.center) / candidate.radius <
            distance(p, best.center) / best.radius
            ? candidate
            : best,
        undefined,
      );
      if (model) vertices[id] = model.evaluate(p);
    });
  }
  // Offset is a graph-distance taper into the selected region. Every source rim
  // shared with the parent remains exactly fixed, including point-only contacts.
  const normals = vertices.map(() => [0, 0, 0] as Vec3);
  const adjacency = vertices.map(() => new Set<number>());
  for (const [a, b, c] of faces) {
    const n = crossProduct(
      subtract(vertices[b], vertices[a]),
      subtract(vertices[c], vertices[a]),
    );
    for (const id of [a, b, c])
      for (let k = 0; k < 3; k++) normals[id][k] += n[k];
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      adjacency[u].add(v);
      adjacency[v].add(u);
    }
  }
  const distances = new Float64Array(vertices.length).fill(Infinity);
  // A bounded priority heap gives O(E log V) seam-distance propagation.
  const heap: [number, number][] = [];
  const push = (entry: [number, number]) => {
    let i = heap.length;
    heap.push(entry);
    while (i) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= entry[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const result = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0])
          child++;
        if (heap[child][0] >= last[0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = last;
    }
    return result;
  };
  for (const id of fixed) {
    distances[id] = 0;
    push([0, id]);
  }
  const transition = Math.max(spacing * 2, thickness * 2);
  while (heap.length) {
    const [d, id] = pop();
    if (d !== distances[id] || d >= transition) continue;
    for (const other of adjacency[id]) {
      const next = d + distance(vertices[id], vertices[other]);
      if (next < distances[other]) {
        distances[other] = next;
        push([next, other]);
      }
    }
  }
  let achievedDeviation = 0,
    maxOffset = 0;
  const outputVertices = vertices.map((p, id) => {
    if (id % 4096 === 0)
      checkProgress(options, 0.8, "Fitting local offset with fixed seam");
    const norm = Math.hypot(...normals[id]);
    const amount = thickness * Math.min(1, distances[id] / transition);
    if (amount > 0 && !norm)
      throw new Error(
        "Local offset has ambiguous normals; repair or grow the selection.",
      );
    const target = p.map(
      (x, k) => x + (amount && norm ? (normals[id][k] / norm) * amount : 0),
    ) as Vec3;
    const rounded = target.map(Math.fround) as Vec3;
    const error = distance(target, rounded);
    if (supported[id]) achievedDeviation = Math.max(achievedDeviation, error);
    maxOffset = Math.max(maxOffset, amount);
    if (supported[id] && error > deviation)
      throw new Error(
        "Requested source deviation cannot be represented at Float32 precision; original retained.",
      );
    return rounded;
  });
  if (thickness > 0 && maxOffset < thickness * (1 - 1e-6))
    throw new Error(
      "Selection cannot accommodate thickness; grow the selected region.",
    );
  for (const face of faces) {
    const [a, b, c] = face.map((id) => outputVertices[id]);
    const n = crossProduct(subtract(b, a), subtract(c, a));
    if (!Math.hypot(...n))
      throw new Error(
        "Local reconstruction collapses at Float32 precision; original retained.",
      );
    const original = face.map((id) => vertices[id]);
    const before = crossProduct(
      subtract(original[1], original[0]),
      subtract(original[2], original[0]),
    );
    if (n.reduce((sum, x, k) => sum + x * before[k], 0) <= 0)
      throw new Error(
        "Thickness folds the selected patch; reduce thickness or grow the selection.",
      );
  }
  const localOutput = new Float32Array(faces.length * 9);
  let localCursor = 0;
  for (const face of faces)
    for (const id of face)
      for (const x of outputVertices[id]) localOutput[localCursor++] = x;
  checkProgress(options, 0.86, "Verifying selected patch topology");
  const verified = analyzeMesh(localOutput, {
    signal: options.signal,
    tolerance: 1e-12,
  });
  validTopology(verified);
  const output = new Float32Array((outsideCount + faces.length) * 9);
  cursor = 0;
  for (let f = 0; f < mask.length; f++)
    if (!mask[f]) {
      if (f % 4096 === 0)
        checkProgress(options, 0.9, "Copying unchanged parent facets");
      for (let k = 0; k < 9; k++) output[cursor++] = positions[f * 9 + k];
    }
  output.set(localOutput, cursor);
  checkProgress(options, 1, "Local ShrinkWrap complete");
  return {
    positions: output,
    summary: `ShrinkWrap repaired ${filledHoles} selected hole(s), preserving ${outsideCount} outside triangles and the fixed parent seam.`,
    diagnostics: {
      scope: options.scope,
      sampleInterval: spacing,
      gapFill: gap,
      organicShape: options.organicShape ?? false,
      extraThickness: thickness,
      maxDeviation: deviation,
      sourceTriangles: mask.length,
      selectedTriangles: count,
      affectedTriangles: count,
      unselectedTriangles: outsideCount,
      preservedTriangleCount: outsideCount,
      selectedComponents: components,
      generatedTriangles: faces.length,
      refinedSourceTriangles: generatedFlags.filter((x) => !x).length,
      generatedHoleTriangles: generatedFlags.filter(Boolean).length,
      generatedHoleSeedTriangles: generatedSource,
      filledHoles,
      fixedSeamVertices: fixed.size,
      fixedSeamEdges: fixedEdges.size,
      achievedMaxDeviation: achievedDeviation,
      deviationMethod:
        "source facets retained by conforming linear refinement; maximum Float32 residual after requested tapered normal offset; generated hole regions excluded",
      maximumAppliedOffset: maxOffset,
      wholeResultWatertight: false,
      wholeTopologyVerified: false,
      reconstructionMethod:
        "conforming source-facet refinement with fixed-seam hole repair",
      sampleIntervalAtFixedSeam: "graded to preserve unsplit parent edges",
      sourceRegionPreserved: thickness === 0,
      selectedPatchTopologyVerified: true,
      selectedPatchBoundaryEdges: verified.boundaryEdges,
      selectedPatchNonManifoldEdges: verified.nonManifoldEdges,
      selfIntersectionsVerified: false,
      organicMethod: options.organicShape
        ? "fitted-curvature or tangent-constrained generated hole continuation"
        : "planar generated hole continuation",
    },
  };
}
