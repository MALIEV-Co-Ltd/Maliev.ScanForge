export interface NativeTargetStorageBudget {
  readonly limit: number;
  readonly reserved: number;
  snapshot(): { limit: number; reserved: number; live: number; peak: number };
  allocate(bytes: number, shared: boolean): ArrayBufferLike;
  release(buffer: ArrayBuffer): void;
}
let active: NativeTargetStorageBudget | undefined;
const scratchOwners = new WeakMap<
  ArrayBuffer,
  NativeTargetStorageBudget | undefined
>();

/** One synchronous preparation transaction; never await with this scope active.
 * The baseline includes admitted input backings and worker/runtime reserves.
 * Every derived/scratch allocation is checked before allocating its backing. */
export function createNativeTargetStorageBudget(
  limit: number,
  reserved: number,
): NativeTargetStorageBudget {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 512 * 1048576 ||
    !Number.isSafeInteger(reserved) ||
    reserved < 0 ||
    reserved > limit
  )
    throw RangeError("Invalid whole-scene alignment storage admission.");
  let live = reserved,
    peak = live;
  const owned = new Map<ArrayBufferLike, number>();
  return {
    limit,
    reserved,
    snapshot: () => ({ limit, reserved, live, peak }),
    allocate(bytes, shared) {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || live + bytes > limit)
        throw RangeError(
          `Global alignment exceeds its 512 MiB whole-scene storage admission (${live} + ${bytes} > ${limit}).`,
        );
      const buffer = shared
        ? new SharedArrayBuffer(bytes)
        : new ArrayBuffer(bytes);
      owned.set(buffer, bytes);
      live += bytes;
      peak = Math.max(peak, live);
      return buffer;
    },
    release(buffer) {
      const bytes = owned.get(buffer);
      if (bytes === undefined || buffer.byteLength !== 0) return;
      live -= bytes;
      owned.delete(buffer);
    },
  };
}
export function withNativeTargetStorageBudget<T>(
  budget: NativeTargetStorageBudget,
  run: () => T,
): T {
  if (active) throw Error("Alignment storage scopes cannot overlap.");
  active = budget;
  try {
    return run();
  } finally {
    active = undefined;
  }
}
export function nativeScratchStorage(bytes: number): ArrayBuffer {
  const buffer = (
    active ? active.allocate(bytes, false) : new ArrayBuffer(bytes)
  ) as ArrayBuffer;
  scratchOwners.set(buffer, active);
  return buffer;
}
/** Only exclusively owned scratch allocated here can be detached. Without
 * transfer support it remains charged, conservatively, until worker teardown. */
export function releaseNativeScratch(buffer: ArrayBufferLike): boolean {
  if (!(buffer instanceof ArrayBuffer) || !scratchOwners.has(buffer))
    return false;
  const transfer = (
    buffer as ArrayBuffer & { transfer?: (size: number) => ArrayBuffer }
  ).transfer;
  if (!transfer) return false;
  try {
    transfer.call(buffer, 0);
  } catch {
    // Failed transfer leaves storage live and charged. Cleanup must still be
    // able to retire its logical directory, including during cancellation.
    return false;
  }
  scratchOwners.get(buffer)?.release(buffer);
  scratchOwners.delete(buffer);
  return true;
}

/** Derived immutable target buffers follow the already-admitted input storage.
 * No authored buffer is detached or modified. Scratch remains worker-local. */
export function nativeTargetStorage(source: ArrayLike<number>, bytes: number) {
  const shared =
    source instanceof Float32Array &&
    typeof SharedArrayBuffer !== "undefined" &&
    source.buffer instanceof SharedArrayBuffer;
  return active
    ? active.allocate(bytes, shared)
    : shared
      ? new SharedArrayBuffer(bytes)
      : new ArrayBuffer(bytes);
}
