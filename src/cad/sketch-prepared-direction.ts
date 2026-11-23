import type { ReferenceVector } from "../reference-construction-values";

/** Pinned OpenCascade.js bridge for an already normalized native direction. */
export function createPreparedSketchDirection(
  oc: Record<string, any>,
  coordinates: ReferenceVector,
) {
  const squared = coordinates.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squared) || Math.abs(squared - 1) > 32 * Number.EPSILON)
    throw new Error("Line direction must be prepared near unit length.");
  const direction = new oc.gp_Dir_4(...coordinates);
  try {
    const actual = [direction.X(), direction.Y(), direction.Z()];
    if (actual.every((value, axis) => Object.is(value, coordinates[axis])))
      return direction;

    // gp_Dir normalizes again; XYZ() returns a copy in these bindings. Restore
    // only this newly owned object's three doubles, after checking its layout.
    const heap = oc.HEAPF64;
    const pointer = direction.$$?.ptr;
    if (
      !ArrayBuffer.isView(heap) ||
      Object.prototype.toString.call(heap) !== "[object Float64Array]" ||
      direction.$$?.ptrType?.name !== "gp_Dir_4*" ||
      !Number.isSafeInteger(pointer) ||
      pointer <= 0 ||
      pointer % 8 !== 0 ||
      pointer / 8 + 3 > (heap as Float64Array).length
    )
      throw new Error("Unsupported prepared line direction kernel binding.");
    const values = heap as Float64Array;
    const offset = pointer / 8;
    if (!actual.every((value, axis) => Object.is(value, values[offset + axis])))
      throw new Error("Prepared line direction kernel layout mismatch.");
    values.set(coordinates, offset);
    try {
      const retained = [direction.X(), direction.Y(), direction.Z()];
      if (!retained.every((value, axis) => Object.is(value, coordinates[axis])))
        throw new Error("Prepared line direction kernel readback mismatch.");
    } catch (error) {
      try {
        values.set(actual, offset);
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          "Prepared direction rollback failed.",
        );
      }
      throw error;
    }
    return direction;
  } catch (error) {
    try {
      direction.delete();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Prepared direction cleanup failed.",
      );
    }
    throw error;
  }
}
