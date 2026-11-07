/** Construct a synthetic index for raw typed corners by exact bits. Without
 * authored indices, coincident corners and degenerate-face connectivity cannot
 * be reconstructed reliably; the result is not original source identity. */
type SoupOptions = {
  signal?: AbortSignal;
  maxTypedBytes?: number;
  maxWork?: number;
  check?: () => void;
};
export function indexFiniteTriangleSoup(
  positions: Float32Array,
  options?: SoupOptions,
): { vertices: Float32Array; triangles: Uint32Array; peakTypedBytes: number };
export function indexFiniteTriangleSoup(
  positions: Float64Array,
  options?: SoupOptions,
): { vertices: Float64Array; triangles: Uint32Array; peakTypedBytes: number };
export function indexFiniteTriangleSoup(
  positions: Float32Array | Float64Array,
  options: SoupOptions = {},
): {
  vertices: Float32Array | Float64Array;
  triangles: Uint32Array;
  peakTypedBytes: number;
} {
  if (!positions.length || positions.length % 9)
    throw new Error("Finite source requires complete triangles.");
  const corners = positions.length / 3;
  let slots = 2;
  while (slots < corners * 2 && slots < 0x40000000) slots *= 2;
  if (slots < corners * 2)
    throw new Error("Finite source exceeds index capacity.");
  const bytes = positions.byteLength + corners * 4 + slots * 4;
  const limitBytes = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 0 || bytes > limitBytes)
    throw new Error("Finite source typed memory budget exceeded.");
  const limit = options.maxWork ?? 2_000_000 + corners * 32;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite source work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit) throw new Error("Finite source work budget exceeded.");
  };
  tick();
  const wordsPerValue = positions instanceof Float64Array ? 2 : 1;
  const vertices =
      positions instanceof Float64Array
        ? new Float64Array(positions.length)
        : new Float32Array(positions.length),
    triangles = new Uint32Array(corners),
    table = new Uint32Array(slots);
  const inputBits = new Uint32Array(
    positions.buffer,
    positions.byteOffset,
    positions.length * wordsPerValue,
  );
  const vertexBits = new Uint32Array(vertices.buffer);
  let count = 0;
  for (let corner = 0; corner < corners; corner++) {
    tick();
    const base = corner * 3;
    if (
      !Number.isFinite(positions[base]) ||
      !Number.isFinite(positions[base + 1]) ||
      !Number.isFinite(positions[base + 2])
    )
      throw new Error("Finite source coordinates must be finite.");
    const wordBase = base * wordsPerValue;
    let hash =
      wordsPerValue === 1
        ? (Math.imul(inputBits[wordBase], 73856093) ^
            Math.imul(inputBits[wordBase + 1], 19349663) ^
            Math.imul(inputBits[wordBase + 2], 83492791)) >>>
          0
        : 2166136261;
    if (wordsPerValue === 2)
      for (let word = 0; word < 6; word++)
        hash = Math.imul(hash ^ inputBits[wordBase + word], 16777619) >>> 0;
    hash = (hash ^ (hash >>> 16)) & (slots - 1);
    while (table[hash]) {
      tick();
      const index = (table[hash] - 1) * 3 * wordsPerValue;
      let same = true;
      for (let word = 0; word < 3 * wordsPerValue; word++)
        if (vertexBits[index + word] !== inputBits[wordBase + word]) {
          same = false;
          break;
        }
      if (same) break;
      hash = (hash + 1) & (slots - 1);
    }
    if (!table[hash]) {
      table[hash] = ++count;
      const to = (count - 1) * 3 * wordsPerValue;
      for (let word = 0; word < 3 * wordsPerValue; word++)
        vertexBits[to + word] = inputBits[wordBase + word];
    }
    let id = table[hash] - 1;
    const faceStart = corner - (corner % 3);
    if (
      (corner > faceStart && triangles[faceStart] === id) ||
      (corner > faceStart + 1 && triangles[faceStart + 1] === id)
    ) {
      // Triangle soup does not retain whether coincident corners shared an ID.
      // Keep distinct per-face slots so a zero-area facet is not lost.
      id = count++;
      const to = id * 3 * wordsPerValue;
      for (let word = 0; word < 3 * wordsPerValue; word++)
        vertexBits[to + word] = inputBits[wordBase + word];
    }
    triangles[corner] = id;
  }
  tick();
  return {
    vertices: vertices.subarray(0, count * 3),
    triangles,
    peakTypedBytes: bytes,
  };
}
