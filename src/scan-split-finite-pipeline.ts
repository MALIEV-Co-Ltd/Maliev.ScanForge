import type { Vec3 } from "./types";
import { collectFiniteCutterHits } from "./scan-edit-general-split";
import { buildSparseFiniteEdgeContactsIndexed } from "./scan-split-finite-edges";
import { buildFiniteFaceInput } from "./scan-split-finite-face-input";
import { triangulateFiniteFace } from "./scan-split-finite-face";
import { assembleFiniteSparseFaceMesh } from "./scan-split-finite-assembly";
import { groupFiniteTrianglesCompact } from "./scan-split-finite-group";
import { selectFiniteIndexedSource } from "./scan-split-finite-source";
import { analyzeFiniteCutIncidence } from "./scan-split-finite-incidence";
import { indexFiniteTriangleSoup } from "./scan-split-finite-soup";
import { makeExperimentalPointOrder } from "./scan-split-native-point-order";

type RefinementOptions = {
  selection?: Uint8Array;
  signal?: AbortSignal;
  tolerance?: number;
  maxWork?: number;
  maxTypedBytes?: number;
  maxEstimatedTemporaryBytes?: number;
  maxPointOrderEntries?: number;
  onProgress?: (fraction: number, stage: string) => void;
  check?: () => void;
  preciseCoordinates?: boolean;
};
type RefinementResult<T extends Float32Array | Float64Array> = {
  triangles: Uint32Array;
  constraints: Uint32Array;
  faceOffsets: Uint32Array;
  addedVertices: T;
  groups: Uint32Array;
  cutIncidence: ReturnType<typeof analyzeFiniteCutIncidence>;
  affectedFaces: number;
  sourceFaces: number;
};
type SourceResult<T extends Float32Array | Float64Array> =
  RefinementResult<T> & {
    sourceVertices: Float32Array | Float64Array;
    sourceIdentity: "retained-indexed" | "exact-corner-index";
  };
type ExplicitSource = Parameters<typeof selectFiniteIndexedSource>[1];
type CachedSource = Parameters<typeof selectFiniteIndexedSource>[2];

/** Experimental adapter; a worker must establish cache provenance before use. */
export function refineFiniteCutterFromSource(
  positions: Float32Array | Float64Array | number[],
  cutter: Float32Array | Float64Array | number[],
  explicit: ExplicitSource,
  cache: CachedSource,
  options: RefinementOptions & { preciseCoordinates: true },
): SourceResult<Float64Array>;
export function refineFiniteCutterFromSource(
  positions: Float32Array,
  cutter: Float32Array | Float64Array | number[],
  explicit?: ExplicitSource,
  cache?: CachedSource,
  options?: RefinementOptions & { preciseCoordinates?: false },
): SourceResult<Float32Array>;
export function refineFiniteCutterFromSource(
  positions: Float32Array | Float64Array | number[],
  cutter: Float32Array | Float64Array | number[],
  explicit?: Parameters<typeof selectFiniteIndexedSource>[1],
  cache?: Parameters<typeof selectFiniteIndexedSource>[2],
  options: RefinementOptions = {},
): SourceResult<Float32Array | Float64Array> {
  const maxTypedBytes = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  const corners = positions.length / 3;
  const limit =
    options.maxWork ??
    2_000_000 +
      corners * (40 + 10 * Math.ceil(Math.log2(Math.max(2, corners)))) +
      cutter.length * 128;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite refinement work budget is invalid.");
  let work = 0;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite refinement work budget exceeded.");
  };
  const sourceOptions = { signal: options.signal, maxTypedBytes, check };
  const retained = options.preciseCoordinates
    ? selectFiniteIndexedSource(positions, explicit, cache, {
        ...sourceOptions,
        preciseCoordinates: true,
      })
    : selectFiniteIndexedSource(positions, explicit, cache, sourceOptions);
  const inputConversionBytes =
    !retained && Array.isArray(positions)
      ? positions.length * Float64Array.BYTES_PER_ELEMENT
      : 0;
  if (
    !Number.isSafeInteger(inputConversionBytes) ||
    inputConversionBytes > maxTypedBytes
  )
    throw new Error(
      "Finite source input conversion typed memory budget exceeded.",
    );
  const typedPositions = retained
    ? undefined
    : Array.isArray(positions)
      ? Float64Array.from(positions)
      : positions;
  const fallback = retained
    ? undefined
    : typedPositions instanceof Float64Array
      ? indexFiniteTriangleSoup(typedPositions, {
          signal: options.signal,
          maxTypedBytes: maxTypedBytes - inputConversionBytes,
          maxWork: limit,
          check,
        })
      : indexFiniteTriangleSoup(typedPositions as Float32Array, {
          signal: options.signal,
          maxTypedBytes: maxTypedBytes - inputConversionBytes,
          maxWork: limit,
          check,
        });
  const source = retained ?? fallback!;
  const preparationBytes = retained
    ? retained.vertices === explicit?.vertices ||
      retained.vertices === cache?.topology.vertices
      ? 0
      : retained.vertices.buffer.byteLength
    : fallback!.peakTypedBytes + inputConversionBytes;
  const refineOptions = {
    ...options,
    maxTypedBytes: maxTypedBytes - preparationBytes,
    check,
  };
  const result = options.preciseCoordinates
    ? refineFiniteCutterMesh(source.vertices, source.triangles, cutter, {
        ...refineOptions,
        preciseCoordinates: true,
      })
    : refineFiniteCutterMesh(source.vertices, source.triangles, cutter, {
        ...refineOptions,
        preciseCoordinates: false,
      });
  return {
    ...result,
    sourceVertices: source.vertices,
    sourceIdentity: retained
      ? ("retained-indexed" as const)
      : ("exact-corner-index" as const),
  };
}

