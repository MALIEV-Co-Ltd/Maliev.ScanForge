import type { NurbsPatch } from "./surfaces";
import type { Vec3 } from "./types";

// Fixed-size normal equations retain the fitting path's ordered LDL arithmetic.
function normalEquations(rows: number[][], check?: () => void) {
  const n = rows[0].length,
    factor = new Float64Array(n * n);
  for (const row of rows)
    for (let i = 0; i < n; i++)
      for (let j = 0; j <= i; j++) factor[i * n + j] += row[j] * row[i];
  for (let row = 0; row < n; row++) {
    check?.();
    for (let column = 0; column < row; column++) {
      let sum = 0;
      for (let k = 0; k < column; k++)
        sum += factor[row * n + k] * factor[column * n + k];
      factor[row * n + column] -= sum;
    }
    for (let column = 0; column < row; column++) {
      const diagonal = factor[column * n + column],
        value = factor[row * n + column];
      if (Math.abs(diagonal) <= 1e-20)
        throw new Error("Curvature grid fitting is singular.");
      factor[row * n + column] = value / diagonal;
      factor[row * n + row] -= value * factor[row * n + column];
    }
  }
  return (values: number[]) => {
    const rhs = new Float64Array(n);
    for (let row = 0; row < rows.length; row++)
      for (let column = 0; column < n; column++)
        rhs[column] += rows[row][column] * values[row];
    for (let row = 0; row < n; row++) {
      let sum = 0;
      for (let column = 0; column < row; column++)
        sum += factor[row * n + column] * rhs[column];
      rhs[row] -= sum;
    }
    for (let row = 0; row < n; row++) {
      const diagonal = factor[row * n + row];
      if (Math.abs(diagonal) <= 1e-20)
        throw new Error("Curvature grid fitting is singular.");
      rhs[row] /= diagonal;
    }
    for (let row = n - 1; row > 0; row--)
      for (let column = 0; column < row; column++)
        rhs[column] -= factor[row * n + column] * rhs[row];
    if (rhs.some((value) => !Number.isFinite(value)))
      throw new Error("Curvature grid fitting overflowed.");
    return rhs;
  };
}

function endpointBasis(u: number) {
  const lower = Array<number>(8).fill(0);
  lower[0] = 1;
  for (let degree = 1; degree < 8; degree++) {
    let carry = 0;
    for (let i = 0; i < degree; i++) {
      const previous = lower[i],
        next = u * previous;
      lower[i] = previous - next + carry;
      carry = next;
    }
    lower[degree] = carry;
  }
  return [
    (1 - u) * lower[0],
    ...Array.from(
      { length: 7 },
      (_, i) => (1 - u) * lower[i + 1] + u * lower[i],
    ),
    u * lower[7],
  ];
}

function endpointTangent(poles: number[], end: number) {
  // The right-end polynomial evaluation has observable rounding in later meshing.
  const differences = [...poles];
  const degree = poles.length - 1;
  for (let order = 0; order < degree; order++)
    for (let i = degree; i > order; i--) differences[i] -= differences[i - 1];
  for (let order = 0; order < degree; order++)
    for (let i = order; i >= 0; i--) differences[i] += end * differences[i + 1];
  return degree * differences[1];
}

function cubicBasis(knots: number[], count: number, u: number) {
  let span = 3;
  while (span < count - 1 && knots[span + 1] <= u) span++;
  const local = [1, 0, 0, 0];
  for (let width = 2; width <= 4; width++) {
    local[width - 1] = 0;
    for (let column = 0; column < width - 1; column++) {
      const low = knots[span - width + column + 2],
        high = knots[span + column + 1],
        inverse = 1 / (high - low);
      const saved = (u - low) * inverse * local[column];
      local[column] *= (high - u) * inverse;
      local[column] += local[width - 1];
      local[width - 1] = saved;
    }
  }
  const basis = Array<number>(count).fill(0);
  for (let i = 0; i < 4; i++) basis[span - 3 + i] = local[i];
  return basis;
}

