import { exportStl } from "./io";
import { isEncodingNumeric } from "./project-encoding-numeric";
import type { Entity } from "./types";

/** Encode without transferring or mutating workspace-owned input buffers. */
export async function exportStlInBackground(
  entities: readonly Entity[],
  signal?: AbortSignal,
): Promise<DataView> {
  const cancelled = () =>
    new DOMException("STL export cancelled.", "AbortError");
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === "undefined") return exportStl([...entities]);
  const snapshot = entities
    .filter(
      (entity) =>
        entity.kind !== "pointcloud" && entity.kind !== "referenceFrame",
    )
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      positions: entity.positions,
      indexedMesh: entity.indexedMesh,
      privateIndexedVertices: isEncodingNumeric(entity.indexedMesh?.vertices),
      visible: entity.visible,
      opacity: entity.opacity,
      color: entity.color,
    }));
  return new Promise<DataView>((resolve, reject) => {
    let worker: Worker | undefined;
    let finished = false;
    let lease: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, buffer?: ArrayBuffer) => {
      if (finished) return;
      finished = true;
      clearTimeout(lease);
      signal?.removeEventListener("abort", abort);
      globalThis.removeEventListener?.("pagehide", abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(new DataView(buffer!));
    };
    const abort = () => finish(cancelled());
    try {
      worker = new Worker(new URL("./stl-export-worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({
        data,
      }: MessageEvent<{
        started?: boolean;
        buffer?: unknown;
        error?: string;
      }>) => {
        if (data?.started === true) return;
        if (!(data?.buffer instanceof ArrayBuffer)) {
          finish(new Error(data?.error || "Invalid STL export response."));
          return;
        }
        const view = new DataView(data.buffer);
        if (
          view.byteLength < 84 ||
          84 + view.getUint32(80, true) * 50 !== view.byteLength
        ) {
          finish(new Error("Invalid STL export response."));
          return;
        }
        finish(undefined, data.buffer);
      };
      worker.onerror = (event) =>
        finish(new Error(event.message || "STL export worker failed."));
      worker.onmessageerror = () =>
        finish(new Error("Could not decode the STL export."));
      signal?.addEventListener("abort", abort, { once: true });
      globalThis.addEventListener?.("pagehide", abort, { once: true });
      lease = setTimeout(
        () => finish(new Error("STL export exceeded its worker lease.")),
        15 * 60_000,
      );
      if (signal?.aborted) abort();
      else worker.postMessage({ entities: snapshot });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
