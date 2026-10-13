export type NativeDatumAxisPlacement =
  "segmentMidpoint" | "extrusionMidpoint" | "origin";

function finiteVector(values: readonly number[]) {
  if (values.length !== 3 || !values.every(Number.isFinite))
    throw new Error("Datum feature requires a finite XYZ vector.");
}

/** Original fitted-feature axis conversion; picking resolves its payload layout separately. */
export function nativeDatumAxisGeometry(
  origin: readonly number[],
  direction: readonly number[],
  length: number,
  placement: NativeDatumAxisPlacement,
): { point: number[]; direction: number[] } {
  finiteVector(origin);
  finiteVector(direction);
  if (
    !Number.isFinite(length) ||
    !["segmentMidpoint", "extrusionMidpoint", "origin"].includes(placement)
  )
    throw new Error(
      "Datum axis requires a finite length and supported placement.",
    );
  const point =
    placement === "segmentMidpoint"
      ? origin.map((value, i) => (length * direction[i] + value + value) * 0.5)
      : placement === "extrusionMidpoint"
        ? origin.map((value, i) => length * direction[i] * 0.5 + value)
        : [...origin];
  return { point, direction: [...direction] };
}

/** Supported native point payloads copy their stored XYZ coordinates unchanged. */
export function nativeDatumPointGeometry(origin: readonly number[]): number[] {
  finiteVector(origin);
  return [...origin];
}
