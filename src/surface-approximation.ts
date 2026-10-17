import type { Positions, Vec3 } from "./types";
import type {
  NurbsPatch,
  SurfaceFitOptions,
  SurfaceFitResult,
} from "./surfaces";
import {
  nativeMatrices,
  nativeSurfaceWorkingSet,
} from "./native-surface-fitting";

/** Existing explicit projection/sampling adapter around the recovered approximation core.
 * Full native UV initialization and iterative correction remain separate work.
 */
export function fitApproximateSurface(
  scan: Positions | Float64Array,
  options: SurfaceFitOptions,
  patch: NurbsPatch,
  axes: readonly number[],
  minimum: Vec3,
  width: number,
  height: number,
  samples: number,
): SurfaceFitResult {
  const lambda = options.regularizationWeight ?? 0.0001;
  if (!Number.isFinite(lambda) || lambda < 0)
    throw new Error("Regularization weight must be finite and nonnegative.");
  const workspace = nativeSurfaceWorkingSet(
    patch.countU,
    patch.countV,
    samples,
  );
  const points: Vec3[] = [];
  const uv: [number, number][] = [];
  for (let s = 0; s < samples; s++) {
    const at =
      Math.floor((s * (scan.length / 3 - 1)) / Math.max(1, samples - 1)) * 3;
    points.push([scan[at], scan[at + 1], scan[at + 2]]);
    uv.push([
      (scan[at + axes[0]] - minimum[axes[0]]) / width,
      (scan[at + axes[1]] - minimum[axes[1]]) / height,
    ]);
  }
  const fitted = nativeMatrices(
    points,
    uv,
    patch.countU,
    patch.countV,
    patch.degreeU + 1,
    patch.degreeV + 1,
    patch.knotsU,
    patch.knotsV,
    undefined,
    lambda,
  );
  const [x, y, z] = fitted.coordinates;
  if (!x.accepted || !y.accepted || !z.accepted)
    throw new Error(
      "Samples do not constrain this approximation. Lower control resolution or increase sampling.",
    );
  const controls: Vec3[] = new Array(patch.points.length);
  for (let u = 0; u < patch.countU; u++)
    for (let v = 0; v < patch.countV; v++) {
      const nativeIndex = u * patch.countV + v;
      controls[v * patch.countU + u] = [
        x.output[nativeIndex],
        y.output[nativeIndex],
        z.output[nativeIndex],
      ];
    }
  let squared = 0,
    maxError = 0;
  for (let sample = 0; sample < samples; sample++) {
    let px = 0,
      py = 0,
      pz = 0;
    for (
      let coefficient = 0;
      coefficient < patch.points.length;
      coefficient++
    ) {
      const basis = fitted.columns[coefficient][sample];
      px += basis * x.output[coefficient];
      py += basis * y.output[coefficient];
      pz += basis * z.output[coefficient];
    }
    const error = Math.hypot(
      px - points[sample][0],
      py - points[sample][1],
      pz - points[sample][2],
    );
    squared += error * error;
    maxError = Math.max(maxError, error);
  }
  if (!Number.isFinite(squared) || !Number.isFinite(maxError))
    throw new Error(
      "Surface approximation residual exceeds the finite numeric range.",
    );
  return {
    patch: { ...patch, points: controls },
    samples,
    rms: Math.sqrt(squared / samples),
    maxError,
    projection: options.projection,
    solverBytes: workspace.bytes,
    method: "approximate",
    regularizationWeight: lambda,
  };
}
