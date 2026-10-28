import { exactSplitCoverage } from "./scan-split-exact-coverage";
import type { Vec3 } from "./types";
import {
  exactSegmentTriangleCrossing,
  exactEdgeWitnessCrossing,
  type ExactEdgeWitness,
} from "./scan-split-exact-crossing";

type Boundary = {
  edge: 0 | 1 | 2;
  t: number;
  point: Vec3;
  canonical: {
    t: number;
    reversed: boolean;
    fromEnd?: number;
    exactCutter?: [Vec3, Vec3, Vec3];
    exactWitness?: ExactEdgeWitness;
  };
};
type Face = {
  ids: readonly [number, number, number];
  boundaries: readonly Boundary[];
  mesh: {
    vertices: Vec3[];
    triangles: [number, number, number][];
    constraints: [number, number][];
    boundaryVertices: number[];
  };
};
type AssemblyOptions = {
  signal?: AbortSignal;
  maxWork?: number;
  maxTypedBytes?: number;
  check?: () => void;
  preciseCoordinates?: boolean;
  /** Distinct result partitions allow an unchanged unselected neighbor. */
  isolatedSelection?: Uint8Array;
};
type AssemblyResult<T extends Float32Array | Float64Array> = {
  triangles: Uint32Array;
  constraints: Uint32Array;
  faceOffsets: Uint32Array;
  addedVertices: T;
};

/** Assemble indexed face outputs by source identity. maxTypedBytes covers helper-owned typed arrays only. */
export function assembleFiniteFaceMesh(
  source: Float32Array | Float64Array,
  faces: readonly Face[],
  options: AssemblyOptions & { preciseCoordinates: true },
): AssemblyResult<Float64Array>;
export function assembleFiniteFaceMesh(
  source: Float32Array | Float64Array,
  faces: readonly Face[],
  options?: AssemblyOptions & { preciseCoordinates?: false },
): AssemblyResult<Float32Array>;
export function assembleFiniteFaceMesh(
  source: Float32Array | Float64Array,
  faces: readonly Face[],
  options: AssemblyOptions = {},
): AssemblyResult<Float32Array | Float64Array> {
  return assembleFiniteFaces(
    source,
    faces.length,
    (i) => faces[i],
    undefined,
    options,
  );
}

/** Keep untouched faces as packed source indices; refined faces retain original facet identities. */
export function assembleFiniteSparseFaceMesh(
  source: Float32Array | Float64Array,
  indices: Uint32Array,
  refined: ReadonlyMap<number, Face>,
  options: AssemblyOptions & { preciseCoordinates: true },
): AssemblyResult<Float64Array>;
export function assembleFiniteSparseFaceMesh(
  source: Float32Array | Float64Array,
  indices: Uint32Array,
  refined: ReadonlyMap<number, Face>,
  options?: AssemblyOptions & { preciseCoordinates?: false },
): AssemblyResult<Float32Array>;
export function assembleFiniteSparseFaceMesh(
  source: Float32Array | Float64Array,
  indices: Uint32Array,
  refined: ReadonlyMap<number, Face>,
  options: AssemblyOptions = {},
): AssemblyResult<Float32Array | Float64Array> {
  if (indices.length % 3)
    throw new Error("Finite assembly source indices are incomplete.");
  const faceCount = indices.length / 3;
  for (const key of refined.keys())
    if (!Number.isSafeInteger(key) || key < 0 || key >= faceCount)
      throw new Error("Finite assembly refined face index is invalid.");
  return assembleFiniteFaces(
    source,
    faceCount,
    (i) => refined.get(i),
    indices,
    options,
  );
}

