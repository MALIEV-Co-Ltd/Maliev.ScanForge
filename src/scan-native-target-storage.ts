/** Derived immutable target buffers follow the already-admitted input storage.
 * No authored buffer is detached or modified. Scratch remains worker-local. */
export function nativeTargetStorage(source: ArrayLike<number>, bytes: number) {
  return source instanceof Float32Array &&
    typeof SharedArrayBuffer !== "undefined" &&
    source.buffer instanceof SharedArrayBuffer
    ? new SharedArrayBuffer(bytes)
    : new ArrayBuffer(bytes);
}
