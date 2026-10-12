import { buildGuidePointBounds } from "./field-point-bounds";

export interface GuideBoundsCache {
  flags: number;
  bounds: Float32Array;
  owner: Float32Array | null;
  elapsed: number;
}

function validate(cache: GuideBoundsCache): void {
  if (
    !Number.isInteger(cache.flags) ||
    cache.flags < 0 ||
    cache.flags > 0xffffffff ||
    cache.bounds.length !== 6 ||
    !cache.bounds.every(Number.isFinite)
  )
    throw new Error("Bounds cache flags or coordinates are invalid");
}

/** Native clear changes only xmin, xmax and ready bit; other coordinates persist. */
export function clearGuideBoundsCache(cache: GuideBoundsCache): void {
  validate(cache);
  cache.bounds[0] = 0;
  cache.bounds[3] = -1;
  cache.flags = (cache.flags & 0xfffffffe) >>> 0;
}

/** Recovered concrete initializer with a supplied double-precision clock. */
export function initializeGuideBoundsCache(
  cache: GuideBoundsCache,
  clock: () => number,
): void {
  validate(cache);
  if (
    cache.owner &&
    (cache.owner.length % 3 || !cache.owner.every(Number.isFinite))
  )
    throw new Error("Bounds cache owner geometry is invalid");
  const start = clock();
  if (!Number.isFinite(start)) throw new Error("Bounds cache clock is invalid");
  clearGuideBoundsCache(cache);
  cache.flags = (cache.flags | 1) >>> 0;
  if (cache.owner)
    cache.bounds.set(buildGuidePointBounds(cache.owner, cache.bounds));
  const elapsed = Math.fround(clock() - start);
  if (!Number.isFinite(elapsed))
    throw new Error("Bounds cache clock is invalid");
  cache.elapsed = elapsed;
}
