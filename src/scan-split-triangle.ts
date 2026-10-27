import type { Vec3 } from "./types";
import { crossProduct, dotProduct, subtract } from "./scan-edit";

export class SplitPrecisionError extends Error {
  constructor() {
    super(
      "Split result loses or reverses a facet at Float32 precision; move the model closer to the origin or use a different cutter.",
    );
    this.name = "SplitPrecisionError";
  }
}

/** Conservatively validate the rounded boundary before using a vertex fan. */
export function convexSplitBoundaryNormal(poly: Vec3[]): Vec3 | undefined {
  const rounded = poly.map((point) => point.map(Math.fround) as Vec3);
  if (
    new Set(rounded.map((point) => JSON.stringify(point))).size !==
    rounded.length
  )
    return undefined;
  const origin = rounded[0];
  const normal: Vec3 = [0, 0, 0];
  for (let i = 1; i + 1 < rounded.length; i++) {
    const cross = crossProduct(
      subtract(rounded[i], origin),
      subtract(rounded[i + 1], origin),
    );
    for (let j = 0; j < 3; j++) normal[j] += cross[j];
  }
  if (!Math.hypot(...normal)) return undefined;
  for (const point of rounded)
    if (dotProduct(subtract(point, origin), normal) !== 0) return undefined;
  for (let i = 0; i < rounded.length; i++) {
    const a = rounded[i],
      edge = subtract(rounded[(i + 1) % rounded.length], a);
    for (const point of rounded)
      if (dotProduct(crossProduct(edge, subtract(point, a)), normal) < 0)
        return undefined;
  }
  return normal;
}

/** Refuse a split that cannot retain a facet at mesh output precision. */
export function appendSplitTriangle(
  output: number[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
) {
  const rounded = [a, b, c].map((point) => point.map(Math.fround) as Vec3);
  const original = crossProduct(subtract(b, a), subtract(c, a));
  if (Math.hypot(...original) === 0) return;
  const narrowed = crossProduct(
    subtract(rounded[1], rounded[0]),
    subtract(rounded[2], rounded[0]),
  );
  if (dotProduct(original, narrowed) <= 0) throw new SplitPrecisionError();
  output.push(...rounded[0], ...rounded[1], ...rounded[2]);
}
