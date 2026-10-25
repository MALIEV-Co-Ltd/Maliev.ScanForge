import type { ProjectSession } from "./project-file";
import type { ProjectSharedChunk } from "./project-file-codec";
import type { Positions } from "./types";
import { cacheScanRenderData, type ScanRenderData } from "./scan-render-data";
import { indexedMeshMatches } from "./indexed-mesh";
import {
  restoreEncodingSnapshot,
  type ProjectEncodingSnapshot,
} from "./project-encoding-snapshot";
import {
  unpackProjectTransport,
  type ProjectTransport,
} from "./project-transport";
export interface DecodedProjectData {
  snapshot: ProjectEncodingSnapshot;
  displays: { positions: Positions; data: ScanRenderData }[];
  sharedChunks?: ProjectSharedChunk[];
}
// Weak backing references do not keep a closed project alive. Reopening its
// unchanged chunks can borrow them while earlier consumers or GC still own them.
const sharedChunks = new Map<string, WeakRef<SharedArrayBuffer>>();
let pending: Promise<unknown> = Promise.resolve(),
  generation = 0;
globalThis.addEventListener?.("pagehide", () => {
  generation++;
  sharedChunks.clear();
});
/** File decoding, validation and display preparation finish before publication.
 * The main thread rebuilds large JS arrays in bounded cooperative chunks. */
export function decodeProjectInBackground(
  file: Blob,
  signal?: AbortSignal,
): Promise<ProjectSession> {
  const entered = generation;
  const result = pending.then(
    () =>
      new Promise<ProjectSession>((resolve, reject) => {
        let worker: Worker | undefined,
          finished = false;
        const check = () => {
          if (finished || signal?.aborted || entered !== generation)
            throw new DOMException("Project restore cancelled.", "AbortError");
        };
        const finish = (error?: Error, data?: ProjectSession) => {
          if (finished) return;
          finished = true;
          clearTimeout(lease);
          signal?.removeEventListener("abort", abort);
          globalThis.removeEventListener?.("pagehide", abort);
          worker?.terminate();
          worker = undefined;
          if (error) reject(error);
          else resolve(data!);
        };
        const abort = () =>
          finish(new DOMException("Project restore cancelled.", "AbortError"));
        const lease = setTimeout(
          () =>
            finish(
              new Error(
                "Project decoding exceeded its two-minute worker lease.",
              ),
            ),
          120000,
        );
        try {
          check();
          if (typeof Worker === "undefined")
            throw new Error("Project restore requires browser workers.");
          worker = new Worker(
            new URL("./project-decoding-worker.ts", import.meta.url),
            { type: "module" },
          );
          signal?.addEventListener("abort", abort, { once: true });
          globalThis.addEventListener?.("pagehide", abort, { once: true });
          worker.onerror = (e) =>
            finish(new Error(e.message || "Project decoding worker failed."));
          worker.onmessageerror = () =>
            finish(new Error("Invalid project decoding message."));
          worker.onmessage = ({
            data,
          }: MessageEvent<{ packet?: ProjectTransport; error?: string }>) => {
            worker?.terminate();
            worker = undefined;
            if (data?.error) {
              finish(new Error(data.error));
              return;
            }
            void (async () => {
              if (!data?.packet)
                throw new Error("Invalid project decoding response.");
              const decoded = await unpackProjectTransport<DecodedProjectData>(
                data.packet,
                { check },
              );
              check();
              if (
                !decoded?.snapshot?.session?.project ||
                !Array.isArray(decoded.snapshot.session.project.entities) ||
                !Array.isArray(decoded.snapshot.session.history) ||
                !Array.isArray(decoded.snapshot.session.future) ||
                !Array.isArray(decoded.snapshot.localClouds) ||
                !Array.isArray(decoded.displays)
              )
                throw new Error("Invalid decoded project.");
              const session = restoreEncodingSnapshot(decoded.snapshot);
              for (const display of decoded.displays) {
                check();
                const r = display.data;
                if (
                  !display.positions ||
                  !r ||
                  !(r.normals instanceof Float32Array) ||
                  (r.indexedMesh
                    ? !session.project.entities.some(
                        (e) =>
                          e.positions === display.positions &&
                          e.indexedMesh === r.indexedMesh,
                      ) ||
                      !indexedMeshMatches(r.indexedMesh, display.positions) ||
                      r.normals !== r.indexedMesh.geometryNormals ||
                      r.normals.length !== r.indexedMesh.vertices.length
                    : r.normals.length !== display.positions.length) ||
                  !r.bounds?.every(Number.isFinite) ||
                  r.bounds.length !== 6 ||
                  !Number.isFinite(r.radius) ||
                  !r.stats
                )
                  throw new Error("Invalid decoded mesh display.");
                cacheScanRenderData(display.positions, r);
              }
              if (
                decoded.sharedChunks !== undefined &&
                !Array.isArray(decoded.sharedChunks)
              )
                throw new Error("Invalid decoded project chunks.");
              for (const chunk of decoded.sharedChunks ?? []) {
                check();
                if (
                  typeof SharedArrayBuffer === "undefined" ||
                  !(chunk?.buffer instanceof SharedArrayBuffer) ||
                  !/^[a-f0-9]{64}$/.test(chunk.sha256)
                )
                  throw new Error("Invalid decoded project chunk.");
              }
              for (const chunk of decoded.sharedChunks ?? []) {
                if (typeof WeakRef !== "undefined") {
                  const key = `${chunk.sha256}:${chunk.buffer.byteLength}`;
                  sharedChunks.delete(key);
                  sharedChunks.set(key, new WeakRef(chunk.buffer));
                  if (sharedChunks.size > 128)
                    sharedChunks.delete(sharedChunks.keys().next().value!);
                }
              }
              finish(undefined, session);
            })().catch((error) =>
              finish(error instanceof Error ? error : new Error(String(error))),
            );
          };
          const reusableChunks: ProjectSharedChunk[] = [];
          for (const [key, reference] of sharedChunks) {
            const buffer = reference.deref();
            if (buffer)
              reusableChunks.push({ sha256: key.slice(0, 64), buffer });
            else sharedChunks.delete(key);
          }
          worker.postMessage({ file, reusableChunks });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }),
  );
  // Do not keep the decoded project/history alive after the caller releases it.
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
