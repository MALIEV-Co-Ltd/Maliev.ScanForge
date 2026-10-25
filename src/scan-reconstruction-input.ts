import type { Positions } from "./types";

export const RECONSTRUCTION_MAX_INPUT_COORDINATES = 500_000_000;
export const RECONSTRUCTION_MAX_PRIVATE_BYTES = 256 * 1024 * 1024;

/** Only the disposable read-only reconstruction worker may borrow these views. */
export function isBorrowableReconstructionInput(
  positions: Positions,
): positions is Float32Array {
  return (
    positions instanceof Float32Array &&
    typeof SharedArrayBuffer !== "undefined" &&
    positions.buffer instanceof SharedArrayBuffer
  );
}

export type ReconstructionInput = {
  kind: "triangles" | "points";
  positions: Positions;
};

/** Numeric transport payload only, not a JavaScript heap or process RSS bound. */
export function admitReconstructionRecords(
  records: readonly ReconstructionInput[],
  borrowShared = true,
) {
  const inputs = records.map((r) => r.positions);
  if (!inputs.length || inputs.length > 33)
    throw Error(
      "Reconstruction requires one to 33 inputs (up to 32 additional meshes).",
    );
  let coordinates = 0;
  let points = 0,
    triangles = 0;
  for (const record of records) {
    const input = record.positions;
    if (
      !["triangles", "points"].includes(record.kind) ||
      !(Array.isArray(input) || input instanceof Float32Array) ||
      !Number.isSafeInteger(input.length) ||
      input.length <= 0 ||
      input.length % (record.kind === "points" ? 3 : 9)
    )
      throw Error(
        "Reconstruction requires complete triangles with safe coordinate counts.",
      );
    if (input.length > RECONSTRUCTION_MAX_INPUT_COORDINATES - coordinates)
      throw Error(
        "Reconstruction coordinate validation work exceeds 500 million coordinates.",
      );
    coordinates += input.length;
    if (record.kind === "points") points += input.length / 3;
    else triangles += input.length / 9;
  }
  let privateBytes = 0;
  for (const input of inputs) {
    // Each view is cloned separately, even when inputs alias one backing store.
    const bytes =
      borrowShared && isBorrowableReconstructionInput(input)
        ? 0
        : input.length * (input instanceof Float32Array ? 4 : 8);
    if (bytes > RECONSTRUCTION_MAX_PRIVATE_BYTES - privateBytes)
      throw Error(
        "Reconstruction private numeric transport payload exceeds 256 MiB.",
      );
    privateBytes += bytes;
  }
  return { coordinates, triangles, points, privateBytes };
}

/** Legacy triangle-only admission retains its public result shape. */
export function admitReconstructionInputs(
  inputs: readonly Positions[],
  borrowShared = true,
) {
  const { coordinates, triangles, privateBytes } = admitReconstructionRecords(
    inputs.map((positions) => ({ kind: "triangles", positions })),
    borrowShared,
  );
  return { coordinates, triangles, privateBytes };
}
