import type { FieldLinearSystem } from "./field-linear-solver";

export interface FieldVariableValue {
  variable: number;
  value: number;
}

/** Recovered full-CSR fixing branch; apply each variable once per original system. */
export function fixFieldVariables(
  system: FieldLinearSystem,
  values: readonly FieldVariableValue[],
): FieldLinearSystem {
  const { offsets, indices, coefficients, rightHandSide } = system;
  const size = rightHandSide.length;
  if (
    offsets.length !== size + 1 ||
    offsets[0] !== 0 ||
    offsets[size] !== indices.length ||
    indices.length !== coefficients.length
  )
    throw new Error("Invalid field fixing dimensions.");
  const entry = (row: number, column: number): number => {
    let low = offsets[row],
      high = offsets[row + 1];
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (indices[middle] < column) low = middle + 1;
      else high = middle;
    }
    return low < offsets[row + 1] && indices[low] === column ? low : -1;
  };
  for (let row = 0; row < size; row++) {
    if (offsets[row] > offsets[row + 1] || !Number.isFinite(rightHandSide[row]))
      throw new Error("Invalid field fixing rows or right-hand side.");
    let previous = -1;
    for (let k = offsets[row]; k < offsets[row + 1]; k++) {
      const column = indices[k];
      if (
        column >= size ||
        column <= previous ||
        !Number.isFinite(coefficients[k])
      )
        throw new Error(
          "Field fixing requires sorted unique finite sparse rows.",
        );
      previous = column;
    }
  }
  // The native branch assumes an explicit diagonal and a paired entry for every neighbor.
  for (let row = 0; row < size; row++) {
    if (entry(row, row) < 0)
      throw new Error(
        "Field fixing requires an explicit diagonal in every row.",
      );
    for (let k = offsets[row]; k < offsets[row + 1]; k++) {
      const opposite = entry(indices[k], row);
      if (opposite < 0 || coefficients[opposite] !== coefficients[k])
        throw new Error(
          "Field fixing requires a full symmetric sparse system.",
        );
    }
  }
  const used = new Set<number>();
  for (const { variable, value } of values) {
    if (
      !Number.isInteger(variable) ||
      variable < 0 ||
      variable >= size ||
      used.has(variable) ||
      !Number.isFinite(value)
    )
      throw new Error(
        "Fixed field variables must be unique valid indices with finite values.",
      );
    used.add(variable);
  }
  const output: FieldLinearSystem = {
    offsets: offsets.slice(),
    indices: indices.slice(),
    coefficients: coefficients.slice(),
    rightHandSide: rightHandSide.slice(),
  };
  for (const { variable, value } of values) {
    for (let k = offsets[variable]; k < offsets[variable + 1]; k++) {
      const neighbor = indices[k];
      if (neighbor === variable) {
        output.coefficients[k] = 1;
        output.rightHandSide[variable] = value;
      } else {
        output.coefficients[k] = 0;
        const opposite = entry(neighbor, variable);
        const coefficient = output.coefficients[opposite];
        output.coefficients[opposite] = 0;
        output.rightHandSide[neighbor] -= coefficient * value;
        if (!Number.isFinite(output.rightHandSide[neighbor]))
          throw new Error("Field fixing right-hand side overflowed.");
      }
    }
  }
  return output;
}
