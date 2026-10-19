import {
  assertNoUnresolvedOwnedWorkers,
  requestOwnedWorkerStop,
  type WorkerCleanupOutcome,
} from "./scan-global-worker-cleanup";
import { copyGlobalSceneForTransfer } from "./scan-global-scene-transport";
import {
  executeGlobalScenePreparation,
  type GlobalSceneInput,
  type GlobalSceneResult,
  type GlobalSceneResponse,
} from "./scan-global-scene-core";
import { createGlobalQueryPool } from "./scan-global-query-pool";
import type { GlobalQueryJob } from "./scan-global-query-worker";
let preparationActive = false;
let nextPreparationOwner = 0;
export function globalSceneAdmission(input: GlobalSceneInput) {
  const ids = new Set<string>();
  let estimated = 0;
  for (const scan of input.scans) {
    if (!scan.id || ids.has(scan.id))
      throw Error("Global scene scan IDs must be unique.");
    ids.add(scan.id);
    const g = scan.geometry;
    if (
      !(g.points instanceof Float32Array) ||
      !(g.normals instanceof Float32Array)
    )
      throw Error("Global scene requires Float32 geometry.");
    estimated +=
      2 *
        (g.points.byteLength +
          g.normals.byteLength +
          (g.flags?.byteLength ?? 0) +
          (g.labels?.byteLength ?? 0)) +
      (g.points.length / 3) * 96;
  }
  if (estimated > 512 * 1048576)
    throw Error("Global scene exceeds its 512 MiB preparation admission.");
  return estimated;
}
/** A single disposable preparation worker. Authored buffers are cloned, never detached.
 * The main-thread timeout can terminate even a blocked worker. */
