import { brushTrianglePoint, type ScreenPoint } from "./brush-coverage";

/** Even-odd fill, implicitly closing the last sampled point to the first. */
export function pointInLasso(point: ScreenPoint, path: ScreenPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const a = path[j],
      b = path[i];
    const cross =
      (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (
      Math.abs(cross) < 1e-8 &&
      point[0] >= Math.min(a[0], b[0]) &&
      point[0] <= Math.max(a[0], b[0]) &&
      point[1] >= Math.min(a[1], b[1]) &&
      point[1] <= Math.max(a[1], b[1])
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function lassoTrianglePoint(
  triangle: ScreenPoint[],
  path: ScreenPoint[],
  radius: number,
): ScreenPoint | null {
  const center: ScreenPoint = [
    (triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3,
    (triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3,
  ];
  if (path.length >= 3 && pointInLasso(center, path)) return center;
  for (const vertex of triangle)
    if (path.length >= 3 && pointInLasso(vertex, path)) return vertex;
  return brushTrianglePoint(
    triangle,
    path.length > 1 ? [...path, path[0]] : path,
    radius,
  );
}
