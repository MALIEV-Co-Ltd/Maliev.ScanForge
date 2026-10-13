/** Recovered native simplex search used by paired-point alignment.
 * Evaluations and tie rules retain source order; this is not the complete solver.
 */
export function nativeAlignmentSimplex(
  initial: readonly number[],
  objective: (parameters: readonly number[]) => number,
  tolerance = 0.0001,
  budget = 1000,
  step = Math.fround(0.005),
  signal?: AbortSignal,
): { parameters: number[]; error: number; status: 1 | 2 } {
  const dimensions = initial.length;
  if (
    dimensions < 1 ||
    dimensions > 32 ||
    !initial.every(Number.isFinite) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    !Number.isSafeInteger(budget) ||
    budget > 1_000_000 ||
    !Number.isFinite(step) ||
    step <= 0
  )
    throw new Error("Invalid alignment simplex parameters.");
  const evaluate = (parameters: readonly number[]) => {
    if (signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
    const result = objective(parameters);
    if (!Number.isFinite(result))
      throw new Error("Alignment objective must be finite.");
    return result;
  };
  const points: number[][] = [Array.from(initial)];
  const errors = [evaluate(points[0])];
  for (let axis = 0; axis < dimensions; axis++) {
    const delta =
      Math.abs(initial[axis]) >= 2 ** -23 ? initial[axis] * step : step;
    const positive = Array.from(initial);
    positive[axis] += delta;
    const positiveError = evaluate(positive);
    const negative = Array.from(initial);
    negative[axis] -= delta;
    const negativeError = evaluate(negative);
    const usePositive = positiveError <= negativeError;
    points.push(usePositive ? positive : negative);
    errors.push(usePositive ? positiveError : negativeError);
  }
  const sums = new Array<number>(dimensions).fill(0);
  const sum = () => {
    for (let axis = 0; axis < dimensions; axis++) {
      let value = 0;
      for (let row = 0; row <= dimensions; row++) value += points[row][axis];
      sums[axis] = value;
    }
  };
  sum();
  const trial = (worst: number, factor: number) => {
    const coefficient = (1 - factor) / dimensions;
    const candidate = sums.map(
      (value, axis) =>
        coefficient * value - (coefficient - factor) * points[worst][axis],
    );
    const error = evaluate(candidate);
    if (error < errors[worst]) {
      errors[worst] = error;
      for (let axis = 0; axis < dimensions; axis++)
        sums[axis] = candidate[axis] - points[worst][axis] + sums[axis];
      points[worst] = candidate;
    }
    return error;
  };
  let evaluations = 0;
  while (true) {
    let best = 0;
    let second = errors[1] < errors[0] ? 1 : 0;
    let worst = errors[0] <= errors[1] ? 1 : 0;
    for (let row = 0; row <= dimensions; row++) {
      if (errors[row] <= errors[best]) best = row;
      if (errors[row] <= errors[worst]) {
        if (errors[second] < errors[row] && row !== worst) second = row;
      } else {
        second = worst;
        worst = row;
      }
    }
    const spread = Math.abs(errors[worst] - errors[best]);
    if (
      (spread + spread) / (Math.abs(errors[worst]) + Math.abs(errors[best])) <=
      tolerance
    )
      return {
        parameters: points[best].slice(),
        error: errors[best],
        status: 1,
      };
    if (budget < evaluations)
      return {
        parameters: points[best].slice(),
        error: errors[best],
        status: 2,
      };
    evaluations += 2;
    const reflected = trial(worst, -1);
    if (errors[best] < reflected) {
      if (reflected < errors[second]) evaluations--;
      else {
        const previous = errors[worst];
        const contracted = trial(worst, 0.5);
        if (previous <= contracted) {
          for (let row = 0; row <= dimensions; row++) {
            if (row === best) continue;
            for (let axis = 0; axis < dimensions; axis++)
              points[row][axis] =
                (points[best][axis] + points[row][axis]) * 0.5;
            errors[row] = evaluate(points[row]);
          }
          evaluations += dimensions;
          sum();
        }
      }
    } else trial(worst, 2);
  }
}
