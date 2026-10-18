import type {
  AlignmentBatch,
  AlignmentBatchResult,
} from "./scan-native-alignment-objective";
import { runAlignmentBatch } from "./scan-native-alignment-objective";
import type { AlignmentQueryVertex } from "./scan-native-alignment-query";
import type { NativeAlignmentQuerySurface } from "./scan-native-alignment-mesh-query";
import { createNativeAlignmentSurfaceQuery } from "./scan-native-alignment-mesh-query";
import { nativeAlignmentTargetGroupQuery } from "./scan-native-alignment-target-group";
import {
  alignmentTreeSize,
  packAlignmentTree,
} from "./scan-alignment-packed-tree";
import type {
  AlignmentWorkerRequest,
  AlignmentWorkerResponse,
} from "./scan-alignment-worker";
const sharedTargetsAvailable = () =>
  globalThis.crossOriginIsolated === true &&
  typeof SharedArrayBuffer !== "undefined";
function shareTargets(surfaces: readonly NativeAlignmentQuerySurface[]) {
  return surfaces.map((surface) => {
    const share = <T extends Float32Array | Uint8Array>(input: T): T => {
      const copy = new (
        input.constructor as { new (buffer: ArrayBufferLike): T }
      )(new SharedArrayBuffer(input.byteLength));
      copy.set(input);
      return copy;
    };
    return {
      ...surface,
      root: packAlignmentTree(surface.root),
      points: share(surface.points),
      triangleBounds: share(surface.triangleBounds),
      normals: share(surface.normals),
      neighbors: share(surface.neighbors),
      ...(surface.triangleFlags
        ? { triangleFlags: share(surface.triangleFlags) }
        : {}),
    };
  });
}
export function alignmentPoolAdmission(
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  surfaces: readonly NativeAlignmentQuerySurface[],
  parallel = true,
) {
  if (!parallel || lanes.length < 2) return "single-core requested";
  if (!surfaces.length) return "no refinement surfaces";
  if (
    typeof Worker === "undefined" ||
    (globalThis.navigator?.hardwareConcurrency ?? 2) < 2
  )
    return "CPU workers unavailable";
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  if (memory !== undefined && memory < 4) return "device memory admission";
  return alignmentPoolBytes(lanes, surfaces, 3) <= 128 * 1024 * 1024
    ? undefined
    : "128 MiB pool memory admission";
}
function alignmentPoolBytes(
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  surfaces: readonly NativeAlignmentQuerySurface[],
  treeCopies: number,
) {
  let bytes = lanes.reduce((sum, lane) => sum + lane.length * 512, 0);
  for (const surface of surfaces) {
    bytes +=
      (sharedTargetsAvailable() ? 1 : 3) *
      (surface.points.byteLength +
        surface.triangleBounds.byteLength +
        surface.normals.byteLength +
        surface.neighbors.byteLength +
        (surface.triangleFlags?.byteLength ?? 0));
    if (sharedTargetsAvailable()) {
      const { nodes, entries } = alignmentTreeSize(surface.root);
      // Retain the parent object tree, plus one shared packed tree. Both workers
      // read the same buffers; no resident or in-flight object graphs are cloned.
      bytes += nodes * (256 + 116) + entries * (8 + 4);
      continue;
    }
    const nodes = [surface.root];
    while (nodes.length) {
      const node = nodes.pop()!;
      bytes += treeCopies * (256 + node.triangles.length * 8);
      if (bytes > 128 * 1024 * 1024) return bytes;
      for (const child of Object.values(node.children))
        if (child) nodes.push(child);
    }
  }
  return bytes;
}
/** Shared packed trees have no additional in-flight or per-worker tree copies. */
export function alignmentCanInitializeTogether(
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  surfaces: readonly NativeAlignmentQuerySurface[],
) {
  return (
    sharedTargetsAvailable() &&
    alignmentPoolBytes(lanes, surfaces, 5) <= 128 * 1024 * 1024
  );
}

/** Two physical workers own immutable targets and persistent logical lane flags.
 * Responses are joined and reordered by lane before native reduction.
 */
