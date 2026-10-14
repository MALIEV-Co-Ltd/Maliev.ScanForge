/** Recovered preparation for fresh indexed meshes with supplied Float32 vertex normals.
 * Input must already be compacted, as the original caller removes unreferenced
 * vertices before preparation. Normal production is outside this kernel.
 */
export function nativeSegmentationScores(
  normals: Float32Array,
  triangles: Uint32Array,
  options: { capDegrees?: number; signal?: AbortSignal } = {},
) {
  const cap = options.capDegrees ?? 10;
  if (
    normals.length % 3 ||
    triangles.length % 3 ||
    !Number.isFinite(cap) ||
    cap < 0
  )
    throw new Error("Invalid native segmentation input.");
  const count = normals.length / 3;
  const sentinel = 3.4028234663852886e38;
  const scores = new Float64Array(count);
  const referenced = new Uint8Array(count);
  scores.fill(sentinel);
  const check = (i: number) => {
    if (i % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Segmentation cancelled.", "AbortError");
  };
  for (let i = 0; i < normals.length; i++) {
    check(i);
    if (!Number.isFinite(normals[i]))
      throw new Error("Vertex normals must be finite.");
  }
  const pair = (a: number, b: number) => {
    const x = a * 3,
      y = b * 3;
    const value =
      normals[x] * normals[y] +
      normals[x + 1] * normals[y + 1] +
      normals[x + 2] * normals[y + 2];
    if (value < scores[a]) scores[a] = value;
    if (value < scores[b]) scores[b] = value;
  };
  for (let i = 0; i < triangles.length; i += 3) {
    check(i);
    const a = triangles[i],
      b = triangles[i + 1],
      c = triangles[i + 2];
    if (a >= count || b >= count || c >= count)
      throw new Error("Triangle index is outside the normal buffer.");
    referenced[a] = referenced[b] = referenced[c] = 1;
    pair(b, a);
    pair(c, b);
    pair(c, a);
  }
  if (referenced.includes(0))
    throw new Error(
      "Segmentation requires compacted vertices: remove unreferenced vertices first.",
    );
  let min = sentinel,
    max = -sentinel;
  for (let i = 0; i < count; i++) {
    check(i);
    if (scores[i] === sentinel) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, scores[i])));
    scores[i] = angle > cap * 0.017453292519943295 ? sentinel : angle;
    if (Math.abs(scores[i]) !== sentinel) {
      min = Math.min(min, scores[i]);
      max = Math.max(max, scores[i]);
    }
  }
  const magnitude = min < 0 && max > 0 ? Math.max(max, -min) : max;
  for (let i = 0; i < count; i++) {
    check(i);
    scores[i] = Math.max(min, Math.min(max, scores[i]));
    if (magnitude >= 2 ** -23 && Math.abs(scores[i]) !== sentinel)
      scores[i] *= 1 / magnitude;
  }
  const sums = new Float64Array(count),
    counts = new Uint32Array(count);
  const add = (target: number, source: number) => {
    if (Math.abs(scores[source]) === sentinel) return;
    sums[target] += scores[source];
    counts[target]++;
  };
  for (let i = 0; i < triangles.length; i += 3) {
    check(i);
    const a = triangles[i],
      b = triangles[i + 1],
      c = triangles[i + 2];
    add(a, b);
    add(a, c);
    add(b, c);
    add(b, a);
    add(c, a);
    add(c, b);
  }
  for (let i = 0; i < count; i++) {
    check(i);
    if (counts[i]) scores[i] = sums[i] / counts[i];
  }
  return scores;
}
