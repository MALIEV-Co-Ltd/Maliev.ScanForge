import { ShapeUtils, Vector2, Vector3 } from "three";
export const cubeCorners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
export const cubeEdges = [
  [0, 1],
  [1, 2],
  [3, 2],
  [0, 3],
  [4, 5],
  [5, 6],
  [7, 6],
  [4, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
const faces = [
  { c: [0, 1, 2, 3], n: [0, 0, -1] },
  { c: [4, 5, 6, 7], n: [0, 0, 1] },
  { c: [0, 1, 5, 4], n: [0, -1, 0] },
  { c: [3, 2, 6, 7], n: [0, 1, 0] },
  { c: [0, 3, 7, 4], n: [-1, 0, 0] },
  { c: [1, 2, 6, 5], n: [1, 0, 0] },
];
const midpoints = cubeEdges.map(([a, b]) =>
  cubeCorners[a].map((v, k) => (v + cubeCorners[b][k]) / 2),
);
export type CubeContour = { points: number[][]; triangles: number[][] };
/** Face decisions use the same low-coordinate diagonal in both adjacent cells.
 * Closed contour loops remove tetrahedral interior/face-diagonal vertices.
 */
function contour(mask: number): CubeContour {
  const points = midpoints.map((p) => [...p]),
    next = new Int8Array(12).fill(-1);
  const inside = (i: number) => Boolean(mask & (1 << i));
  for (const { c, n } of faces) {
    const edges = c.map((a, i) =>
      cubeEdges.findIndex(
        ([u, v]) =>
          u === Math.min(a, c[(i + 1) % 4]) &&
          v === Math.max(a, c[(i + 1) % 4]),
      ),
    );
    // Edge descriptors are geometrically positive, not necessarily sorted corner IDs.
    for (let i = 0; i < 4; i++)
      edges[i] = cubeEdges.findIndex(
        ([u, v]) =>
          (u === c[i] && v === c[(i + 1) % 4]) ||
          (v === c[i] && u === c[(i + 1) % 4]),
      );
    const crossed = edges.filter(
      (e) => inside(cubeEdges[e][0]) !== inside(cubeEdges[e][1]),
    );
    const pairs =
      crossed.length === 2
        ? [crossed]
        : crossed.length === 4
          ? [
              [edges[0], edges[1]],
              [edges[2], edges[3]],
            ]
          : [];
    for (let [a, b] of pairs) {
      const [u, v] = cubeEdges[a],
        gradient = new Vector3(
          ...(cubeCorners[v] as [number, number, number]),
        ).sub(new Vector3(...(cubeCorners[u] as [number, number, number])));
      if (!inside(u)) gradient.negate();
      const tangent = gradient.cross(
          new Vector3(...(n as [number, number, number])),
        ),
        delta = new Vector3(...(points[b] as [number, number, number])).sub(
          new Vector3(...(points[a] as [number, number, number])),
        );
      if (tangent.dot(delta) < 0) [a, b] = [b, a];
      if (next[a] !== -1)
        throw Error("Inconsistent reconstruction face contour.");
      next[a] = b;
    }
  }
  const visited = new Uint8Array(12),
    triangles: number[][] = [];
  for (let seed = 0; seed < 12; seed++) {
    if (next[seed] < 0 || visited[seed]) continue;
    const loop: number[] = [];
    let current = seed;
    do {
      if (current < 0 || visited[current])
        throw Error("Open reconstruction cell contour.");
      visited[current] = 1;
      loop.push(current);
      current = next[current];
    } while (current !== seed);
    if (loop.length < 3) throw Error("Degenerate reconstruction cell contour.");
    const normal = new Vector3();
    for (let i = 0; i < loop.length; i++)
      normal.add(
        new Vector3(...(points[loop[i]] as [number, number, number])).cross(
          new Vector3(
            ...(points[loop[(i + 1) % loop.length]] as [
              number,
              number,
              number,
            ]),
          ),
        ),
      );
    const axis =
      Math.abs(normal.x) >= Math.abs(normal.y) &&
      Math.abs(normal.x) >= Math.abs(normal.z)
        ? 0
        : Math.abs(normal.y) >= Math.abs(normal.z)
          ? 1
          : 2;
    const projected = loop.map(
      (id) =>
        new Vector2(points[id][(axis + 1) % 3], points[id][(axis + 2) % 3]),
    );
    const candidate = ShapeUtils.triangulateShape(projected, []).map((t) =>
      t.map((i) => loop[i]),
    );
    const valid =
      candidate.length === loop.length - 2 &&
      candidate.every((t) => {
        const a = new Vector3(...(points[t[0]] as [number, number, number])),
          b = new Vector3(...(points[t[1]] as [number, number, number])),
          c = new Vector3(...(points[t[2]] as [number, number, number]));
        const area = b.sub(a).cross(c.sub(a)).dot(normal);
        return (
          Math.abs(area) > 1e-10 &&
          !faces.some(({ c: f }) => {
            const fixed = [0, 1, 2].find((k) =>
              f.every((id) => cubeCorners[id][k] === cubeCorners[f[0]][k]),
            );
            return (
              fixed !== undefined &&
              t.every((id) => points[id][fixed] === cubeCorners[f[0]][fixed])
            );
          })
        );
      });
    if (valid) {
      for (let tri of candidate) {
        const [a, b, c] = tri.map(
          (i) => new Vector3(...(points[i] as [number, number, number])),
        );
        if (b.sub(a).cross(c.sub(a)).dot(normal) < 0)
          tri = [tri[0], tri[2], tri[1]];
        triangles.push(tri);
      }
    } else {
      // A pole strictly inside this cell cannot coincide with neighboring-cell poles.
      let center = [0, 1, 2].map(
        (k) =>
          0.25 +
          (loop.reduce((s, id) => s + points[id][k], 0) / loop.length) * 0.5,
      );
      if (points.slice(12).some((p) => p.every((v, k) => v === center[k])))
        center = center.map((v, k) => v * 0.875 + points[loop[0]][k] * 0.125);
      const pole = points.length;
      points.push(center);
      for (let i = 0; i < loop.length; i++)
        triangles.push([pole, loop[i], loop[(i + 1) % loop.length]]);
    }
  }
  return { points, triangles };
}
export const cubeContours = Array.from({ length: 256 }, (_, mask) =>
  contour(mask),
);

/** Distinct keys must remain distinct after Float32 rounding, including poles. */
export const cubeContourSeparation = Math.min(
  0.5,
  ...cubeContours.flatMap((template) => {
    const ids = [...new Set(template.triangles.flat())],
      distances: number[] = [];
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++)
        distances.push(
          Math.max(
            ...[0, 1, 2].map((k) =>
              Math.abs(template.points[ids[a]][k] - template.points[ids[b]][k]),
            ),
          ),
        );
    for (const id of ids)
      if (id >= 12)
        for (const value of template.points[id])
          distances.push(value, 1 - value);
    return distances;
  }),
);
