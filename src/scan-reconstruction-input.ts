import type { IndexedMesh, Positions } from "./types";

export const RECONSTRUCTION_MAX_INPUT_COORDINATES = 500_000_000;
export const RECONSTRUCTION_MAX_PRIVATE_BYTES = 256 * 1024 * 1024;

/** Include preserved indexed carriers in the same pre-clone numeric transport budget. */
export function admitReconstructionTransport(
  inputs: Positions[],
  topology: (IndexedMesh | undefined)[],
) {
  const admitted = admitReconstructionInputs(inputs);
  if (topology.length !== inputs.length)
    throw Error("Reconstruction topology references must match its inputs.");
  let privateBytes = admitted.privateBytes;
  for (let i = 0; i < topology.length; i++) {
    const mesh = topology[i];
    if (!mesh) continue;
    if (
      !Number.isSafeInteger(mesh.vertices.length) ||
      mesh.vertices.length % 3 ||
      !Number.isSafeInteger(mesh.triangles.length) ||
      mesh.triangles.length * 3 !== inputs[i].length
    )
      throw Error(
        "Reconstruction indexed carriers do not match the source dimensions.",
      );
    const bytes =
      (isBorrowableReconstructionInput(mesh.vertices)
        ? 0
        : mesh.vertices.length *
          (mesh.vertices instanceof Float32Array ? 4 : 8)) +
      mesh.triangles.length * 4;
    if (bytes > RECONSTRUCTION_MAX_PRIVATE_BYTES - privateBytes)
      throw Error(
        "Reconstruction private numeric transport payload including topology exceeds 256 MiB.",
      );
    privateBytes += bytes;
  }
  return { ...admitted, privateBytes };
}

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

/** Numeric transport payload only, not a JavaScript heap or process RSS bound. */
export function admitReconstructionInputs(
  inputs: readonly Positions[],
  borrowShared = true,
) {
  if (!inputs.length || inputs.length > 33)
    throw Error(
      "Reconstruction requires one to 33 inputs (up to 32 additional meshes).",
    );
  let coordinates = 0;
  for (const input of inputs) {
    if (
      !(Array.isArray(input) || input instanceof Float32Array) ||
      !Number.isSafeInteger(input.length) ||
      input.length <= 0 ||
      input.length % 9
    )
      throw Error(
        "Reconstruction requires complete triangles with safe coordinate counts.",
      );
    if (input.length > RECONSTRUCTION_MAX_INPUT_COORDINATES - coordinates)
      throw Error(
        "Reconstruction coordinate validation work exceeds 500 million coordinates.",
      );
    coordinates += input.length;
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
  return { coordinates, triangles: coordinates / 9, privateBytes };
}
