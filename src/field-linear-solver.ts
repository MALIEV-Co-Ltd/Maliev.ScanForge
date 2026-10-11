/** Full symmetric positive-definite sparse rows; geometric matrix assembly is not yet recovered. */
export interface FieldLinearSystem {
  offsets: Uint32Array;
  indices: Uint32Array;
  coefficients: Float64Array;
  rightHandSide: Float64Array;
}

export interface FieldSolveOptions {
  seedIndices: Uint32Array;
  relativeTolerance: number;
  maxIterations: number;
  diagonalScaling: boolean;
  signal?: AbortSignal;
}

export interface FieldSolveResult {
  solution: Float64Array;
  status: "converged" | "iteration-limit" | "breakdown";
  iterations: number;
  initialStatistic: number;
  finalStatistic: number;
  activeCount: number;
}

/**
 * Recovered active-set CG recurrence. Does not assemble geometric equations,
 * enforce integer constraints, or certify that a supplied matrix is symmetric.
 * Inputs are immutable; malformed/nonfinite browser inputs are rejected.
 */
export function solveFieldLinearSystem(
  system: FieldLinearSystem,
  initial: Float64Array,
  options: FieldSolveOptions,
): FieldSolveResult {
  const { offsets, indices, coefficients, rightHandSide: rhs } = system;
  const size = rhs.length;
  if (
    initial.length !== size ||
    offsets.length !== size + 1 ||
    offsets[0] !== 0 ||
    offsets[size] !== indices.length ||
    indices.length !== coefficients.length
  )
    throw new Error("Sparse field-system dimensions do not match.");
  for (let row = 0; row < size; row++)
    if (offsets[row] > offsets[row + 1])
      throw new Error("Sparse field-system offsets must be ordered.");
  for (let i = 0; i < indices.length; i++)
    if (indices[i] >= size || !Number.isFinite(coefficients[i]))
      throw new Error("Sparse field-system entry is invalid.");
  for (let i = 0; i < size; i++)
    if (!Number.isFinite(initial[i]) || !Number.isFinite(rhs[i]))
      throw new Error("Field-system vectors must be finite.");
  if (
    !Number.isFinite(options.relativeTolerance) ||
    options.relativeTolerance < 0 ||
    !Number.isFinite(options.relativeTolerance ** 2) ||
    !Number.isInteger(options.maxIterations) ||
    options.maxIterations < -1 ||
    options.maxIterations > 2147483647
  )
    throw new Error("Field-system solve limits are invalid.");
  const checkCancelled = () => {
    if (options.signal?.aborted)
      throw new DOMException("Field solve cancelled.", "AbortError");
  };
  checkCancelled();
  const solution = new Float64Array(initial);
  const residual = new Float64Array(size);
  const direction = new Float64Array(size);
  const product = new Float64Array(size);
  const inverseDiagonal = options.diagonalScaling
    ? new Float64Array(size).fill(1)
    : undefined;
  if (inverseDiagonal)
    for (let row = 0; row < size; row++)
      for (let k = offsets[row]; k < offsets[row + 1]; k++)
        if (indices[k] === row) {
          if (coefficients[k] !== 0) inverseDiagonal[row] = 1 / coefficients[k];
          break;
        }
  const marked = new Int32Array(size).fill(-1);
  let active = new Uint32Array(size);
  let nextActive = new Uint32Array(size);
  let count = 0;
  let statistic = 0;
  for (const row of options.seedIndices) {
    if (row >= size || marked[row] === 0)
      throw new Error("Field solve seeds must be unique valid indices.");
    marked[row] = 0;
    active[count++] = row;
    let product = 0;
    for (let k = offsets[row]; k < offsets[row + 1]; k++)
      product += coefficients[k] * solution[indices[k]];
    const value = rhs[row] - product;
    residual[row] = value;
    direction[row] = value * (inverseDiagonal?.[row] ?? 1);
    statistic += value * direction[row];
  }
  const initialStatistic = statistic;
  const result = (
    status: FieldSolveResult["status"],
    iterations: number,
  ): FieldSolveResult => ({
    solution,
    status,
    iterations,
    initialStatistic,
    finalStatistic: statistic,
    activeCount: count,
  });
  if (!Number.isFinite(statistic)) return result("breakdown", 0);
  // Native policy: this absolute gate precedes the relative convergence test.
  if (statistic < 0.00001) return result("converged", 0);
  const limit = options.maxIterations === -1 ? 1000 : options.maxIterations;
  const threshold = initialStatistic * options.relativeTolerance ** 2;
  for (let iteration = 0; iteration < limit; iteration++) {
    checkCancelled();
    if (statistic < threshold) return result("converged", iteration);
    let nextCount = 0;
    const generation = iteration + 1;
    const touch = (row: number, value: number) => {
      if (marked[row] === generation) product[row] += value;
      else {
        marked[row] = generation;
        product[row] = value;
        nextActive[nextCount++] = row;
      }
    };
    // Scatter rows and retain isolated active entries, matching native support growth.
    for (let i = 0; i < count; i++) {
      const row = active[i];
      for (let k = offsets[row]; k < offsets[row + 1]; k++)
        touch(indices[k], direction[row] * coefficients[k]);
    }
    for (let i = 0; i < count; i++)
      if (marked[active[i]] !== generation) touch(active[i], 0);
    let denominator = 0;
    for (let i = 0; i < count; i++) {
      const row = active[i];
      denominator += direction[row] * product[row];
    }
    if (denominator === 0 || !Number.isFinite(denominator))
      return result("breakdown", iteration);
    const alpha = statistic / denominator;
    for (let i = 0; i < count; i++) {
      const row = active[i];
      solution[row] += alpha * direction[row];
    }
    let following = 0;
    for (let i = 0; i < nextCount; i++) {
      const row = nextActive[i];
      residual[row] -= alpha * product[row];
      following +=
        residual[row] * (residual[row] * (inverseDiagonal?.[row] ?? 1));
    }
    if (!Number.isFinite(following)) return result("breakdown", iteration + 1);
    const beta = following / statistic;
    for (let i = 0; i < nextCount; i++) {
      const row = nextActive[i];
      direction[row] =
        beta * direction[row] + residual[row] * (inverseDiagonal?.[row] ?? 1);
    }
    statistic = following;
    [active, nextActive] = [nextActive, active];
    count = nextCount;
  }
  // The recovered routine checks convergence at loop entry, including the final limit.
  return result("iteration-limit", limit);
}
