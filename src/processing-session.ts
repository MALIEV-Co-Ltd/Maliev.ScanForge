import type { Positions, IndexedMesh } from "./types";

// One geometry-scoped worker, never a background pool. The selected geometry
// owns its adjacency until disposal, replacement, cancellation or page exit.
let retained:
  | {
      worker: Worker;
      positions: Positions;
      key: number;
      active: boolean;
      initialized: boolean;
      indexedSource?: IndexedMesh;
      indexedTolerance?: number;
      retire?: boolean;
    }
  | undefined;
let nextKey = 0;
/** Release the cache when its geometry is no longer the active mesh. */
export function retainProcessingGeometry(positions?: Positions) {
  if (retained && retained.positions !== positions) releaseProcessingSession();
}
export function releaseProcessingSession() {
  if (!retained) return;
  if (retained.active) {
    retained.retire = true;
    return;
  }
  retained.worker.terminate();
  retained = undefined;
}
export function acquireProcessingSession(
  positions: Positions,
  create: () => Worker,
) {
  if (retained?.active) return undefined; // Concurrent diagnostics stay isolated.
  if (retained && retained.positions !== positions) releaseProcessingSession();
  retained ??= {
    worker: create(),
    positions,
    key: ++nextKey,
    active: false,
    initialized: false,
  };
  const entry = retained;
  entry.active = true;
  return {
    worker: entry.worker,
    key: entry.key,
    initialized: entry.initialized,
    indexedSource: entry.indexedSource,
    indexedTolerance: entry.indexedTolerance,
    release(
      usable: boolean,
      successor?: Positions,
      indexedSource?: IndexedMesh,
      indexedTolerance?: number,
    ) {
      entry.active = false;
      entry.worker.onmessage = null;
      entry.worker.onerror = null;
      entry.worker.onmessageerror = null;
      if (!usable || entry.retire) releaseProcessingSession();
      else {
        entry.initialized = true;
        entry.indexedSource = indexedSource;
        entry.indexedTolerance = indexedTolerance;
        if (successor) entry.positions = successor;
      }
    },
  };
}
globalThis.addEventListener?.("pagehide", releaseProcessingSession);

/** Drop only the matching disposable preview in an existing worker; never create a cleanup worker. */
export function releaseProcessingPreview(
  positions: Positions,
  previewId: string,
) {
  if (retained?.positions === positions)
    retained.worker.postMessage({ releasePreviewId: previewId });
}
