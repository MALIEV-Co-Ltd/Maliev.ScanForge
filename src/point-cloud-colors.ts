/** Opaque RGBA bytes index point slots, independently of XYZ backing storage. */
export function validatePointColors(
  pointColors: Uint8Array | undefined,
  pointCount: number,
): void {
  if (
    !Number.isSafeInteger(pointCount) ||
    pointCount < 0 ||
    !Number.isSafeInteger(pointCount * 4)
  )
    throw new Error("Point count must be a nonnegative safe integer.");
  if (pointColors === undefined) return;
  if (
    !(pointColors instanceof Uint8Array) ||
    pointColors.length !== pointCount * 4
  )
    throw new Error("Point colors must contain four RGBA bytes per point.");
  for (let offset = 3; offset < pointColors.length; offset += 4)
    if (pointColors[offset] !== 255)
      throw new Error("Point colors must be opaque (alpha 255).");
}

export function reindexPointColors(
  pointColors: Uint8Array | undefined,
  sourceIndices: Uint32Array,
  sourcePointCount: number,
): Uint8Array | undefined {
  validatePointColors(pointColors, sourcePointCount);
  if (!(sourceIndices instanceof Uint32Array))
    throw new Error(
      "Point color correspondence requires original point indices.",
    );
  for (const index of sourceIndices)
    if (index >= sourcePointCount)
      throw new Error(
        "Point color source index is outside the original point slots.",
      );
  if (pointColors === undefined) return undefined;
  const result = new Uint8Array(sourceIndices.length * 4);
  for (let index = 0; index < sourceIndices.length; index++) {
    const source = sourceIndices[index] * 4;
    for (let channel = 0; channel < 4; channel++)
      result[index * 4 + channel] = pointColors[source + channel];
  }
  return result;
}
