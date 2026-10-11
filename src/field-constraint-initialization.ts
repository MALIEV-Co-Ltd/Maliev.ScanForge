import type { FieldExclusionBits } from "./field-candidate-lists";

export interface FieldConstraintTransfer {
  targets: Int32Array;
  eligibleTargets: FieldExclusionBits;
  /** Two native 32-bit lanes whose scalar interpretation is still upstream. */
  lanes: [Uint32Array, Uint32Array];
  flags: Uint8Array;
}
export interface InitializedFieldConstraints {
  strengths: Float32Array;
  fixedFaces: FieldExclusionBits;
  fixedCount: number;
  lanes?: [Uint32Array, Uint32Array];
  flags?: Uint8Array;
}

/** Recovered default-mode seed initialization and supplied valid mapping transfer. */
export function initializeDefaultFieldConstraints(
  suppliedStrengths: Float32Array,
  transfer?: FieldConstraintTransfer,
): InitializedFieldConstraints {
  const faces = suppliedStrengths.length;
  for (const strength of suppliedStrengths)
    if (!Number.isFinite(strength))
      throw new Error("Field constraint strengths must be finite.");
  if (transfer) {
    const count = transfer.eligibleTargets.bitCount;
    if (
      transfer.targets.length !== faces ||
      transfer.flags.length !== faces ||
      transfer.lanes.some((lane) => lane.length !== faces) ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > faces ||
      transfer.eligibleTargets.bits.length * 8 < count
    )
      throw new Error("Field constraint transfer dimensions are inconsistent.");
    for (const target of transfer.targets)
      if (target < -1 || target >= faces)
        throw new Error("Field constraint mapping has an invalid target.");
  }
  const strengths = suppliedStrengths.slice();
  const bits = new Uint8Array(Math.ceil(faces / 8));
  let fixedCount = 0;
  for (let face = 0; face < faces; face++) {
    if (strengths[face] < 500) continue;
    bits[face >> 3] |= 1 << (face & 7);
    fixedCount++;
  }
  // Empty input is an independent safe case; the native fallback assumes a face exists.
  if (faces && fixedCount === 0) {
    strengths[0] = 500;
    bits[0] |= 1;
    fixedCount = 1;
  }
  const result: InitializedFieldConstraints = {
    strengths,
    fixedFaces: { bits, bitCount: faces },
    fixedCount,
  };
  if (transfer) {
    const lanes: [Uint32Array, Uint32Array] = [
      transfer.lanes[0].slice(),
      transfer.lanes[1].slice(),
    ];
    const flags = transfer.flags.slice();
    const eligible = transfer.eligibleTargets;
    for (let source = 0; source < faces; source++) {
      const target = transfer.targets[source];
      if (
        target < 0 ||
        target >= eligible.bitCount ||
        !(eligible.bits[target >> 3] & (1 << (target & 7)))
      )
        continue;
      lanes[0][target] = lanes[0][source];
      lanes[1][target] = lanes[1][source];
      flags[target] |= 2;
      strengths[target] = strengths[source];
    }
    result.lanes = lanes;
    result.flags = flags;
  }
  return result;
}
