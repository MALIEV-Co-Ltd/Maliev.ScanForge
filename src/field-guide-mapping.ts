export interface GuideMappingCache {
  points: Float32Array;
  surfaceFaces: Int32Array;
  mappedKinds: Int32Array;
  mappedVertices: Int32Array;
  metadata: Int32Array;
}

/** Recovered mapping storage, closure and snapping around an explicit spatial-query dependency. */
export function mapCurvatureGuidePoints(
  sourcePoints: Float32Array,
  sourceMetadata: Int32Array,
  positions: Float32Array,
  triangles: Uint32Array,
  query: (
    point: Float32Array,
    index: number,
  ) => { face: number; point: Float32Array },
  options: {
    project?: boolean;
    snapToVertices?: boolean;
    squaredSnapDistance?: number;
  } = {},
  previous?: GuideMappingCache,
): GuideMappingCache {
  const f = Math.fround;
  const count = sourcePoints.length / 3;
  const threshold = f(options.squaredSnapDistance ?? 0);
  const project = options.project ?? true;
  if (
    sourcePoints.length % 3 ||
    positions.length % 3 ||
    triangles.length % 3 ||
    !Number.isFinite(threshold)
  )
    throw new Error("Guide mapping dimensions or threshold are invalid.");
  for (const values of [
    sourcePoints,
    positions,
    previous?.points ?? new Float32Array(),
  ])
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error("Guide mapping points must be finite.");
  for (const vertex of triangles)
    if (vertex >= positions.length / 3)
      throw new Error("Guide mapping triangle references an invalid vertex.");
  const priorCount = (previous?.points.length ?? 0) / 3;
  if (
    !Number.isInteger(priorCount) ||
    (previous &&
      [
        previous.surfaceFaces.length,
        previous.mappedKinds.length,
        previous.mappedVertices.length,
      ].some((length) => length !== priorCount))
  )
    throw new Error(
      "Guide mapping previous cache dimensions are inconsistent.",
    );
  const points = Array.from(previous?.points ?? []);
  const surfaceFaces = Array.from(previous?.surfaceFaces ?? []);
  const mappedKinds = Array.from(previous?.mappedKinds ?? []);
  const mappedVertices = Array.from(previous?.mappedVertices ?? []);
  const metadata = Array.from(previous?.metadata ?? []);
  const matchedMetadata = sourceMetadata.length === count;
  const closed =
    count > 0 &&
    [0, 1, 2].every(
      (axis) => sourcePoints[axis] === sourcePoints[(count - 1) * 3 + axis],
    );
  const queryCount = count - Number(closed);
  for (let index = 0; index < queryCount; index++) {
    const input = sourcePoints.slice(index * 3, index * 3 + 3);
    const hit = query(input.slice(), index);
    if (hit.face === -1) continue;
    if (
      !Number.isInteger(hit.face) ||
      hit.face < 0 ||
      hit.face >= triangles.length / 3 ||
      hit.point.length !== 3 ||
      hit.point.some((value) => !Number.isFinite(value))
    )
      throw new Error("Guide mapping spatial query returned invalid data.");
    const point = project ? hit.point.slice() : input;
    let kind = 4;
    let target = hit.face;
    if (options.snapToVertices) {
      let minimum = f(3.4028235e38);
      for (let corner = 0; corner < 3; corner++) {
        const vertex = triangles[hit.face * 3 + corner];
        const x = f(positions[vertex * 3] - point[0]);
        const y = f(positions[vertex * 3 + 1] - point[1]);
        const z = f(positions[vertex * 3 + 2] - point[2]);
        const squared = f(f(f(y * y) + f(x * x)) + f(z * z));
        if (!Number.isFinite(squared))
          throw new Error("Guide mapping vertex distance overflowed.");
        if (squared <= threshold && squared < minimum) {
          kind = 1;
          target = vertex;
          minimum = squared;
        }
      }
      if (kind === 1) point.set(positions.subarray(target * 3, target * 3 + 3));
    }
    points.push(...point);
    surfaceFaces.push(hit.face);
    mappedKinds.push(kind);
    mappedVertices.push(target);
    if (matchedMetadata) metadata.push(sourceMetadata[index]);
  }
  if (closed && points.length > 0) {
    points.push(points[0], points[1], points[2]);
    surfaceFaces.push(surfaceFaces[0]);
    mappedKinds.push(mappedKinds[0]);
    mappedVertices.push(mappedVertices[0]);
    if (matchedMetadata) {
      if (!metadata.length)
        throw new Error("Guide mapping closure lacks matching metadata.");
      metadata.push(metadata[0]);
    }
  }
  return {
    points: new Float32Array(points),
    surfaceFaces: new Int32Array(surfaceFaces),
    mappedKinds: new Int32Array(mappedKinds),
    mappedVertices: new Int32Array(mappedVertices),
    metadata: new Int32Array(metadata),
  };
}
