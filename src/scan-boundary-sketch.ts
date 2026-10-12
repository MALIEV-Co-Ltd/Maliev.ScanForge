import type { SavedSketch, Vec3 } from "./types";
import { datumFrame } from "./origin";
import { validateSketch } from "./sketch";

/** Closed projected boundaries reuse the first point ID so profiles are topologically closed. */
export function boundarySketches(
  curves: number[][],
  plane: { origin: Vec3; normal: Vec3 },
  label: string,
  id: () => string = () => crypto.randomUUID(),
): SavedSketch[] {
  const frame = datumFrame(plane.origin, plane.normal);
  return curves
    .filter((curve) => curve.length >= 6)
    .map((curve, index) => {
      if (curve.length % 3 || !curve.every(Number.isFinite))
        throw new Error(
          "Boundary coordinates must be complete finite XYZ points.",
        );
      const count = curve.length / 3;
      const closed =
        count > 2 &&
        Math.hypot(
          ...curve
            .slice(0, 3)
            .map((value, axis) => value - curve[(count - 1) * 3 + axis]),
        ) <= 1e-6;
      const points = Array.from(
        { length: count - (closed ? 1 : 0) },
        (_, pointIndex) => {
          const delta = curve
            .slice(pointIndex * 3, pointIndex * 3 + 3)
            .map((value, axis) => value - frame.origin[axis]);
          if (
            Math.abs(
              delta.reduce(
                (sum, value, axis) => sum + value * frame.normal[axis],
                0,
              ),
            ) > 1e-4
          )
            throw new Error(
              "Projected boundary does not lie on its sketch plane.",
            );
          return {
            id: `p${pointIndex}`,
            x: delta.reduce(
              (sum, value, axis) => sum + value * frame.u[axis],
              0,
            ),
            y: delta.reduce(
              (sum, value, axis) => sum + value * frame.v[axis],
              0,
            ),
          };
        },
      );
      const sketch = {
        version: 1 as const,
        frame,
        points,
        segments: Array.from(
          { length: points.length - (closed ? 0 : 1) },
          (_, i) => ({
            id: `s${i}`,
            a: points[i].id,
            b: points[(i + 1) % points.length].id,
          }),
        ),
        constraints: [],
      };
      validateSketch(sketch);
      return { id: id(), name: `${label} ${index + 1}`, sketch };
    });
}
