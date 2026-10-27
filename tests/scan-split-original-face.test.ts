import { expect, it } from "vitest";
import { splitGeneralCutter } from "../src/scan-edit-general-split";

// ply-1 face 7207, exact Float32 source and cutter coordinates from the retained local receipt.
const source = new Float32Array([
  19.898012161254883, 47.31754684448242, -315.9837341308594, 20.04651641845703,
  47.50707244873047, -315.9645080566406, 20.04990005493164, 47.18638610839844,
  -315.8510437011719,
]);
const cutter = new Float32Array([
  19.9250431060791, -149.8528594970703, -442.96917724609375, 19.9250431060791,
  -149.8528594970703, 72.22071838378906, 19.9250431060791, 406.9168701171875,
  -442.96917724609375,
]);

it("production Split retains the first original-scan crossing at Float32 precision", () => {
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    {},
  );
  expect(result.segments!.filter((part) => part.length)).toHaveLength(2);
  const cross = (p: ArrayLike<number>, i: number) => {
    const u = [0, 1, 2].map((k) => p[i + 3 + k] - p[i + k]);
    const v = [0, 1, 2].map((k) => p[i + 6 + k] - p[i + k]);
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  };
  const normal = cross(source, 0);
  const squared = normal.reduce((sum, value) => sum + value * value, 0);
  let covered = 0;
  for (const part of result.segments!)
    for (let i = 0; i < part.length; i += 9) {
      const n = cross(part, i);
      const projected = n.reduce(
        (sum, value, axis) => sum + value * normal[axis],
        0,
      );
      expect(projected).toBeGreaterThan(0);
      covered += projected;
    }
  expect(Math.abs(covered / squared - 1)).toBeLessThan(0.001);
});
