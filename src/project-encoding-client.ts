import { projectNumericReuse } from "./project-numeric-reuse";
import {
  containsLargeNumericArrays,
  packProjectTransport,
} from "./project-transport";
import type { ProjectSession } from "./project-file";
import { projectEncodingSnapshot } from "./project-encoding-snapshot";
import { diskBackedBlob } from "./transient-blob-storage";
import { rememberProjectSharedChunks } from "./project-shared-chunks";
import {
  projectEncodingChunkSources,
  projectEncodingNumericSources,
  resolveEncodingChunkTokens,
} from "./project-encoding-chunks";

// Backup and explicit GUI/MCP exports share one bounded encoding lane. A failed
// worker must not fall back to expensive synchronous validation on the UI thread.
let pending: Promise<unknown> = Promise.resolve();
let pageGeneration = 0;
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
interface SharedEncoding {
  controller: AbortController;
  promise: Promise<Blob>;
  users: Set<symbol>;
}
const inFlight = new Map<string, SharedEncoding>();
let recent: { key: string; file: WeakRef<Blob> } | undefined;

function identity(value: unknown): unknown {
  if (
    value !== null &&
    (typeof value === "object" || typeof value === "function")
  ) {
    if (!identities.has(value)) identities.set(value, ++nextIdentity);
    return ["reference", identities.get(value)];
  }
  return ["value", typeof value, value];
}
function snapshotKey(session: ProjectSession): string {
  const metadata = (value: object) =>
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, identity(value)]);
  return JSON.stringify([
    pageGeneration,
    identity(session.projectId),
    metadata(
      Object.fromEntries(
        Object.entries(session.project).filter(
          ([key]) => key !== "entities" && key !== "authoring",
        ),
      ),
    ),
    identity(session.project.entities),
    session.project.authoring
      ? metadata(session.project.authoring)
      : identity(session.project.authoring),
    identity(session.history),
    identity(session.future),
  ]);
}
globalThis.addEventListener?.("pagehide", () => {
  pageGeneration++;
  recent = undefined;
});
export function encodeProjectInBackground(
  session: ProjectSession,
  signal?: AbortSignal,
): Promise<Blob> {
  const cancelled = () =>
    new DOMException("Project encoding cancelled.", "AbortError");
  if (signal?.aborted) return Promise.reject(cancelled());
  let key: string;
  try {
    key = snapshotKey(session);
  } catch (error) {
    return Promise.reject(error);
  }
  let shared = inFlight.get(key);
  const cached = recent?.key === key ? recent.file.deref() : undefined;
  if ((!shared || shared.controller.signal.aborted) && cached)
    shared = {
      controller: new AbortController(),
      promise: Promise.resolve(cached),
      users: new Set(),
    };
  if (!shared || shared.controller.signal.aborted) {
    const controller = new AbortController();
    const task: SharedEncoding = {
      controller,
      promise: encodeQueued(session, controller.signal),
      users: new Set(),
    };
    inFlight.set(key, task);
    const release = () => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    };
    // Remember only a weak result: active consumers own its storage, not us.
    void task.promise.then((file) => {
      if (typeof WeakRef !== "undefined")
        recent = { key, file: new WeakRef(file) };
      release();
    }, release);
    shared = task;
  }
  const task = shared;
  return new Promise<Blob>((resolve, reject) => {
    const user = Symbol();
    task.users.add(user);
    let finished = false;
    const release = () => {
      signal?.removeEventListener("abort", cancel);
      task.users.delete(user);
    };
    const cancel = () => {
      if (finished) return;
      finished = true;
      release();
      if (!task.users.size) {
        if (inFlight.get(key) === task) inFlight.delete(key);
        task.controller.abort();
      }
      reject(cancelled());
    };
    signal?.addEventListener("abort", cancel, { once: true });
    void task.promise.then(
      (file) => {
        if (finished) return;
        finished = true;
        release();
        resolve(file);
      },
      (error) => {
        if (finished) return;
        finished = true;
        release();
        reject(error);
      },
    );
    if (signal?.aborted) cancel();
  });
}

function encodeQueued(
  session: ProjectSession,
  signal: AbortSignal,
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
        let chunkSources: SharedArrayBuffer[] = [];
        let numericSources: number[][] = [];
        const storage = new AbortController();
        let lease: ReturnType<typeof setTimeout> | undefined;
        let finished = false;
        const finish = (error?: Error, file?: Blob) => {
          if (finished) return;
          finished = true;
          storage.abort();
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
          }: MessageEvent<{
            file?: Blob;
            error?: string;
            sharedChunkTokens?: unknown;
          }>) => {
            if (finished) return;
            if (data?.file instanceof Blob) {
              let chunks;
              try {
                chunks = resolveEncodingChunkTokens(
                  data.sharedChunkTokens,
                  chunkSources,
                );
              } catch (error) {
                finish(error as Error);
                return;
              }
              worker?.terminate();
              worker = undefined;
              void diskBackedBlob(data.file, storage.signal).then(
                (file) => {
                  if (
                    finished ||
                    signal.aborted ||
                    generation !== pageGeneration
                  )
                    return;
                  rememberProjectSharedChunks(chunks);
                  projectNumericReuse.remember(numericSources);
                  finish(undefined, file);
                },
                (error) =>
                  finish(
                    error instanceof Error ? error : new Error(String(error)),
                  ),
              );
            } else
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
          chunkSources = projectEncodingChunkSources(snapshot);
          numericSources = projectEncodingNumericSources(snapshot);
          if (!containsLargeNumericArrays(snapshot))
            worker.postMessage(
              chunkSources.length
                ? { ...snapshot, sharedChunkSources: chunkSources }
                : snapshot,
            );
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
                if (!finished)
                  worker!.postMessage(
                    chunkSources.length
                      ? { ...packet, sharedChunkSources: chunkSources }
                      : packet,
                    transfers,
                  );
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
