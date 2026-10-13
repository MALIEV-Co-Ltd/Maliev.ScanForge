/** Recovered six-parameter refinement search. Geometry queries are supplied by the caller. */
export function nativeRefinementSimplex(
  initial: readonly number[],
  objective: (parameters: readonly number[]) => number,
  options: { budget?: number; step?: number; signal?: AbortSignal } = {},
): {
  parameters: number[];
  error: number;
  iterations: number;
  converged: boolean;
} {
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
  const evaluate = (parameters: readonly number[]) => {
    if (options.signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
    const value = objective(Array.from(parameters));
    if (!Number.isFinite(value))
      throw new Error("Alignment objective must be finite.");
    return value;
  };
  const points = Array.from({ length: 7 }, () => Array.from(initial));
  for (let axis = 0; axis < 6; axis++)
    points[axis + 1][axis] +=
      initial[axis] === 0 ? step : Math.abs(initial[axis]) * step;
  const errors = points.map(evaluate);
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
    const reflectedError = evaluate(reflected);
    const replace = (candidate: number[], error: number) => {
      points[worst] = candidate;
      errors[worst] = error;
    };
    const shrink = () => {
      const best = points[order[0]];
      for (let id = 1; id < 7; id++) {
        const index = order[id];
        points[index] = points[index].map(
          (value, axis) => (value - best[axis]) * 0.5 + best[axis],
        );
        errors[index] = evaluate(points[index]);
      }
    };
    if (bestError <= reflectedError) {
      if (reflectedError < secondError) replace(reflected, reflectedError);
      else if (worstError <= reflectedError) {
        const contracted = center.map(
          (value, axis) => (points[worst][axis] - value) * -0.5 + value,
        );
        const error = evaluate(contracted);
        if (worstError <= error) shrink();
        else replace(contracted, error);
      } else {
        const contracted = center.map(
          (value, axis) => (reflected[axis] - value) * 0.5 + value,
        );
        const error = evaluate(contracted);
        if (reflectedError < error) shrink();
        else replace(contracted, error);
      }
    } else {
      const expanded = center.map(
        (value, axis) => (reflected[axis] - value) * 2 + value,
      );
      const error = evaluate(expanded);
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
