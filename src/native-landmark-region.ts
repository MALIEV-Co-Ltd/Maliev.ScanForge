/** Original landmark preparation: reset vertex bit 4, seed, then snapshot rings.
 * Eligible vertices only accumulate, so each incidence need be visited once.
 * This preserves the native full-scan passes and borrowed face bit 128.
 */
export function prepareNativeLandmarkRegion(
  vertexCount: number,
  triangles: ArrayLike<number>,
  seeds: ArrayLike<number>,
  vertexFlags?: ArrayLike<number>,
  faceFlags?: ArrayLike<number>,
  signal?: AbortSignal,
) {
  const check = () => {
    if (signal?.aborted)
      throw new DOMException(
        "Landmark region preparation cancelled.",
        "AbortError",
      );
  };
  check();
  const faceCount = triangles.length / 3;
  if (
    !Number.isSafeInteger(vertexCount) ||
    vertexCount < 0 ||
    !Number.isInteger(faceCount) ||
    (vertexFlags && vertexFlags.length !== vertexCount) ||
    (faceFlags && faceFlags.length !== faceCount)
  )
    throw new Error("Invalid landmark region buffers.");
  if (
    vertexCount * 20 + 4 + triangles.length * 4 + faceCount * 6 >
    256 * 1024 * 1024
  )
    throw new Error(
      "Landmark region topology exceeds the 256 MiB allocation budget.",
    );
  const vertices = new Uint32Array(vertexCount);
  const faces = new Uint8Array(faceCount);
  const degree = new Uint32Array(vertexCount);
  const offsets = new Uint32Array(vertexCount + 1);
  const incidence = new Uint32Array(triangles.length);
  const visited = new Uint8Array(faceCount);
  let frontier = new Uint32Array(vertexCount);
  let next = new Uint32Array(vertexCount);
  const marked = new Uint32Array(faceCount);
  const unsigned = (value: number, maximum: number, name: string) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
      throw new Error(`Invalid landmark ${name}.`);
    return value;
  };
  for (let id = 0; id < vertexCount; id++) {
    if (!(id % 4096)) check();
    vertices[id] =
      (unsigned(vertexFlags?.[id] ?? 0, 0xffffffff, "vertex flags") & ~4) >>> 0;
  }
  let count = 0;
  for (let face = 0; face < faceCount; face++) {
    if (!(face % 4096)) check();
    faces[face] = unsigned(faceFlags?.[face] ?? 0, 255, "face flags") & ~128;
    if (faces[face] & 4) count++;
    for (let corner = 0; corner < 3; corner++) {
      const id = unsigned(
        triangles[face * 3 + corner],
        vertexCount - 1,
        "triangle index",
      );
      degree[id]++;
    }
  }
  for (let id = 0; id < vertexCount; id++)
    offsets[id + 1] = offsets[id] + degree[id];
  degree.set(offsets.subarray(0, vertexCount));
  for (let face = 0; face < faceCount; face++) {
    if (!(face % 4096)) check();
    for (let corner = 0; corner < 3; corner++)
      incidence[degree[triangles[face * 3 + corner]]++] = face;
  }
  let frontierCount = 0;
  for (let index = 0; index < seeds.length; index++) {
    const seed = unsigned(seeds[index], vertexCount - 1, "seed vertex");
    const before = vertices[seed];
    vertices[seed] = (before | 4) >>> 0;
    if ((before & 5) === 0) frontier[frontierCount++] = seed;
  }
  let visitedFaceReferences = 0;
  let passes = 0;
  const grow = () => {
    check();
    passes++;
    let markedCount = 0;
    for (let index = 0; index < frontierCount; index++) {
      const vertex = frontier[index];
      for (
        let offset = offsets[vertex];
        offset < offsets[vertex + 1];
        offset++
      ) {
        if (!(visitedFaceReferences++ % 4096)) check();
        const face = incidence[offset];
        if (!visited[face]) {
          visited[face] = 1;
          marked[markedCount++] = face;
        }
      }
    }
    // Mark the entire snapshot before promoting its newly reached vertices.
    let nextCount = 0;
    for (let index = 0; index < markedCount; index++) {
      const face = marked[index];
      if (!(faces[face] & 4)) count++;
      faces[face] |= 132;
      for (let corner = 0; corner < 3; corner++) {
        const id = triangles[face * 3 + corner],
          before = vertices[id];
        vertices[id] = (before | 4) >>> 0;
        if ((before & 5) === 0) next[nextCount++] = id;
      }
    }
    const previousFrontier = frontier;
    frontier = next;
    next = previousFrontier;
    frontierCount = nextCount;
    return count;
  };
  let previous = grow();
  while (previous < 3000) {
    const current = grow();
    if (current === previous) break;
    previous = current;
  }
  return { vertices, faceFlags: faces, count, passes, visitedFaceReferences };
}

export function parseLandmarkSeedVertices(
  text: string,
): Uint32Array | undefined {
  if (!text.trim()) return undefined;
  const tokens = text.trim().split(/[\s,]+/);
  if (
    tokens.length > 10000 ||
    tokens.some((token) => !/^\d+$/.test(token) || Number(token) > 0xffffffff)
  )
    throw new Error("Supply at most 10,000 unsigned landmark seed vertex IDs.");
  return Uint32Array.from(tokens, Number);
}