function assembleFiniteFaces(
  source: Float32Array | Float64Array,
  faceCount: number,
  getFace: (index: number) => Face | undefined,
  sourceIndices: Uint32Array | undefined,
  options: AssemblyOptions,
) {
  const outputCoordinate = options.preciseCoordinates
    ? (n: number) => n
    : Math.fround;
  if (source.length % 3)
    throw new Error("Finite assembly source coordinates are incomplete.");
  const limit = options.maxWork ?? 2_000_000 + faceCount * 64;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite assembly work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite assembly work budget exceeded.");
  };
  tick();
  if (
    options.isolatedSelection &&
    (options.isolatedSelection.length !== faceCount ||
      options.isolatedSelection.some((value) => value !== 0 && value !== 1))
  )
    throw new Error("Finite assembly selection is invalid.");
  if (sourceIndices) {
    const changed = new Map<
      string,
      { all: Set<string>; perFace: Map<number, Set<string>>; uses: number }
    >();
    const touched = new Set<number>();
    const edgeKey = (a: number, b: number) =>
      a < b ? `${a}:${b}` : `${b}:${a}`;
    for (let f = 0; f < faceCount; f++) {
      tick();
      const face = getFace(f);
      if (!face) continue;
      if (options.isolatedSelection?.[f] === 0)
        throw new Error("Finite assembly cannot refine an unselected face.");
      if (face.ids.some((id, i) => id !== sourceIndices[f * 3 + i]))
        throw new Error(
          "Finite assembly refined face identity does not match source.",
        );
      for (const b of face.boundaries) {
        tick();
        if (!Number.isInteger(b.edge) || b.edge < 0 || b.edge > 2)
          throw new Error("Finite assembly boundary identity is invalid.");
        const from = face.ids[b.edge],
          to = face.ids[(b.edge + 1) % 3],
          k = edgeKey(from, to);
        touched.add(from);
        touched.add(to);
        const entry = changed.get(k) ?? {
          all: new Set<string>(),
          perFace: new Map<number, Set<string>>(),
          uses: 0,
        };
        const contact = `${b.canonical.t}:${b.canonical.fromEnd ?? ""}`;
        entry.all.add(contact);
        const local = entry.perFace.get(f) ?? new Set<string>();
        local.add(contact);
        entry.perFace.set(f, local);
        changed.set(k, entry);
      }
    }
    if (changed.size)
      for (let f = 0; f < faceCount; f++) {
        tick();
        for (let j = 0; j < 3; j++) {
          tick();
          const a = sourceIndices[f * 3 + j],
            b = sourceIndices[f * 3 + ((j + 1) % 3)];
          if (!touched.has(a) || !touched.has(b)) continue;
          const entry = changed.get(edgeKey(a, b));
          if (!entry) continue;
          if (++entry.uses > 2)
            throw new Error("Finite assembly subdivided edge is non-manifold.");
          if (options.isolatedSelection?.[f] === 0) continue;
          const local = entry.perFace.get(f);
          if (!local || local.size !== entry.all.size)
            throw new Error(
              "Finite assembly would leave a neighbor T-junction.",
            );
          for (const contact of entry.all) {
            tick();
            if (!local.has(contact))
              throw new Error(
                "Finite assembly would leave a neighbor T-junction.",
              );
          }
        }
      }
  }
  let triangleSlots = 0,
    constraintSlots = 0,
    extraCapacity = 0,
    maxLocal = 0;
  for (let f = 0; f < faceCount; f++) {
    tick();
    const face = getFace(f);
    if (!face) {
      if (!sourceIndices) throw new Error("Finite assembly face is missing.");
      triangleSlots += 3;
      continue;
    }
    if (
      face.mesh.vertices.length < 3 ||
      face.boundaries.length !== face.mesh.boundaryVertices.length
    )
      throw new Error("Finite assembly face metadata is invalid.");
    triangleSlots += face.mesh.triangles.length * 3;
    constraintSlots += face.mesh.constraints.length * 2;
    extraCapacity += face.mesh.vertices.length - 3;
    maxLocal = Math.max(maxLocal, face.mesh.vertices.length);
  }
  const sourceCount = source.length / 3;
  if (
    ![triangleSlots, constraintSlots, extraCapacity].every(
      Number.isSafeInteger,
    ) ||
    sourceCount + extraCapacity > 0xffffffff ||
    Math.max(triangleSlots, constraintSlots, extraCapacity * 3) > 0xffffffff
  )
    throw new Error("Finite assembly index capacity exceeded.");
  const bytes =
    4 *
      (triangleSlots +
        constraintSlots +
        extraCapacity * 3 +
        faceCount +
        1 +
        maxLocal) +
    (options.preciseCoordinates ? extraCapacity * 12 : 0);
  const maxTypedBytes = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(maxTypedBytes) ||
    maxTypedBytes < 0 ||
    bytes > maxTypedBytes
  )
    throw new Error("Finite assembly typed memory budget exceeded.");
  const triangles = new Uint32Array(triangleSlots),
    constraints = new Uint32Array(constraintSlots),
    offsets = new Uint32Array(faceCount + 1),
    added = options.preciseCoordinates
      ? new Float64Array(extraCapacity * 3)
      : new Float32Array(extraCapacity * 3),
    scratch = new Uint32Array(maxLocal);
  const identities = new Map<string, number>(),
    edgePoints = new Map<string, string>();
  let used = 0,
    triangleAt = 0,
    constraintAt = 0;
  for (let f = 0; f < faceCount; f++) {
    tick();
    const face = getFace(f);
    if (!face) {
      if (!sourceIndices) throw new Error("Finite assembly face is missing.");
      offsets[f] = triangleAt / 3;
      for (let c = 0; c < 3; c++) {
        tick();
        const id = sourceIndices[f * 3 + c];
        if (
          id >= sourceCount ||
          !Number.isFinite(source[id * 3]) ||
          !Number.isFinite(source[id * 3 + 1]) ||
          !Number.isFinite(source[id * 3 + 2])
        )
          throw new Error(
            "Finite assembly source indices or coordinates are invalid.",
          );
        triangles[triangleAt++] = id;
      }
      continue;
    }
    const { ids, boundaries, mesh } = face;
    if (sourceIndices && ids.some((id, i) => id !== sourceIndices[f * 3 + i]))
      throw new Error(
        "Finite assembly refined face identity does not match source.",
      );
    if (
      new Set(ids).size !== 3 ||
      !ids.every(
        (id) => Number.isSafeInteger(id) && id >= 0 && id < sourceCount,
      )
    )
      throw new Error("Finite assembly source indices are invalid.");
    const local = scratch.subarray(0, mesh.vertices.length);
    local.set(ids, 0);
    for (const p of mesh.vertices) {
      tick();
      if (p.length !== 3 || !p.every(Number.isFinite))
        throw new Error("Finite assembly vertex is invalid.");
    }
    for (let i = 0; i < 3; i++) {
      tick();
      if (
        !mesh.vertices[i].every(
          (n, k) => outputCoordinate(n) === source[ids[i] * 3 + k],
        )
      )
        throw new Error(
          "Finite assembly source vertex does not match its identity.",
        );
    }
    const bound = new Map<number, number>();
    const boundaryMask = new Map<number, number>([
      [0, 5],
      [1, 3],
      [2, 6],
    ]);
    for (let i = 0; i < boundaries.length; i++) {
      tick();
      const b = boundaries[i],
        vertex = mesh.boundaryVertices[i];
      if (
        !Number.isInteger(b.edge) ||
        b.edge < 0 ||
        b.edge > 2 ||
        b.point.length !== 3 ||
        !b.point.every(Number.isFinite) ||
        !Number.isSafeInteger(vertex) ||
        vertex < 3 ||
        vertex >= mesh.vertices.length ||
        !Number.isFinite(b.canonical.t) ||
        b.canonical.t <= 0 ||
        (b.canonical.t >= 1 &&
          !(b.canonical.t === 1 && b.canonical.fromEnd !== undefined)) ||
        (b.canonical.fromEnd !== undefined &&
          (!Number.isFinite(b.canonical.fromEnd) ||
            b.canonical.fromEnd <= 0 ||
            b.canonical.fromEnd >= 1 ||
            b.canonical.t !== 1 ||
            1 - b.canonical.fromEnd !== 1))
      )
        throw new Error("Finite assembly boundary identity is invalid.");
      const from = ids[b.edge],
        to = ids[(b.edge + 1) % 3],
        reversed = from > to;
      if (
        b.canonical.reversed !== reversed ||
        b.t !==
          (reversed
            ? (b.canonical.fromEnd ?? 1 - b.canonical.t)
            : b.canonical.t) ||
        !b.point.every(
          (n, k) =>
            outputCoordinate(n) === outputCoordinate(mesh.vertices[vertex][k]),
        )
      )
        throw new Error("Finite assembly boundary identity is inconsistent.");
      const a = Math.min(from, to),
        z = Math.max(from, to),
        edge = `${a}:${z}`,
        identity = `${edge}:${b.canonical.t}:${b.canonical.fromEnd ?? ""}`;
      const exact =
        options.preciseCoordinates && b.canonical.exactCutter
          ? exactSegmentTriangleCrossing(
              [source[a * 3], source[a * 3 + 1], source[a * 3 + 2]],
              [source[z * 3], source[z * 3 + 1], source[z * 3 + 2]],
              b.canonical.exactCutter,
              { exactPoint: true },
            )
          : undefined;
      if (
        b.canonical.exactCutter &&
        options.preciseCoordinates &&
        (!exact?.inside || !exact.roundedPoint)
      )
        throw new Error("Finite exact assembly contact is invalid.");
      const witnessed =
        options.preciseCoordinates && b.canonical.exactWitness
          ? exactEdgeWitnessCrossing(
              [source[a * 3], source[a * 3 + 1], source[a * 3 + 2]],
              [source[z * 3], source[z * 3 + 1], source[z * 3 + 2]],
              b.canonical.exactWitness,
            )
          : undefined;
      if (
        exact?.exactPoint &&
        witnessed &&
        !exact.exactPoint.every((n, i) => n === witnessed.exactPoint[i])
      )
        throw new Error("Finite exact assembly witnesses disagree.");
      const expected =
        witnessed?.roundedPoint ??
        exact?.roundedPoint ??
        [0, 1, 2].map((k) =>
          b.canonical.fromEnd === undefined
            ? outputCoordinate(
                source[a * 3 + k] +
                  b.canonical.t * (source[z * 3 + k] - source[a * 3 + k]),
              )
            : outputCoordinate(
                source[z * 3 + k] +
                  b.canonical.fromEnd * (source[a * 3 + k] - source[z * 3 + k]),
              ),
        );
      if (!b.point.every((n, k) => outputCoordinate(n) === expected[k]))
        throw new Error(
          "Finite assembly contact does not match its indexed edge.",
        );
      const pointKey = `${edge}:${JSON.stringify(expected)}`,
        previous = edgePoints.get(pointKey);
      if (previous !== undefined && previous !== identity)
        throw new Error(
          "Finite assembly contact identities collide at output precision.",
        );
      edgePoints.set(pointKey, identity);
      let global = identities.get(identity);
      if (global === undefined) {
        global = sourceCount + used;
        added.set(expected, used * 3);
        used++;
        identities.set(identity, global);
      }
      const prior = bound.get(vertex);
      if (prior !== undefined && prior !== global)
        throw new Error(
          "Finite assembly local vertex has conflicting identities.",
        );
      bound.set(vertex, global);
      boundaryMask.set(vertex, (boundaryMask.get(vertex) ?? 0) | (1 << b.edge));
    }
    for (let i = 3; i < mesh.vertices.length; i++) {
      tick();
      let global = bound.get(i);
      if (global === undefined) {
        const p = mesh.vertices[i].map(outputCoordinate);
        if (!p.every(Number.isFinite))
          throw new Error("Finite assembly vertex is invalid.");
        global = sourceCount + used;
        added.set(p, used * 3);
        used++;
      }
      local[i] = global;
    }
    const valid = (id: number) =>
      Number.isSafeInteger(id) && id >= 0 && id < local.length;
    offsets[f] = triangleAt / 3;
    const sub = (a: Vec3, b: Vec3): Vec3 => [
      a[0] - b[0],
      a[1] - b[1],
      a[2] - b[2],
    ];
    const cross = (a: Vec3, b: Vec3): Vec3 => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const normal = cross(
      sub(mesh.vertices[1], mesh.vertices[0]),
      sub(mesh.vertices[2], mesh.vertices[0]),
    );
    const area = dot(normal, normal);
    if (!(area > 0) || !Number.isFinite(area))
      throw new Error("Finite assembly source face is degenerate.");
    for (let i = 3; i < mesh.vertices.length; i++) {
      tick();
      if (bound.has(i)) continue;
      const point = mesh.vertices[i],
        origin = mesh.vertices[0];
      const residual = Math.abs(dot(sub(point, origin), normal));
      const error =
        Number.EPSILON *
        64 *
        normal.reduce(
          (sum, n, k) =>
            sum + (Math.abs(point[k]) + Math.abs(origin[k])) * Math.abs(n),
          0,
        );
      if (residual > error)
        throw new Error(
          "Finite assembly interior vertex is outside the source plane.",
        );
    }
    let covered = 0;
    const edgeKey = (a: number, b: number) =>
      a < b ? `${a}:${b}` : `${b}:${a}`;
    const edges = new Map<
      string,
      { from: number; to: number; count: number }
    >();
    for (const tri of mesh.triangles) {
      tick();
      if (tri.length !== 3 || !tri.every(valid) || new Set(tri).size !== 3)
        throw new Error("Finite assembly triangle is invalid.");
      const p = mesh.vertices[tri[0]].map(outputCoordinate) as Vec3,
        q = mesh.vertices[tri[1]].map(outputCoordinate) as Vec3,
        r = mesh.vertices[tri[2]].map(outputCoordinate) as Vec3;
      const n = cross(sub(q, p), sub(r, p));
      const signed = dot(n, normal);
      if (!(signed > 0) || !Number.isFinite(signed))
        throw new Error(
          "Finite assembly triangle winding is invalid at output precision.",
        );
      covered += signed;
      for (let j = 0; j < 3; j++) {
        const from = tri[j],
          to = tri[(j + 1) % 3],
          k = edgeKey(from, to),
          prior = edges.get(k);
        if (!prior) edges.set(k, { from, to, count: 1 });
        else {
          if (prior.count !== 1 || prior.from === from)
            throw new Error(
              "Finite assembly has overlapping or non-manifold edges.",
            );
          prior.count++;
        }
      }
      for (const n of tri) triangles[triangleAt++] = local[n];
    }
    const ring: number[] = [];
    for (let side = 0; side < 3; side++) {
      tick();
      ring.push(side);
      const contacts = boundaries
        .map((boundary, i) => ({ boundary, vertex: mesh.boundaryVertices[i] }))
        .filter((item) => item.boundary.edge === side);
      contacts.sort((a, b) => {
        tick();
        const delta = a.boundary.t - b.boundary.t;
        if (delta) return delta;
        const endOffset = (item: typeof a) =>
          item.boundary.canonical.reversed
            ? item.boundary.canonical.t
            : (item.boundary.canonical.fromEnd ?? 1 - item.boundary.t);
        return endOffset(b) - endOffset(a);
      });
      for (const contact of contacts) {
        tick();
        if (ring[ring.length - 1] !== contact.vertex) ring.push(contact.vertex);
      }
    }
    const origin = mesh.vertices[ring[0]].map(outputCoordinate) as Vec3;
    let expectedCoverage = 0;
    for (let i = 1; i + 1 < ring.length; i++) {
      tick();
      const q = mesh.vertices[ring[i]].map(outputCoordinate) as Vec3,
        r = mesh.vertices[ring[i + 1]].map(outputCoordinate) as Vec3;
      expectedCoverage += dot(cross(sub(q, origin), sub(r, origin)), normal);
    }
    const error =
      Math.max(area, Math.abs(expectedCoverage), Math.abs(covered)) *
      Number.EPSILON *
      128 *
      (ring.length + mesh.triangles.length);
    if (
      !(expectedCoverage > 0) ||
      (Math.abs(covered - expectedCoverage) > error &&
        !exactSplitCoverage(
          mesh.vertices,
          mesh.triangles,
          ring,
          outputCoordinate,
          tick,
        ))
    )
      throw new Error(
        `Finite assembly face coverage is incomplete at face ${f} (expected ${expectedCoverage}, observed ${covered}).`,
      );
    for (let i = 0; i < ring.length; i++) {
      tick();
      const from = ring[i],
        to = ring[(i + 1) % ring.length],
        edge = edges.get(edgeKey(from, to));
      if (!edge || edge.count !== 1 || edge.from !== from || edge.to !== to)
        throw new Error(
          "Finite assembly source boundary coverage is incomplete.",
        );
    }
    for (const edge of edges.values()) {
      tick();
      if (
        edge.count === 1 &&
        !((boundaryMask.get(edge.from) ?? 0) & (boundaryMask.get(edge.to) ?? 0))
      )
        throw new Error("Finite assembly has an interior boundary edge.");
    }
    for (const edge of mesh.constraints) {
      tick();
      if (
        edge.length !== 2 ||
        !edge.every(valid) ||
        edge[0] === edge[1] ||
        !edges.has(edgeKey(edge[0], edge[1]))
      )
        throw new Error("Finite assembly constraint is invalid or missing.");
      ((constraints[constraintAt++] = local[edge[0]]),
        (constraints[constraintAt++] = local[edge[1]]));
    }
  }
  offsets[faceCount] = triangleAt / 3;
  return {
    triangles,
    constraints,
    faceOffsets: offsets,
    addedVertices: added.subarray(0, used * 3),
  };
}
