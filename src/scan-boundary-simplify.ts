/** Simplify a 3D boundary within the supplied maximum point-to-segment deviation. */
export function simplifyBoundaryCurve(
  points: number[],
  tolerance: number,
): number[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Boundary fit tolerance must be positive and finite.");
  if (points.length < 6 || points.length % 3 || !points.every(Number.isFinite))
    throw new Error("Boundary curve requires at least two finite XYZ points.");
  const equal = (a: number[], b: number[]) =>
    a.every((value, axis) => value === b[axis]);
  const vertices: number[][] = [];
  for (let i = 0; i < points.length; i += 3) {
    const point = points.slice(i, i + 3);
    if (!vertices.length || !equal(point, vertices[vertices.length - 1]))
      vertices.push(point);
  }
  const closed =
    vertices.length > 1 && equal(vertices[0], vertices[vertices.length - 1]);
  if (closed) vertices.pop();
  if (new Set(vertices.map((point) => point.join(","))).size < (closed ? 3 : 2))
    throw new Error("Boundary curve has too few distinct points.");
  const distance = (p: number[], a: number[], b: number[]): number => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const length2 = dx * dx + dy * dy + dz * dz;
    const t = length2
      ? Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) /
              length2,
          ),
        )
      : 0;
    return Math.hypot(
      p[0] - a[0] - t * dx,
      p[1] - a[1] - t * dy,
      p[2] - a[2] - t * dz,
    );
  };
  const path = closed ? [...vertices, vertices[0]] : vertices;
  const anchors = new Set([0, path.length - 1]);
  if (closed) {
    // Three mandatory distinct anchors prevent a large tolerance collapsing a loop.
    let farthest = 1;
    for (let i = 2; i < vertices.length; i++)
      if (
        distance(vertices[i], vertices[0], vertices[0]) >
        distance(vertices[farthest], vertices[0], vertices[0])
      )
        farthest = i;
    let third = vertices.findIndex(
      (point) =>
        !equal(point, vertices[0]) && !equal(point, vertices[farthest]),
    );
    for (let i = 1; i < vertices.length; i++)
      if (
        i !== farthest &&
        distance(vertices[i], vertices[0], vertices[farthest]) >
          distance(vertices[third], vertices[0], vertices[farthest])
      )
        third = i;
    anchors.add(farthest);
    anchors.add(third);
  }
  const ordered = [...anchors].sort((a, b) => a - b);
  const stack: [number, number][] = ordered
    .slice(1)
    .map((end, i) => [ordered[i], end]);
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let greatest = tolerance,
      split = -1;
    for (let i = start + 1; i < end; i++) {
      const deviation = distance(path[i], path[start], path[end]);
      if (deviation > greatest) {
        greatest = deviation;
        split = i;
      }
    }
    if (split !== -1) {
      anchors.add(split);
      stack.push([start, split], [split, end]);
    }
  }
  return [...anchors].sort((a, b) => a - b).flatMap((i) => path[i]);
}
