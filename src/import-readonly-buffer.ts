/** Import scratch stays private; only final buffers opt in before publication. */
export function allocateImportedReadonlyBuffer(
  bytes: number,
  shared = false,
): ArrayBufferLike {
  return shared &&
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== "undefined"
    ? new SharedArrayBuffer(bytes)
    : new ArrayBuffer(bytes);
}
