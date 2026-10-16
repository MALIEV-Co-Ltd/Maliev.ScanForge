import {
  checkScanAbort,
  type ScanBudget,
  type ScanBudgetLease,
} from "./scan-geometry-source";

/** One FIFO coordinator per job, shared by caches, copies and worker scratch. */
export function createScanBudget(
  capacityBytes: number,
  residentProjectBytes: number,
): ScanBudget {
  if (
    !Number.isSafeInteger(capacityBytes) ||
    capacityBytes <= 0 ||
    !Number.isSafeInteger(residentProjectBytes) ||
    residentProjectBytes < 0
  )
    throw new RangeError(
      "Scan resource amounts must be nonnegative safe integers with positive capacity.",
    );
  let reservedBytes = 0,
    peakBytes = 0;
  type Claim = {
    bytes: number;
    signal?: AbortSignal;
    abort(): void;
    grant(lease: ScanBudgetLease): void;
    reject(reason: unknown): void;
  };
  const queue: Claim[] = [];
  const drain = () => {
    while (queue.length && queue[0].bytes <= capacityBytes - reservedBytes) {
      const claim = queue.shift()!;
      claim.signal?.removeEventListener("abort", claim.abort);
      reservedBytes += claim.bytes;
      peakBytes = Math.max(peakBytes, reservedBytes);
      let released = false;
      claim.grant({
        bytes: claim.bytes,
        release() {
          if (released) return;
          released = true;
          reservedBytes -= claim.bytes;
          drain();
        },
      });
    }
  };
  return {
    async reserve(owner, bytes, signal) {
      checkScanAbort(signal);
      if (!owner || !Number.isSafeInteger(bytes) || bytes < 0)
        throw new RangeError(
          "Scan reservations require an owner and nonnegative safe integer bytes.",
        );
      if (bytes > capacityBytes)
        throw new RangeError(
          `Scan reservation exceeds capacity (${bytes} > ${capacityBytes}); split the work or use disk storage.`,
        );
      return new Promise<ScanBudgetLease>((grant, reject) => {
        const claim: Claim = {
          bytes,
          signal,
          grant,
          reject,
          abort() {
            const index = queue.indexOf(claim);
            if (index < 0) return;
            queue.splice(index, 1);
            signal?.removeEventListener("abort", claim.abort);
            reject(
              signal?.reason ??
                new DOMException("Scan processing cancelled.", "AbortError"),
            );
            drain();
          },
        };
        queue.push(claim);
        signal?.addEventListener("abort", claim.abort, { once: true });
        if (signal?.aborted) claim.abort();
        else drain();
      });
    },
    snapshot: () => ({
      capacityBytes,
      reservedBytes,
      peakBytes,
      residentProjectBytes,
      activeWorkers: 0,
      spillBytes: 0,
    }),
  };
}
