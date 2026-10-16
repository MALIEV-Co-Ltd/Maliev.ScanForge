import type { Positions } from "./types";
import {
  GridBits,
  triangleDistanceSquared,
  type GridProgress,
} from "./scan-reconstruction-grid";
export { closeReconstructionGrid } from "./scan-reconstruction-grid";

export function sampleShrinkwrapGrid(
  inputs: Positions[],
  start: number[],
  dimensions: number[],
  resolution: number,
  radius: number,
  progress: GridProgress,
) {
  const [nx, ny, nz] = dimensions,
    slice = nx * ny,
    total = slice * nz,
    bits = new GridBits(total),
    r2 = radius * radius;
  let candidates = 0,
    distanceTests = 0,
    shellPoints = 0,
    processed = 0;
  const coordinates = inputs.reduce((n, p) => n + p.length, 0);
  for (const p of inputs)
    for (let i = 0; i < p.length; i += 9) {
      if (i % 9216 === 0)
        progress(
          0.05 + (0.55 * processed) / coordinates,
          "Sampling surface distance",
        );
      const low = [0, 1, 2].map((k) =>
        Math.max(
          0,
          Math.ceil(
            (Math.min(p[i + k], p[i + 3 + k], p[i + 6 + k]) -
              radius -
              start[k]) /
              resolution,
          ),
        ),
      );
      const high = [0, 1, 2].map((k) =>
        Math.min(
          dimensions[k] - 1,
          Math.floor(
            (Math.max(p[i + k], p[i + 3 + k], p[i + 6 + k]) +
              radius -
              start[k]) /
              resolution,
          ),
        ),
      );
      for (let z = low[2]; z <= high[2]; z++)
        for (let y = low[1]; y <= high[1]; y++)
          for (let x = low[0]; x <= high[0]; x++) {
            if (++candidates % 65536 === 0)
              progress(
                0.05 + (0.55 * processed) / coordinates,
                "Sampling surface distance",
              );
            if (candidates > 500_000_000)
              throw Error(
                "Reconstruction sampling exceeds its bounded work limit; increase point resolution.",
              );
            const id = x + y * nx + z * slice;
            if (bits.get(id)) continue;
            distanceTests++;
            if (
              triangleDistanceSquared(
                start[0] + x * resolution,
                start[1] + y * resolution,
                start[2] + z * resolution,
                p,
                i,
              ) <= r2
            ) {
              bits.set(id);
              shellPoints++;
            }
          }
      processed += 9;
    }
  return { occupancy: bits, shellPoints, distanceTests, candidates };
}