export async function createAlignmentPool(
  lanes: readonly (readonly AlignmentQueryVertex[])[],
  surfaces: readonly NativeAlignmentQuerySurface[],
  options: { parallel?: boolean; signal?: AbortSignal } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Alignment cancelled.", "AbortError");
  const fallbackReason = alignmentPoolAdmission(
    lanes,
    surfaces,
    options.parallel,
  );
  if (fallbackReason) {
    let query: ReturnType<typeof nativeAlignmentTargetGroupQuery> | undefined =
      nativeAlignmentTargetGroupQuery(
        surfaces.map(createNativeAlignmentSurfaceQuery),
      );
    const close = () => {
      query = undefined;
      options.signal?.removeEventListener("abort", close);
    };
    options.signal?.addEventListener("abort", close, { once: true });
    return {
      physicalWorkers: 1,
      fallbackReason,
      execute: async (batch: AlignmentBatch) => {
        if (!query || options.signal?.aborted) {
          close();
          throw new DOMException("Alignment cancelled.", "AbortError");
        }
        return runAlignmentBatch(batch, query);
      },
      close,
    };
  }
  const immutableTargets = sharedTargetsAvailable()
    ? shareTargets(surfaces)
    : Array.from(surfaces);
  const workers: Worker[] = [];
  let sequence = 0,
    stopped = false;
  let pending:
    | {
        id: number;
        values: (AlignmentWorkerResponse | undefined)[];
        resolve: (values: AlignmentWorkerResponse[]) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const close = () => {
    if (stopped) return;
    stopped = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new DOMException("Alignment cancelled.", "AbortError"));
      pending = undefined;
    }
    for (const worker of workers) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    workers.length = 0;
    options.signal?.removeEventListener("abort", close);
    clearTimeout(lease);
  };
  const fail = (error: Error) => {
    const job = pending;
    pending = undefined;
    if (job) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    close();
  };
  const lease = setTimeout(
    () => fail(new Error("Alignment pool lease expired.")),
    15 * 60_000,
  );
  const send = (
    requests: (((id: number) => AlignmentWorkerRequest) | undefined)[],
  ) =>
    new Promise<AlignmentWorkerResponse[]>((resolve, reject) => {
      if (stopped || options.signal?.aborted) {
        reject(new DOMException("Alignment cancelled.", "AbortError"));
        return;
      }
      if (pending) {
        reject(new Error("Alignment pool evaluations must be sequential."));
        return;
      }
      const id = ++sequence;
      pending = {
        id,
        values: requests.map((request) =>
          request ? undefined : { id, ready: true },
        ),
        resolve,
        reject,
        timer: setTimeout(
          () => fail(new Error("Alignment worker timed out.")),
          30_000,
        ),
      };
      try {
        workers.forEach(
          (worker, part) =>
            requests[part] && worker.postMessage(requests[part]!(id)),
        );
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  try {
    options.signal?.addEventListener("abort", close, { once: true });
    if (options.signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
    for (let part = 0; part < 2; part++) {
      const worker = new Worker(
        new URL("./scan-alignment-worker.ts", import.meta.url),
        { type: "module" },
      );
      workers.push(worker);
      worker.onmessage = ({ data }: MessageEvent<AlignmentWorkerResponse>) => {
        if (!pending || data.id !== pending.id || pending.values[part]) return;
        if ("error" in data) {
          fail(new Error(data.error));
          return;
        }
        pending.values[part] = data;
        if (pending.values.every(Boolean)) {
          const job = pending;
          pending = undefined;
          clearTimeout(job.timer);
          job.resolve(job.values as AlignmentWorkerResponse[]);
        }
      };
      worker.onerror = (event) =>
        fail(new Error(event.message || "Alignment worker failed."));
      worker.onmessageerror = () =>
        fail(new Error("Alignment worker response could not be decoded."));
    }
    // Shared packed targets have one admitted allocation, independent of workers.
    const groups = alignmentCanInitializeTogether(lanes, surfaces)
      ? [[0, 1]]
      : [[0], [1]];
    for (const parts of groups) {
      const requests: (((id: number) => AlignmentWorkerRequest) | undefined)[] =
        [undefined, undefined];
      for (const part of parts)
        requests[part] = (id) => ({
          id,
          initialize: {
            lanes: lanes.flatMap((vertices, index) =>
              index % 2 === part
                ? [
                    {
                      id: index,
                      vertices: vertices.map((vertex) => ({ ...vertex })),
                    },
                  ]
                : [],
            ),
            surfaces: immutableTargets,
          },
        });
      const ready = await send(requests);
      if (ready.some((value) => !("ready" in value)))
        throw new Error("Invalid alignment initialization response.");
    }
    return {
      physicalWorkers: 2,
      fallbackReason: "",
      close,
      execute: async (batch: AlignmentBatch): Promise<AlignmentBatchResult> => {
        try {
          const responses = await send(
            workers.map(() => (id) => ({
              id,
              job: { kind: batch.kind, options: batch.options },
            })),
          );
          const values: unknown[] = Array(lanes.length).fill(undefined);
          for (let part = 0; part < responses.length; part++) {
            const response = responses[part];
            if (!("result" in response) || response.result.kind !== batch.kind)
              throw new Error("Invalid alignment phase response.");
            const rows =
              response.result.kind === "query"
                ? response.result.workers
                : response.result.votes;
            if (rows.length !== response.laneIds.length)
              throw new Error("Invalid alignment lane count.");
            response.laneIds.forEach((lane, index) => {
              if (
                !Number.isInteger(lane) ||
                lane < 0 ||
                lane >= lanes.length ||
                lane % 2 !== part ||
                values[lane] !== undefined
              )
                throw new Error("Invalid alignment lane identity.");
              values[lane] = rows[index];
            });
          }
          if (values.some((value) => value === undefined))
            throw new Error("Missing alignment lane response.");
          return batch.kind === "query"
            ? {
                kind: "query",
                workers: values as Extract<
                  AlignmentBatchResult,
                  { kind: "query" }
                >["workers"],
              }
            : {
                kind: "orientation",
                votes: values as Extract<
                  AlignmentBatchResult,
                  { kind: "orientation" }
                >["votes"],
              };
        } catch (error) {
          close();
          throw error;
        }
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}
