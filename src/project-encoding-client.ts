import {
  containsLargeNumericArrays,
  packProjectTransport,
} from "./project-transport";
import type { ProjectSession } from "./project-file";
import { projectEncodingSnapshot } from "./project-encoding-snapshot";

// Backup and explicit GUI/MCP exports share one bounded encoding lane. A failed
// worker must not fall back to expensive synchronous validation on the UI thread.
let pending: Promise<unknown> = Promise.resolve();
let pageGeneration = 0;
globalThis.addEventListener?.("pagehide", () => pageGeneration++);
export function encodeProjectInBackground(
  session: ProjectSession,
  signal?: AbortSignal,
): Promise<Blob> {
  const generation = pageGeneration;
  const result = pending.then(
    () =>
      new Promise<Blob>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Project encoding cancelled.", "AbortError"));
          return;
        }
        if (generation !== pageGeneration) {
          reject(new Error("Project encoding cancelled on page exit."));
          return;
        }
        let worker: Worker | undefined;
        let lease: ReturnType<typeof setTimeout> | undefined;
        let finished = false;
        const finish = (error?: Error, file?: Blob) => {
          if (finished) return;
          finished = true;
          clearTimeout(lease);
          globalThis.removeEventListener?.("pagehide", abort);
          signal?.removeEventListener("abort", cancel);
          worker?.terminate();
          if (error) reject(error);
          else resolve(file!);
        };
        const abort = () =>
          finish(new Error("Project encoding cancelled on page exit."));
        const cancel = () =>
          finish(new DOMException("Project encoding cancelled.", "AbortError"));
        try {
          worker = new Worker(
            new URL("./project-encoding-worker.ts", import.meta.url),
            { type: "module" },
          );
          worker.onmessage = ({
            data,
          }: MessageEvent<{ file?: Blob; error?: string }>) => {
            if (data?.file instanceof Blob) finish(undefined, data.file);
            else
              finish(
                new Error(data?.error || "Invalid project encoder response."),
              );
          };
          worker.onerror = (event) =>
            finish(new Error(event.message || "Project encoder failed."));
          worker.onmessageerror = () =>
            finish(new Error("Could not decode the encoded project."));
          globalThis.addEventListener?.("pagehide", abort, { once: true });
          signal?.addEventListener("abort", cancel, { once: true });
          lease = setTimeout(
            () =>
              finish(
                new Error(
                  "Project encoder exceeded its two-minute worker lease.",
                ),
              ),
            120_000,
          );
          const snapshot = projectEncodingSnapshot(session);
          if (!containsLargeNumericArrays(snapshot))
            worker.postMessage(snapshot);
          else
            void packProjectTransport(snapshot, {
              check: () => {
                if (
                  finished ||
                  signal?.aborted ||
                  generation !== pageGeneration
                )
                  throw new DOMException(
                    "Project encoding cancelled.",
                    "AbortError",
                  );
              },
            })
              .then(({ packet, transfers }) => {
                if (!finished) worker!.postMessage(packet, transfers);
              })
              .catch((error) =>
                finish(
                  error instanceof Error ? error : new Error(String(error)),
                ),
              );
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }),
  );
  // The queue owns completion only, never the saved file returned to its caller.
  pending = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
