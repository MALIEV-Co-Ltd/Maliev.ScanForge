import type { AxisVertexSymmetry } from "./field-vertex-symmetry";
import { matchAxisVertexSymmetry } from "./field-vertex-symmetry";
import { orderAxisVertices } from "./field-vertex-order";

export interface AxisSymmetryDetection {
  axis: 0 | 1 | 2 | null;
  /** Computed bounds midpoint, including when no candidate qualifies. */
  center: Float32Array;
  tolerance: number;
  coverage: number;
  /** Unvisited/unsuccessful axes retain native float -1. */
  axisScores: Float32Array;
  mapping: AxisVertexSymmetry | null;
}

/** Recovered default tolerance and three-axis candidate selection. */
export function detectAxisVertexSymmetry(
  positions: Float32Array,
  suppliedTolerance?: number,
): AxisSymmetryDetection {
  const f = Math.fround;
  if (positions.length % 3)
    throw new Error("Symmetry positions must contain complete float vertices.");
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index++) {
    const value = positions[index];
    if (!Number.isFinite(value))
      throw new Error("Symmetry positions must be finite.");
    const component = index % 3;
    minimum[component] = Math.min(minimum[component], value);
    maximum[component] = Math.max(maximum[component], value);
  }
  const center = new Float32Array(3);
  const vertices = positions.length / 3;
  let tolerance = f(1e-19);
  if (vertices) {
    for (let component = 0; component < 3; component++)
      center[component] = f(
        f(minimum[component] + maximum[component]) * f(0.5),
      );
    const x = f(maximum[0] - minimum[0]);
    const y = f(maximum[1] - minimum[1]);
    const z = f(maximum[2] - minimum[2]);
    const squared = f(f(f(y * y) + f(x * x)) + f(z * z));
    tolerance = Math.max(f(f(Math.sqrt(squared)) * f(0.0001)), tolerance);
    if (![...center, tolerance].every(Number.isFinite))
      throw new Error("Symmetry bounds arithmetic overflow.");
  }
  if (suppliedTolerance !== undefined) {
    tolerance = f(suppliedTolerance);
    if (!Number.isFinite(tolerance) || tolerance < 0)
      throw new Error("Symmetry tolerance must be finite and nonnegative.");
  }
  const axisScores = new Float32Array(3).fill(-1);
  let axis: 0 | 1 | 2 | null = null;
  let mapping: AxisVertexSymmetry | null = null;
  let coverage = 0;
  for (const candidateAxis of [0, 1, 2] as const) {
    const candidate = matchAxisVertexSymmetry(
      positions,
      candidateAxis,
      center[candidateAxis],
      tolerance,
      orderAxisVertices(positions, candidateAxis),
    );
    if (!candidate.completed) continue;
    const score = f(f(candidate.mappedVertexCount) / f(vertices));
    axisScores[candidateAxis] = score;
    if (score > f(0.95)) {
      axis = candidateAxis;
      mapping = candidate;
      coverage = score;
      break;
    }
    if (score > f(0.2) && score > coverage) {
      axis = candidateAxis;
      mapping = candidate;
      coverage = score;
    }
  }
  return { axis, center, tolerance, coverage, axisScores, mapping };
}
