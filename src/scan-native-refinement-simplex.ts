export interface RefinementResult {
  parameters: number[];
  error: number;
  iterations: number;
  converged: boolean;
}
type RefinementOptions = {
  budget?: number;
  step?: number;
  signal?: AbortSignal;
};
/** Both drivers consume the same search state machine in the same evaluation order. */
export function nativeRefinementSimplex(
  initial: readonly number[],
  objective: (parameters: readonly number[]) => number,
  options: RefinementOptions = {},
): RefinementResult {
  const steps = nativeRefinementSteps(initial, options);
  try {
    let step = steps.next();
    while (!step.done) step = steps.next(objective(step.value));
    return step.value;
  } finally {
    steps.return(undefined as never);
  }
}
export async function nativeRefinementSimplexAsync(
  initial: readonly number[],
  objective: (parameters: readonly number[]) => Promise<number>,
  options: RefinementOptions = {},
): Promise<RefinementResult> {
  const steps = nativeRefinementSteps(initial, options);
  try {
    let step = steps.next();
    while (!step.done) {
      const value = await objective(step.value);
      if (options.signal?.aborted)
        throw new DOMException("Alignment cancelled.", "AbortError");
      step = steps.next(value);
    }
    return step.value;
  } finally {
    steps.return(undefined as never);
  }
}
/** Recovered six-parameter refinement search. Geometry queries are supplied by the caller. */
function* nativeRefinementSteps(
  initial: readonly number[],
  options: { budget?: number; step?: number; signal?: AbortSignal } = {},
): Generator<readonly number[], RefinementResult, number> {
  const budget = options.budget ?? 1000;
  const step = options.step ?? Math.fround(0.0002);
  if (
    initial.length !== 6 ||
    !initial.every(Number.isFinite) ||
    !Number.isSafeInteger(budget) ||
    budget < 0 ||
    budget > 1_000_000 ||
    !Number.isFinite(step) ||
    step <= 0
  )
    throw new Error("Invalid six-parameter refinement search.");
  function* evaluate(
    parameters: readonly number[],
  ): Generator<readonly number[], number, number> {
    if (options.signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
    const value = yield Array.from(parameters);
    if (!Number.isFinite(value))
      throw new Error("Alignment objective must be finite.");
    return value;
  }
  const points = Array.from({ length: 7 }, () => Array.from(initial));
  for (let axis = 0; axis < 6; axis++)
    points[axis + 1][axis] +=
      initial[axis] === 0 ? step : Math.abs(initial[axis]) * step;
  const errors: number[] = [];
  for (const point of points) errors.push(yield* evaluate(point));
  const order = [0, 1, 2, 3, 4, 5, 6];
  const sort = () => {
    // Native insertion sort is stable for the seven-point refinement simplex.
    for (let id = 1; id < 7; id++) {
      const value = order[id];
      let position = id;
      while (position > 0 && errors[value] < errors[order[position - 1]]) {
        order[position] = order[position - 1];
        position--;
      }
      order[position] = value;
    }
  };
  const converged = () => {
    let sum = 0;
    for (const error of errors) sum += error;
    const mean = sum / 7;
    let variance = 0;
    for (const error of errors) {
      const difference = error - mean;
      variance += difference * difference;
    }
    if (Math.sqrt(variance / 7) > 1e-8) return false;
    const best = points[order[0]];
    for (let id = 1; id < 7; id++) {
      let squared = 0;
      for (let axis = 0; axis < 6; axis++) {
        const difference = points[order[id]][axis] - best[axis];
        squared += difference * difference;
      }
      if (Math.sqrt(squared) > 1e-10) return false;
    }
    return true;
  };
  let iterations = 0;
  for (; iterations < budget; iterations++) {
    sort();
    if (converged()) break;
    const center = Array<number>(6).fill(0);
    for (let id = 0; id < 6; id++)
      for (let axis = 0; axis < 6; axis++)
        center[axis] += points[order[id]][axis];
    for (let axis = 0; axis < 6; axis++) center[axis] /= 6;
    const worst = order[6],
      bestError = errors[order[0]],
      secondError = errors[order[5]],
      worstError = errors[worst];
    const reflected = center.map(
      (value, axis) => (points[worst][axis] - value) * -1 + value,
    );
    const reflectedError = yield* evaluate(reflected);
    const replace = (candidate: number[], error: number) => {
      points[worst] = candidate;
      errors[worst] = error;
    };
    function* shrink(): Generator<readonly number[], void, number> {
      const best = points[order[0]];
      for (let id = 1; id < 7; id++) {
        const index = order[id];
        points[index] = points[index].map(
          (value, axis) => (value - best[axis]) * 0.5 + best[axis],
        );
        errors[index] = yield* evaluate(points[index]);
      }
    }
    if (bestError <= reflectedError) {
      if (reflectedError < secondError) replace(reflected, reflectedError);
      else if (worstError <= reflectedError) {
        const contracted = center.map(
          (value, axis) => (points[worst][axis] - value) * -0.5 + value,
        );
        const error = yield* evaluate(contracted);
        if (worstError <= error) yield* shrink();
        else replace(contracted, error);
      } else {
        const contracted = center.map(
          (value, axis) => (reflected[axis] - value) * 0.5 + value,
        );
        const error = yield* evaluate(contracted);
        if (reflectedError < error) yield* shrink();
        else replace(contracted, error);
      }
    } else {
      const expanded = center.map(
        (value, axis) => (reflected[axis] - value) * 2 + value,
      );
      const error = yield* evaluate(expanded);
      if (error < reflectedError) replace(expanded, error);
      else replace(reflected, reflectedError);
    }
  }
  sort();
  return {
    parameters: points[order[0]].slice(),
    error: errors[order[0]],
    iterations,
    converged: iterations < budget,
  };
}
