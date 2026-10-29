/** Validate typed coordinates without boxing each value through an array callback. */
export function finiteTypedValues(
  values: Float32Array | Float64Array,
): boolean {
  for (let i = 0; i < values.length; i++)
    if (!Number.isFinite(values[i])) return false;
  return true;
}

// Restored worker coordinates are usually large dense-double arrays. Keep their
// validator's JIT feedback separate from arbitrary arrays. This marker never
// trusts their contents: later mutations are still checked on every call.
const restoredCoordinates = new WeakSet<number[]>();
export function markRestoredCoordinates(values: number[]): number[] {
  restoredCoordinates.add(values);
  return values;
}

function finiteRestoredCoordinates(values: number[]): boolean {
  const length = values.length;
  for (let i = 0; i < length; i++) {
    if (!(i in values)) continue;
    const value = values[i];
    if (
      typeof value !== "number" ||
      !(value >= -Number.MAX_VALUE && value <= Number.MAX_VALUE)
    )
      return false;
  }
  return true;
}

/** Match Array.every's sparse-slot behavior without per-number callback boxing. */
export function finiteArrayValues(values: number[]): boolean {
  if (restoredCoordinates.has(values)) return finiteRestoredCoordinates(values);
  const length = values.length;
  for (let i = 0; i < length; i++) {
    if (!(i in values)) continue;
    const value = values[i];
    if (
      typeof value !== "number" ||
      !(value >= -Number.MAX_VALUE && value <= Number.MAX_VALUE)
    )
      return false;
  }
  return true;
}