/** Fixed cubic C2 interpolation used after the Curvature field's Float32 grid. */
export function interpolateNativeCurvatureGrid(
  input: readonly (readonly (readonly number[])[])[],
  check?: () => void,
): { patch: NurbsPatch; parameters: { u: number[]; v: number[] } } {
  check?.();
  if (input.length !== 21 || input.some((row) => row.length !== 21))
    throw new Error("Curvature requires a 21 by 21 sample grid.");
  if (
    input.some((row) =>
      row.some((point) => point.length !== 3 || !point.every(Number.isFinite)),
    )
  )
    throw new Error("Curvature grid coordinates must be finite XYZ values.");
  const grid = input.map((row) => row.map((point) => [...point] as Vec3));

  function interpolate(samples: Vec3[][]) {
    const n = samples.length,
      width = samples[0].length,
      parameters = [0];
    for (let i = 1; i < n; i++) {
      check?.();
      let squared = 0;
      for (let curve = 0; curve < width; curve++) {
        const d = samples[i][curve].map(
          (value, a) => value - samples[i - 1][curve][a],
        );
        squared += d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      }
      parameters.push(parameters[i - 1] + Math.sqrt(squared));
    }
    const length = parameters[n - 1];
    if (!(length > 0) || !Number.isFinite(length))
      throw new Error(
        "Curvature grid has a degenerate or overflowing direction.",
      );
    for (let i = 0; i < n; i++) parameters[i] /= length;
    if (parameters.some((value, i) => i > 0 && value <= parameters[i - 1]))
      throw new Error("Curvature grid has coincident sample rows.");
    const count = n + 2;
    const knots = [
      ...Array<number>(4).fill(0),
      ...parameters.slice(1, -1),
      ...Array<number>(4).fill(1),
    ];
    const matrix = parameters.map((value) => cubicBasis(knots, count, value));
    const solve = normalEquations(
      matrix.slice(1, -1).map((row) => row.slice(2, -2)),
      check,
    );
    const endpoints = [0, n - 9].map((start) => {
      // The endpoint fit uses the original parameters, without rescaling its nine-point window.
      const basis = parameters.slice(start, start + 9).map(endpointBasis);
      return {
        start,
        basis,
        solve: normalEquations(
          basis.slice(1, -1).map((row) => row.slice(1, -1)),
          check,
        ),
      };
    });
    const poles = Array.from({ length: count }, () =>
      Array.from({ length: width }, () => [0, 0, 0] as Vec3),
    );
    for (let curve = 0; curve < width; curve++) {
      check?.();
      for (let axis = 0; axis < 3; axis++) {
        const values = samples.map((row) => row[curve][axis]);
        const tangent = endpoints.map(({ start, basis, solve }, end) => {
          const first = values[start],
            last = values[start + 8];
          const fitted = solve(
            basis
              .slice(1, -1)
              .map(
                (row, i) =>
                  values[start + i + 1] - row[0] * first - row[8] * last,
              ),
          );
          return endpointTangent([first, ...fitted, last], end);
        });
        const low = values[0],
          high = values[n - 1];
        const first =
          low +
          (((1 / 3) * (parameters[1] - parameters[0])) /
            (parameters[n - 1] - parameters[0])) *
            tangent[0];
        const last =
          high -
          (((1 / 3) * (parameters[n - 1] - parameters[n - 2])) /
            (parameters[n - 1] - parameters[0])) *
            tangent[1];
        poles[0][curve][axis] = low;
        poles[1][curve][axis] = first;
        poles[count - 2][curve][axis] = last;
        poles[count - 1][curve][axis] = high;
        const rhs = matrix
          .slice(1, -1)
          .map(
            (row, i) =>
              values[i + 1] -
              row[0] * low -
              row[count - 1] * high -
              row[1] * first -
              row[count - 2] * last,
          );
        const fitted = solve(rhs);
        for (let row = 0; row < fitted.length; row++)
          poles[row + 2][curve][axis] = fitted[row];
      }
    }
    return { poles, knots, count, parameters };
  }

  const v = interpolate(
    grid[0].map((_, row) => grid.map((column) => column[row])),
  );
  const u = interpolate(
    grid.map((_, row) => v.poles.map((column) => column[row])),
  );
  return {
    patch: {
      format: "scanforge-nurbs",
      version: 1,
      countU: u.count,
      countV: v.count,
      degreeU: 3,
      degreeV: 3,
      knotsU: u.knots,
      knotsV: v.knots,
      points: v.poles.flatMap((_, row) => u.poles.map((column) => column[row])),
      weights: Array<number>(u.count * v.count).fill(1),
    },
    parameters: { u: u.parameters, v: v.parameters },
  };
}
