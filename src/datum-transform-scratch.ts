/** Only private executor chunks/intermediate stage outputs may enter here.
 * Never pass authored buffers or a published/final result. Older runtimes retain
 * ordinary GC behavior when deterministic ArrayBuffer transfer is unavailable. */
export function retireDatumTransformScratch(buffer: ArrayBufferLike) {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) return;
  try {
    (
      buffer as ArrayBuffer & { transfer?: (size: number) => ArrayBuffer }
    ).transfer?.(0);
  } catch {
    // Failed retirement cannot invalidate a correct transformation.
  }
}
