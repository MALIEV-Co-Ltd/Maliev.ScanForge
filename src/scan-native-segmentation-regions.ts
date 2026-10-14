/** Original threshold classification and LIFO region traversal.
 * Neighbor slots must retain the native face order. Missing neighbors are -1.
 * This stage consumes prepared scores; it does not construct mesh adjacency.
 */
export function nativeSegmentationRegions(
  scores: Float64Array,
  triangles: Uint32Array,
  neighbors: Int32Array,
  options: {
    threshold: number;
    faceFlags?: Uint8Array;
    vertexFlags?: Uint32Array;
    signal?: AbortSignal;
  },
) {
  const vertices = scores.length,
    faces = triangles.length / 3;
  if (
    triangles.length % 3 ||
    neighbors.length !== triangles.length ||
    !Number.isFinite(options.threshold) ||
    options.threshold < 0 ||
    options.threshold > 1 ||
    (options.faceFlags && options.faceFlags.length !== faces) ||
    (options.vertexFlags && options.vertexFlags.length !== vertices)
  )
    throw new Error("Invalid native segmentation region input.");
  const check = (i: number) => {
    if (i % 4096 === 0 && options.signal?.aborted)
      throw new DOMException("Segmentation cancelled.", "AbortError");
  };
  const faceFlags = options.faceFlags?.slice() ?? new Uint8Array(faces);
  const vertexFlags = options.vertexFlags?.slice() ?? new Uint32Array(vertices);
  for (let i = 0; i < vertices; i++) {
    check(i);
    if (!Number.isFinite(scores[i]))
      throw new Error("Segmentation scores must be finite.");
    vertexFlags[i] &= ~2;
  }
  for (let i = 0; i < triangles.length; i++) {
    check(i);
    if (triangles[i] >= vertices)
      throw new Error("Triangle index is outside the score buffer.");
    if (neighbors[i] < -1 || neighbors[i] >= faces)
      throw new Error("Neighbor index is outside the face buffer.");
  }
  for (let i = 0; i < faces; i++) {
    check(i);
    const a = triangles[i * 3],
      b = triangles[i * 3 + 1],
      c = triangles[i * 3 + 2];
    faceFlags[i] &= ~1;
    if (
      options.threshold < scores[a] &&
      options.threshold < scores[b] &&
      options.threshold < scores[c]
    ) {
      faceFlags[i] |= 1;
      vertexFlags[a] |= 2;
      vertexFlags[b] |= 2;
      vertexFlags[c] |= 2;
    }
  }
  const labels = new Uint32Array(faces);
  labels.fill(0xffffffff);
  const stack = new Uint32Array(faces),
    traversal = new Uint32Array(faces);
  const offsets: number[] = [0];
  let written = 0,
    visited = 0;
  const eligible = (face: number) =>
    !(faceFlags[face] & 1) || !!(faceFlags[face] & 2);
  for (let start = 0; start < faces; start++) {
    check(start);
    if (labels[start] !== 0xffffffff || !eligible(start)) continue;
    const id = offsets.length - 1;
    if (id >= 0xffffff)
      throw new Error("Native segmentation region limit exceeded.");
    const label = (0xff000000 | id) >>> 0;
    let pending = 1;
    stack[0] = start;
    labels[start] = label;
    while (pending) {
      check(visited++);
      const face = stack[--pending];
      traversal[written++] = face;
      for (let slot = 0; slot < 3; slot++) {
        const neighbor = neighbors[face * 3 + slot];
        if (
          neighbor < 0 ||
          labels[neighbor] !== 0xffffffff ||
          !eligible(neighbor)
        )
          continue;
        labels[neighbor] = label;
        stack[pending++] = neighbor;
      }
    }
    offsets.push(written);
  }
  return {
    labels,
    faceFlags,
    vertexFlags,
    traversal: traversal.slice(0, written),
    regionOffsets: Uint32Array.from(offsets),
    maxRegionIndex: Math.max(0, offsets.length - 2),
  };
}
