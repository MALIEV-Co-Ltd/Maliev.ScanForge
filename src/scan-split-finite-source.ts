type PackedSource = { vertices: Float32Array; triangles: Uint32Array };
type PrecisePackedSource = {
  vertices: Float32Array | Float64Array;
  triangles: Uint32Array;
};
type InputPositions = Float32Array | Float64Array | number[];
type InputSource = { vertices: InputPositions; triangles: Uint32Array };
type CachedSource = {
  positions: InputPositions;
  topology: { vertices: Float64Array; triangles: Uint32Array };
  provenance: "indexed" | "welded";
};
type Options = {
  signal?: AbortSignal;
  maxTypedBytes?: number;
  check?: () => void;
  preciseCoordinates?: boolean;
};

/** Prototype source selection. The cache provenance must be recorded by its owner. */
export function selectFiniteIndexedSource(
  positions: InputPositions,
  explicit: InputSource | undefined,
  cache: CachedSource | undefined,
  options: Options & { preciseCoordinates: true },
): PrecisePackedSource | undefined;
export function selectFiniteIndexedSource(
  positions: InputPositions,
  explicit?: InputSource,
  cache?: CachedSource,
  options?: Options & { preciseCoordinates?: false },
): PackedSource | undefined;
export function selectFiniteIndexedSource(
  positions: InputPositions,
  explicit?: InputSource,
  cache?: CachedSource,
  options: Options = {},
): PrecisePackedSource | undefined {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
  };
  check();
  const source =
    explicit ??
    (cache?.positions === positions && cache.provenance === "indexed"
      ? cache.topology
      : undefined);
  if (!source) return undefined;
  const { vertices, triangles } = source;
  if (
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== positions.length
  )
    throw new Error(
      "Finite indexed source does not match the source geometry.",
    );
  for (let i = 0; i < vertices.length; i++) {
    if ((i & 4095) === 0) check();
    if (
      !Number.isFinite(vertices[i]) ||
      (!options.preciseCoordinates &&
        !Object.is(Math.fround(vertices[i]), vertices[i]))
    )
      throw new Error(
        "Finite indexed source does not match Float32 source geometry.",
      );
  }
  for (let i = 0; i < triangles.length; i++) {
    if ((i & 4095) === 0) check();
    const base = triangles[i] * 3;
    if (base + 2 >= vertices.length)
      throw new Error(
        "Finite indexed source does not match the source geometry.",
      );
    for (let axis = 0; axis < 3; axis++)
      if (!Object.is(vertices[base + axis], positions[i * 3 + axis]))
        throw new Error(
          "Finite indexed source does not match the source geometry.",
        );
  }
  const alreadyTyped =
    vertices instanceof Float32Array ||
    (options.preciseCoordinates && vertices instanceof Float64Array);
  const bytes = alreadyTyped
    ? 0
    : vertices.length * (options.preciseCoordinates ? 8 : 4);
  const limit = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limit) || limit < 0 || bytes > limit)
    throw new Error("Finite indexed source typed memory budget exceeded.");
  check();
  if (
    vertices instanceof Float32Array ||
    (options.preciseCoordinates && vertices instanceof Float64Array)
  )
    return { vertices, triangles };
  const copy = options.preciseCoordinates
    ? new Float64Array(vertices.length)
    : new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    if ((i & 4095) === 0) check();
    copy[i] = vertices[i];
  }
  check();
  return { vertices: copy, triangles };
}