/** Experimental indexed finite refinement; component labels are not native inside/outside classification. */
export function refineFiniteCutterMesh(
  vertices: Float32Array | Float64Array,
  triangles: Uint32Array,
  cutter: Float32Array | Float64Array | number[],
  options: RefinementOptions & { preciseCoordinates: true },
): RefinementResult<Float64Array>;
export function refineFiniteCutterMesh(
  vertices: Float32Array | Float64Array,
  triangles: Uint32Array,
  cutter: Float32Array | Float64Array | number[],
  options?: RefinementOptions & { preciseCoordinates?: false },
): RefinementResult<Float32Array>;
export function refineFiniteCutterMesh(
  vertices: Float32Array | Float64Array,
  triangles: Uint32Array,
  cutter: Float32Array | Float64Array | number[],
  options: RefinementOptions = {},
): RefinementResult<Float32Array | Float64Array> {
  const faces = triangles.length / 3;
  const limit =
    options.maxWork ??
    2_000_000 +
      triangles.length *
        (40 + 10 * Math.ceil(Math.log2(Math.max(2, triangles.length)))) +
      cutter.length * 128;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite refinement work budget is invalid.");
  const maxTypedBytes = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxTypedBytes) || maxTypedBytes < 0)
    throw new Error("Finite refinement typed memory budget is invalid.");
  const maxEstimatedTemporaryBytes =
    options.maxEstimatedTemporaryBytes ?? 1024 * 1024 * 1024;
  if (
    !Number.isSafeInteger(maxEstimatedTemporaryBytes) ||
    maxEstimatedTemporaryBytes < 0
  )
    throw new Error("Finite refinement temporary memory budget is invalid.");
  let work = 0;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite refinement work budget exceeded.");
  };
  const report = (fraction: number, stage: string) => {
    check();
    options.onProgress?.(fraction, stage);
    check();
  };
  check();
  const collected = collectFiniteCutterHits(vertices, triangles, cutter, {
    selection: options.selection,
    preciseCoordinates: options.preciseCoordinates,
    tolerance: options.tolerance,
    signal: options.signal,
    maxWork: limit,
    // Conservative per-reference estimate, not an engine heap measurement.
    maxNativeTreeReferences: Math.floor(maxEstimatedTemporaryBytes / 32),
    maxCollectedHits: Math.floor(maxEstimatedTemporaryBytes / 1024),
    check,
    onProgress: (fraction, stage) => report(fraction * 0.4, stage),
  });
  const maxPointOrderEntries =
    options.maxPointOrderEntries ??
    Math.floor(maxEstimatedTemporaryBytes / 256);
  function* collectedPoints() {
    for (const [, hits] of [...collected.faces].sort((a, b) => {
      check();
      return a[0] - b[0];
    }))
      for (const hit of hits) for (const point of hit.points) yield point;
  }
  const experimentalPointOrder = makeExperimentalPointOrder(
    collectedPoints(),
    maxPointOrderEntries,
    check,
  );
  report(0.45, "Propagating finite edge contacts");
  const registry = buildSparseFiniteEdgeContactsIndexed(
    vertices,
    triangles,
    collected.contacts,
    {
      selection: options.selection,
      isolateSelection: !!options.selection,
      preciseCoordinates: options.preciseCoordinates,
      signal: options.signal,
      maxWork: limit,
      check,
    },
  );
  report(0.5, "Preparing finite face refinements");
  const affected = new Set<number>();
  for (const id of collected.faces.keys()) {
    check();
    affected.add(id);
  }
  for (const id of registry.keys()) {
    check();
    affected.add(id);
  }
  const ordered = [...affected].sort((a, b) => {
    check();
    return a - b;
  });
  const refined = new Map<
    number,
    {
      ids: [number, number, number];
      boundaries: ReturnType<typeof buildFiniteFaceInput>["boundaryContacts"];
      mesh: ReturnType<typeof triangulateFiniteFace>;
    }
  >();
  for (let index = 0; index < ordered.length; index++) {
    const f = ordered[index];
    check();
    if (index % 256 === 0)
      report(
        0.5 + (0.25 * index) / ordered.length,
        "Triangulating finite face refinements",
      );
    const ids: [number, number, number] = [
      triangles[f * 3],
      triangles[f * 3 + 1],
      triangles[f * 3 + 2],
    ];
    const face = ids.map(
      (id) =>
        [vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]] as Vec3,
    ) as [Vec3, Vec3, Vec3];
    const input = buildFiniteFaceInput(
      ids,
      collected.faces.get(f) ?? [],
      registry.get(f) ?? [],
      {
        signal: options.signal,
        maxWork: limit,
        check,
        preciseCoordinates: options.preciseCoordinates,
      },
    );
    let mesh: ReturnType<typeof triangulateFiniteFace>;
    try {
      mesh = triangulateFiniteFace(face, input.segments, {
        ...input,
        experimentalPointOrder,
        preciseCoordinates: options.preciseCoordinates,
        signal: options.signal,
        maxWork: limit,
        check,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(
        `Finite refinement failed at source face ${f}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    refined.set(f, { ids, boundaries: input.boundaryContacts, mesh });
  }
  report(0.75, "Assembling finite face refinements");
  const assemblyOptions = {
    signal: options.signal,
    maxWork: limit,
    maxTypedBytes,
    check,
    isolatedSelection: options.selection,
  };
  const assembled = options.preciseCoordinates
    ? assembleFiniteSparseFaceMesh(vertices, triangles, refined, {
        ...assemblyOptions,
        preciseCoordinates: true,
      })
    : assembleFiniteSparseFaceMesh(
        vertices,
        triangles,
        refined,
        assemblyOptions,
      );
  const retained =
    assembled.triangles.buffer.byteLength +
    assembled.constraints.buffer.byteLength +
    assembled.faceOffsets.buffer.byteLength +
    assembled.addedVertices.buffer.byteLength;
  const partitionBytes = options.selection ? assembled.triangles.length / 3 : 0;
  if (retained + partitionBytes > maxTypedBytes)
    throw new Error("Finite refinement typed memory budget exceeded.");
  const partition = options.selection
    ? new Uint8Array(partitionBytes)
    : undefined;
  if (partition)
    for (let f = 0; f < faces; f++) {
      check();
      partition.fill(
        options.selection![f],
        assembled.faceOffsets[f],
        assembled.faceOffsets[f + 1],
      );
    }
  report(0.9, "Grouping finite cut components");
  const groups = groupFiniteTrianglesCompact(
    assembled.triangles,
    assembled.constraints,
    {
      signal: options.signal,
      maxWork: limit,
      maxTypedBytes: maxTypedBytes - retained - partitionBytes,
      partition,
      check,
    },
  );
  report(0.95, "Analyzing finite cut connectivity");
  const cutIncidence = assembled.constraints.length
    ? analyzeFiniteCutIncidence(
        assembled.triangles,
        assembled.constraints,
        groups,
        {
          signal: options.signal,
          maxWork: limit,
          check,
        },
      )
    : [];
  report(1, "Finite refinement complete");
  return {
    ...assembled,
    groups,
    cutIncidence,
    affectedFaces: ordered.length,
    sourceFaces: faces,
  };
}
