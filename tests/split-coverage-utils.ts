export type Point = [number, number];
export const cross = (a: Point, b: Point, p: Point) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);

export function overlapArea(subject: Point[], clip: Point[]): number {
  let polygon = subject;
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const a = clip[edge],
      b = clip[(edge + 1) % 3],
      next: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length],
        dp = cross(a, b, p),
        dq = cross(a, b, q);
      if (dp >= 0) next.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    polygon = next;
  }
  let twiceArea = 0;
  for (let i = 1; i + 1 < polygon.length; i++)
    twiceArea += cross(polygon[0], polygon[i], polygon[i + 1]);
  return Math.abs(twiceArea) / 2;
}
