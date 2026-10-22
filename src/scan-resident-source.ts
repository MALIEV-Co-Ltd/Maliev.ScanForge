import type { Positions } from "./types";
import {
  checkScanAbort,
  scanRange,
  type ScanGeometryRef,
  type ScanBudget,
  type ScanGeometrySource,
  type ScanBounds,
} from "./scan-geometry-source";

/** Borrow authored coordinates; range reads return separately leased copies. */
export function residentScanSource(
  positions: Positions,
  ref: ScanGeometryRef,
  budget: ScanBudget,
): ScanGeometrySource {
  if (!positions.length || positions.length % 9)
    throw new Error("Expected complete triangle coordinates.");
  if (!ref.id || !Number.isSafeInteger(ref.generation) || ref.generation < 0)
    throw new Error("Invalid scan geometry identity.");
  const bounds: [number, number, number, number, number, number] = [
    Infinity,
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
    -Infinity,
  ];
  for (let index = 0; index < positions.length; index++) {
    const value = positions[index],
      axis = index % 3;
    if (!Number.isFinite(value))
      throw new Error("Scan coordinates must be finite.");
    bounds[axis] = Math.min(bounds[axis], value);
    bounds[axis + 3] = Math.max(bounds[axis + 3], value);
  }
  const isFloat32 = positions instanceof Float32Array;
  const metadata = Object.freeze({
    ref: Object.freeze({ ...ref }),
    triangles: positions.length / 9,
    bounds: Object.freeze(bounds) as ScanBounds,
    precision: isFloat32 ? ("float32" as const) : ("float64" as const),
    units: "mm" as const,
  });
  return {
    metadata,
    async readTriangles(first, count, signal) {
      checkScanAbort(signal);
      scanRange(first, count, metadata.triangles);
      const lease = await budget.reserve(
        `source:${ref.id}`,
        count * 9 * (isFloat32 ? 4 : 8),
        signal,
      );
      try {
        checkScanAbort(signal);
        const output = isFloat32
          ? new Float32Array(count * 9)
          : new Float64Array(count * 9);
        for (let index = 0; index < output.length; index++) {
          if (index % 4096 === 0) checkScanAbort(signal);
          output[index] = positions[first * 9 + index];
        }
        return {
          firstTriangle: first,
          triangleCount: count,
          positions: output,
          release: lease.release,
        };
      } catch (error) {
        lease.release();
        throw error;
      }
    },
  };
}
