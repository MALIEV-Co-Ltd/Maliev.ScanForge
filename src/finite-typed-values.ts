/** Validate typed coordinates without boxing each value through an array callback. */
export function finiteTypedValues(
  values: Float32Array | Float64Array,
): boolean {
  for (let i = 0; i < values.length; i++)
    if (!Number.isFinite(values[i])) return false;
  return true;
}