export async function prepareGlobalScene(
  input: GlobalSceneInput,
  signal?: AbortSignal,
): Promise<GlobalSceneResult> {
  if (signal?.aborted)
    throw new DOMException("Global preparation cancelled.", "AbortError");
  assertNoUnresolvedOwnedWorkers();
  globalSceneAdmission(input);
  if (typeof Worker === "undefined") {
    if (typeof document !== "undefined")
      throw Error("Global scene preparation requires browser workers.");
    return executeGlobalScenePreparation(input);
  }
  if (preparationActive)
    throw Error("Global scene preparation is already running.");
  preparationActive = true;
  const runId = ++nextPreparationOwner,
    createdUnixMs = Date.now();
  try {
    return await new Promise((resolve, reject) => {
      let worker: Worker | undefined;
      let settled = false;
      const finish = (error?: Error, result?: GlobalSceneResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        let terminationError: Error | undefined;
        try {
          if (worker) {
            const cleanup = requestOwnedWorkerStop(worker, {
              owner: "scene-preparation:" + runId,
              runId,
              target: "scan-global-scene-worker.ts",
              createdUnixMs,
              expiresUnixMs: createdUnixMs + 120_000,
            });
            if (cleanup.retained)
              terminationError = Error(
                "Scene preparation termination request remains unconfirmed; exact recovery handle retained.",
              );
          }
        } catch (stopError) {
          terminationError =
            stopError instanceof Error ? stopError : Error(String(stopError));
        } finally {
          worker = undefined;
          if (error) reject(error);
          else if (terminationError) reject(terminationError);
          else resolve(result!);
        }
      };
      const abort = () =>
        finish(new DOMException("Global preparation cancelled.", "AbortError"));
      const timer = setTimeout(
        () => finish(Error("Global scene preparation timed out.")),
        120_000,
      );
      try {
        signal?.addEventListener("abort", abort, { once: true });
        worker = new Worker(
          new URL("./scan-global-scene-worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.onmessage = ({ data }: MessageEvent<GlobalSceneResponse>) => {
          if (!data || typeof data !== "object")
            finish(Error("Invalid global scene worker response."));
          else if ("error" in data) finish(Error(data.error));
          else if (
            !data.result ||
            !Array.isArray(data.result.sources) ||
            data.result.sources.length !== input.scans.length
          )
            finish(Error("Invalid global scene worker response."));
          else finish(undefined, data.result);
        };
        worker.onerror = (event) =>
          finish(
            Error(event.message || "Global scene preparation worker failed."),
          );
        worker.onmessageerror = () =>
          finish(
            Error("Global scene preparation response could not be decoded."),
          );
        if (signal?.aborted) abort();
        else if (
          input.scans.reduce(
            (sum, { geometry: g }) =>
              sum +
              g.points.byteLength +
              g.normals.byteLength +
              (g.flags?.byteLength ?? 0) +
              (g.labels?.byteLength ?? 0),
            0,
          ) <=
          4 * 1048576
        )
          worker.postMessage(input);
        else
          void copyGlobalSceneForTransfer(input, () => {
            if (settled || signal?.aborted)
              throw new DOMException(
                "Global preparation cancelled.",
                "AbortError",
              );
          })
            .then((packet) => {
              if (!settled) worker!.postMessage(packet.input, packet.transfer);
            })
            .catch((error) =>
              finish(error instanceof Error ? error : Error(String(error))),
            );
      } catch (error) {
        finish(error instanceof Error ? error : Error(String(error)));
      }
    });
  } finally {
    preparationActive = false;
  }
}
/** Prepared scene labels and sample IDs remain fixed while the outer controller
 * changes poses. Only independent correspondence queries use multiple cores. */
export interface PreparedGlobalQueryScene {
  sources: {
    id: string;
    eligible: boolean;
    labels: Uint32Array;
    selected: number[][];
    sampled: number;
  }[];
}
export function preparedGlobalQueryScans(
  input: GlobalSceneInput,
  scene: PreparedGlobalQueryScene,
) {
  const eligible = scene.sources.filter((source) => source.eligible);
  if (eligible.length < 2)
    throw Error(
      "Global alignment requires two eligible scans with retained normal groups.",
    );
  const scans = eligible.map((source) => {
    const original = input.scans.find((scan) => scan.id === source.id)!;
    return {
      id: source.id,
      geometry: { ...original.geometry, labels: source.labels },
    };
  });
  return { scans };
}
export async function createPreparedGlobalQueryPool(
  input: GlobalSceneInput,
  options: {
    parallel?: boolean;
    signal?: AbortSignal;
    runtimeReserveBytes?: number;
    externalReservedBytes?: number;
    expectedWorkers?: number;
    onQueryPoolCleanup?: (outcomes: WorkerCleanupOutcome[]) => void;
  } = {},
) {
  const scene = await prepareGlobalScene(input, options.signal);
  return createGlobalQueryPoolFromPrepared(input, scene, options);
}
/** Preparation has already completed on the original admitted parent route. */
export async function createGlobalQueryPoolFromPrepared(
  input: GlobalSceneInput,
  preparedScene: PreparedGlobalQueryScene,
  options: {
    parallel?: boolean;
    signal?: AbortSignal;
    runtimeReserveBytes?: number;
    externalReservedBytes?: number;
    expectedWorkers?: number;
    onQueryPoolCleanup?: (outcomes: WorkerCleanupOutcome[]) => void;
  } = {},
) {
  let scene: PreparedGlobalQueryScene | undefined = preparedScene;
  const eligible = scene.sources.filter((source) => source.eligible);
  if (eligible.length < 2)
    throw Error(
      "Global alignment requires two eligible scans with retained normal groups.",
    );
  const scans = eligible.map((source) => {
    const original = input.scans.find((scan) => scan.id === source.id)!;
    return {
      id: source.id,
      geometry: { ...original.geometry, labels: source.labels },
    };
  });
  const preparedMask = input.mask;
  let pool: Awaited<ReturnType<typeof createGlobalQueryPool>> | undefined =
    await createGlobalQueryPool({ scans }, options);
  const physicalWorkers = pool.physicalWorkers;
  let closeRequested = true;
  const close = () => {
    options.signal?.removeEventListener("abort", close);
    const requested = pool?.close();
    if (requested === false) closeRequested = false;
    pool = undefined;
    scene = undefined;
    return closeRequested;
  };
  options.signal?.addEventListener("abort", close, { once: true });
  if (options.signal?.aborted) close();
  return {
    physicalWorkers,
    scanIds: eligible.map((source) => source.id),
    sampled: eligible.map((source) => source.sampled),
    close,
    async execute(job: Omit<GlobalQueryJob, "cells">) {
      if (!pool || !scene)
        throw new DOMException(
          "Prepared global alignment is closed.",
          "AbortError",
        );
      const source = scene.sources.find(
        (source) => source.id === job.sourceId && source.eligible,
      );
      if (!source) throw Error("Prepared global source is not eligible.");
      try {
        return await pool.execute({
          ...job,
          mask: job.mask ?? preparedMask,
          cells: source.selected,
        });
      } catch (error) {
        close();
        throw error;
      }
    },
  };
}
