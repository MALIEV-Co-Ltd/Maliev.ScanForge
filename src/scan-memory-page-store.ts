import {
  checkScanAbort,
  scanChecksum,
  type ScanPageStore,
  type ScanBudget,
  type ScanBudgetLease,
  type ScanPageRef,
} from "./scan-geometry-source";

/** Resident adapter for bounded fixtures/small jobs. Retained pages count as scratch. */
export function createMemoryPageStore(
  budget: ScanBudget,
  owner: string,
): ScanPageStore {
  const pages = new Map<
    string,
    { ref: ScanPageRef; bytes: Uint8Array; lease: ScanBudgetLease }
  >();
  const find = (ref: ScanPageRef) => {
    const page = pages.get(ref.id);
    if (!page) throw new Error("Scan page missing.");
    if (page.ref.bytes !== ref.bytes || page.ref.sha256 !== ref.sha256)
      throw new Error("Scan page checksum or size mismatch.");
    return page;
  };
  return {
    async append(bytes, signal) {
      checkScanAbort(signal);
      const lease = await budget.reserve(owner, bytes.byteLength, signal);
      try {
        checkScanAbort(signal);
        const copy = new Uint8Array(bytes);
        const ref = Object.freeze({
          id: crypto.randomUUID(),
          bytes: copy.byteLength,
          sha256: await scanChecksum(copy),
        });
        checkScanAbort(signal);
        pages.set(ref.id, { bytes: copy, ref, lease });
        return ref;
      } catch (error) {
        lease.release();
        throw error;
      }
    },
    async read(ref, signal) {
      checkScanAbort(signal);
      find(ref);
      const lease = await budget.reserve(owner, ref.bytes, signal);
      try {
        checkScanAbort(signal);
        const copy = new Uint8Array(find(ref).bytes);
        if ((await scanChecksum(copy)) !== ref.sha256)
          throw new Error("Scan page checksum mismatch.");
        checkScanAbort(signal);
        return { bytes: copy, release: lease.release };
      } catch (error) {
        lease.release();
        throw error;
      }
    },
    async remove(ref, signal) {
      checkScanAbort(signal);
      const page = find(ref);
      pages.delete(ref.id);
      page.lease.release();
    },
  };
}
