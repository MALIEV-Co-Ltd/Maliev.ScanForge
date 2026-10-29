import type { Sketch } from "./sketch";

/** Operation-local bounds; imported/stored Sketch graphs have no new size cap. */
export const SKETCH_SOLVER_LIMITS = Object.freeze({
  cells: 262_144,
  work: 2_000_000,
  validationWork: 2_000_000,
});

export class SketchSolverResourceLimit extends Error {
  constructor(detail: string) {
    super(
      `Sketch solver ${detail}. Use a smaller sketch or split the solve; the original graph is preserved.`,
    );
    this.name = "SketchSolverResourceLimit";
  }
}

/** Bound prospective validation, Jacobian/rank and each actual dense iteration. */
export function createSketchSolverBudget(input: Sketch): {
  iteration(): void;
  diagnostics(): void;
} {
  if (
    !input ||
    !Array.isArray(input.points) ||
    !Array.isArray(input.segments) ||
    !Array.isArray(input.constraints) ||
    (input.arcs !== undefined && !Array.isArray(input.arcs))
  )
    throw new Error("Unsupported sketch structure.");
  const points = input.points.length,
    segments = input.segments.length,
    arcs = input.arcs?.length ?? 0,
    constraints = input.constraints.length,
    referenceCoordinates = Array.isArray(input.reference?.segments)
      ? input.reference.segments.length
      : 0;
  const validationWork =
    points +
    segments +
    arcs +
    referenceCoordinates +
    constraints * (8 + points + segments + arcs);
  if (validationWork > SKETCH_SOLVER_LIMITS.validationWork)
    throw new SketchSolverResourceLimit("validation work limit exceeded");
  const arcIds = new Set(input.arcs?.map((arc) => arc?.id));
  const n = points * 2;
  const m = input.constraints.reduce(
    (rows, constraint) =>
      rows +
      (constraint?.kind === "fixed" ||
      constraint?.kind === "coincident" ||
      constraint?.kind === "collinear"
        ? 2
        : constraint?.kind === "symmetric"
          ? arcIds.has(constraint.first)
            ? 6
            : 4
          : 1),
    arcs,
  );
  // Each finite-difference column copies n variables even with no residuals.
  // Degeneracy recovery may evaluate a residual twice for the same column.
  const jacobianWork = n * n + 2 * n * m;
  const diagnosticWork = jacobianWork + Math.min(n, m) * m * n;
  const iterationWork = jacobianWork + m * n * n + n * n * n;
  // Jacobian plus rank copy, or Jacobian/normal matrix/linear augmented copy.
  const diagnosticCells = 2 * m * n + 3 * n + 3 * m;
  const iterationCells = m * n + 2 * n * n + 6 * n + 3 * m;
  let spent = validationWork;
  const admit = (cells: number, work: number) => {
    if (
      !Number.isFinite(cells) ||
      !Number.isFinite(work) ||
      cells > SKETCH_SOLVER_LIMITS.cells ||
      work > SKETCH_SOLVER_LIMITS.work
    )
      throw new SketchSolverResourceLimit(
        "dense allocation/work budget exceeded",
      );
  };
  // A satisfied graph needs no dense iteration; only reserve its final diagnostics.
  admit(diagnosticCells, spent + diagnosticWork);
  return {
    iteration() {
      // Preserve enough budget to finish final Jacobian/rank as well.
      admit(iterationCells, spent + iterationWork + diagnosticWork);
      spent += iterationWork;
    },
    diagnostics() {
      admit(diagnosticCells, spent + diagnosticWork);
      spent += diagnosticWork;
    },
  };
}
