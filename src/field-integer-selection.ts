import type { FieldVariableValue } from "./field-variable-fixing";

export interface FieldIntegerCandidates {
  solution: Float64Array;
  variables: Uint32Array;
  /** One flag per candidate ordinal, not per solution variable. */
  marked: Uint8Array;
  /** Empty or absent means unit scales. Otherwise one scale per candidate. */
  scales?: Float64Array;
}

export interface FieldIntegerChoice extends FieldVariableValue {
  ordinal: number;
}

export interface FieldIntegerBatch {
  choices: FieldIntegerChoice[];
  marked: Uint8Array;
  threshold: number;
  /** Includes the rejected candidate's residual when the native budget check stops. */
  budgetUsed: number;
}

function integerCandidates(input: FieldIntegerCandidates) {
  const { solution, variables, marked, scales } = input;
  if (
    marked.length !== variables.length ||
    (scales?.length && scales.length !== variables.length)
  )
    throw new Error(
      "Integer candidate flags and scales must match the candidate count.",
    );
  const seen = new Set<number>();
  return Array.from(variables, (variable, ordinal) => {
    if (
      variable >= solution.length ||
      seen.has(variable) ||
      marked[ordinal] > 1
    )
      throw new Error(
        "Integer candidates must have unique valid variables and boolean flags.",
      );
    seen.add(variable);
    const scale = scales?.length ? scales[ordinal] : 1;
    const scaled = solution[variable] / scale;
    const rounded = Math.trunc(scaled >= 0 ? scaled + 0.5 : scaled - 0.5) || 0;
    const target = rounded * scale;
    if (
      !Number.isFinite(scale) ||
      scale === 0 ||
      !Number.isFinite(scaled) ||
      !Number.isFinite(target) ||
      rounded < -2147483648 ||
      rounded > 2147483647
    )
      throw new Error(
        "Integer candidate rounding must remain finite and in the signed 32-bit range.",
      );
    return {
      ordinal,
      variable,
      value: target,
      residual: Math.abs(scaled - rounded),
    };
  });
}

/** Recovered unscaled single-choice branch; tie order is the candidate ordinal order. */
export function selectFieldIntegerVariable(
  input: Omit<FieldIntegerCandidates, "scales">,
): { choice: FieldIntegerChoice | null; marked: Uint8Array } {
  const candidates = integerCandidates({ ...input, scales: undefined });
  let nearest: (typeof candidates)[number] | undefined;
  for (const candidate of candidates)
    if (
      !input.marked[candidate.ordinal] &&
      (!nearest || candidate.residual < nearest.residual)
    )
      nearest = candidate;
  const marked = input.marked.slice();
  if (!nearest) return { choice: null, marked };
  marked[nearest.ordinal] = 1;
  return {
    choice: {
      ordinal: nearest.ordinal,
      variable: nearest.variable,
      value: nearest.value,
    },
    marked,
  };
}

/** Recovered batch selector and its threshold prepasses; scan-derived candidates are supplied. */
export function selectFieldIntegerBatch(
  input: FieldIntegerCandidates,
  budget: number,
  threshold: number,
): FieldIntegerBatch {
  if (
    !Number.isFinite(budget) ||
    budget < 0 ||
    !Number.isFinite(threshold) ||
    threshold < 0
  )
    throw new Error(
      "Integer selection budget and threshold must be finite and nonnegative.",
    );
  const candidates = integerCandidates(input);
  const { marked } = input;
  const output: FieldIntegerBatch = {
    choices: [],
    marked: marked.slice(),
    threshold,
    budgetUsed: 0,
  };
  const append = (candidate: (typeof candidates)[number]) => {
    output.choices.push({
      ordinal: candidate.ordinal,
      variable: candidate.variable,
      value: candidate.value,
    });
    output.marked[candidate.ordinal] = 1;
  };
  const thresholdPass = (limit: number) => {
    for (const candidate of candidates) {
      if (output.marked[candidate.ordinal] || candidate.residual >= limit)
        continue;
      output.budgetUsed += candidate.residual;
      if (output.budgetUsed > budget) return;
      append(candidate);
    }
  };
  if (threshold === 0) {
    for (const factor of [0.00001, 0.0001, 0.001, 0.01, 0.05]) {
      output.threshold = budget * factor;
      thresholdPass(output.threshold);
      if (!(output.budgetUsed < budget)) break;
    }
  }
  while (output.choices.length < candidates.length) {
    let nearest: (typeof candidates)[number] | undefined;
    for (const candidate of candidates)
      if (
        !output.marked[candidate.ordinal] &&
        (!nearest || candidate.residual < nearest.residual)
      )
        nearest = candidate;
    if (!nearest) break;
    output.budgetUsed += nearest.residual;
    if (output.budgetUsed > budget) {
      if (output.choices.length === 0) append(nearest);
      output.threshold = nearest.residual;
      break;
    }
    append(nearest);
  }
  return output;
}
