export interface NativeSketchWireValidationResult {
  status: number;
  /** Retention is not proof of full native backend or builder success. */
  retainCandidate: boolean;
}

/**
 * Normal-return postchecking of an existing candidate with incoming status 0/6.
 * Checker results and the version-sensitive promotion predicate are supplied
 * facts, never inferred from an OpenCascade shape or assigned default values.
 */
export function resolveNativeSketchWireValidation(
  input: unknown,
): NativeSketchWireValidationResult {
  const invalid = () => new Error("Invalid native wire validation result.");
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid();
  const r = input as Record<string, unknown>;
  if (
    (r.initialStatus !== 0 && r.initialStatus !== 6) ||
    typeof r.generalStatus !== "number" ||
    !Number.isInteger(r.generalStatus) ||
    r.generalStatus < -2147483648 ||
    r.generalStatus > 2147483647
  )
    throw invalid();
  const passed = r.generalStatus === 1;
  const field = passed ? "boundsPassed" : "promoteRetainedStatus";
  if (
    Object.keys(r).length !== 3 ||
    Object.keys(r).some(
      (k) => k !== "initialStatus" && k !== "generalStatus" && k !== field,
    ) ||
    typeof r[field] !== "boolean"
  )
    throw invalid();
  let status: number = r.initialStatus;
  if (passed) {
    if (!r.boundsPassed) status = 4;
  } else {
    if (r.generalStatus === 5 || r.generalStatus === 6) status = 5;
    else if (r.generalStatus === 13) status = 7;
    else if (status === 0) status = 4;
    if (r.promoteRetainedStatus && status === 6) status = 4;
  }
  return { status, retainCandidate: status === 0 || status === 6 };
}
