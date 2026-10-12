export type ScreenPoint = [number, number];
const cross = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function closest(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  const x = b[0] - a[0],
    y = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / (x * x + y * y || 1)),
  );
  return [a[0] + t * x, a[1] + t * y];
}
function inside(p: ScreenPoint, triangle: ScreenPoint[]) {
  const signs = triangle.map((a, i) => cross(a, triangle[(i + 1) % 3], p));
  return (
    Math.abs(cross(triangle[0], triangle[1], triangle[2])) > 1e-9 &&
    (signs.every((v) => v >= -1e-9) || signs.every((v) => v <= 1e-9))
  );
}
/** Return a point on the triangle touched by the continuous screen brush footprint. */
export function brushTrianglePoint(
  triangle: ScreenPoint[],
  points: ScreenPoint[],
  radius: number,
): ScreenPoint | null {
  const minX =
    Math.min(triangle[0][0], triangle[1][0], triangle[2][0]) - radius;
  const maxX =
    Math.max(triangle[0][0], triangle[1][0], triangle[2][0]) + radius;
  const minY =
    Math.min(triangle[0][1], triangle[1][1], triangle[2][1]) - radius;
  const maxY =
    Math.max(triangle[0][1], triangle[1][1], triangle[2][1]) + radius;
  for (let n = 0; n < points.length; n++) {
    const a = points[Math.max(0, n - 1)],
      b = points[n];
    if (
      Math.max(a[0], b[0]) < minX ||
      Math.min(a[0], b[0]) > maxX ||
      Math.max(a[1], b[1]) < minY ||
      Math.min(a[1], b[1]) > maxY
    )
      continue;
    if (inside(a, triangle)) return a;
    if (inside(b, triangle)) return b;
    for (let i = 0; i < 3; i++) {
      const c = triangle[i],
        d = triangle[(i + 1) % 3];
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        ex = d[0] - c[0],
        ey = d[1] - c[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) > 1e-9) {
        const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator;
        const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
          return [a[0] + t * dx, a[1] + t * dy];
      }
      for (const p of [a, b]) {
        const q = closest(p, c, d);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= radius) return q;
      }
      for (const p of [c, d]) {
        const q = closest(p, a, b);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= radius) return p;
      }
    }
  }
  return null;
}
