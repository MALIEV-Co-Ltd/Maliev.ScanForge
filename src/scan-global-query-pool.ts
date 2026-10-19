import {
  assertNoUnresolvedOwnedWorkers,
  requestOwnedWorkerStop,
  retryOwnedWorkerStops,
  type WorkerCleanupOutcome,
} from "./scan-global-worker-cleanup";
let nextPoolOwner = 0;
import {
  createGlobalQueryWorkerState,
  type GlobalQueryWorkerInit,
  type GlobalQueryJob,
  type GlobalQueryRequest,
  type GlobalQueryResponse,
} from "./scan-global-query-core";
import type { nativeGlobalQuery } from "./scan-native-global-query";
import type { NativeGlobalQueryGeometry } from "./scan-native-global-query";
import {
  globalQueryInputBytes,
  shareGlobalQueryInput,
} from "./scan-global-query-storage";
const sharingAvailable = () =>
  globalThis.crossOriginIsolated === true &&
  typeof SharedArrayBuffer !== "undefined";
function rawCount(geometry: NativeGlobalQueryGeometry) {
  const ids = geometry.rawTargetIds;
  if (
    ids !== undefined &&
    (!(ids instanceof Uint32Array) || ids.length > geometry.points.length / 3)
  )
    throw Error("Invalid raw target record IDs for worker admission.");
  return ids?.length ?? geometry.points.length / 3;
}
function bytes(input: GlobalQueryWorkerInit, copies: number) {
  const preparation = input.scans.reduce(
    (sum, { geometry: g }) =>
      sum +
      (g.targetMeshes ?? []).reduce(
        (n, m) => n + (m.triangles.length / 3) * 384,
        0,
      ) *
        (copies - 1) +
      rawCount(g) * 32 * (copies - 1),
    0,
  );
  return (
    preparation + globalQueryInputBytes(input, copies - 1, sharingAvailable())
  );
}
export function globalQueryPoolAdmission(
  input: GlobalQueryWorkerInit,
  parallel = true,
) {
  return queryPlan(input, parallel).count;
}
function queryPlan(
  input: GlobalQueryWorkerInit,
  parallel = true,
  additionalReserveBytes = 0,
) {
  if (
    !Number.isSafeInteger(additionalReserveBytes) ||
    additionalReserveBytes < 0 ||
    additionalReserveBytes > 512 * 1048576
  )
    throw Error("Invalid coordinator runtime reserve.");
  const memory = (globalThis.navigator as Navigator & { deviceMemory?: number })
    ?.deviceMemory;
  const candidate =
    parallel &&
    typeof Worker !== "undefined" &&
    (globalThis.navigator?.hardwareConcurrency ?? 2) >= 2 &&
    (memory === undefined || memory >= 4)
      ? 2
      : 1;
  const limit = 512 * 1048576;
  if (
    sharingAvailable() &&
    typeof Worker !== "undefined" &&
    input.scans.length >= 2 &&
    input.scans.length <= 32 &&
    input.scans.reduce(
      (count, scan) => count + (scan.geometry.targetMeshes?.length ?? 0),
      0,
    ) <= 64 &&
    input.scans.every(
      ({ geometry: g }) =>
        g.points instanceof Float32Array &&
        g.points.length > 0 &&
        g.normals instanceof Float32Array &&
        g.normals.length === g.points.length &&
        g.rawTargetIds instanceof Uint32Array &&
        rawCount(g) === 0 &&
        !!g.targetMeshes?.length &&
        g.targetMeshes.every(
          (m) =>
            m.vertices instanceof Float32Array &&
            m.triangles instanceof Uint32Array &&
            !m.filterHidden &&
            m.vertices.length / 3 <= 0x100000000 &&
            m.triangles.length <= 0x7fffffff,
        ),
    )
  ) {
    const inputBytes = globalQueryInputBytes(input, candidate, true);
    const minimum = input.scans.reduce(
      (sum, s) =>
        sum +
        s.geometry.targetMeshes!.reduce(
          (n, m) => n + (m.triangles.length / 3) * 14,
          0,
        ),
      0,
    );
    for (const count of candidate === 2 ? [2, 1] : [1]) {
      const reserved =
        inputBytes + (count + 1) * 16 * 1048576 + additionalReserveBytes;
      if (reserved + minimum <= limit)
        return { count, storageBudget: { limit, reserved } };
    }
    throw Error("Global query pool exceeds its 512 MiB memory admission.");
  }
  if (bytes(input, 2) + additionalReserveBytes > 512 * 1048576)
    throw new Error("Global query pool exceeds its 512 MiB memory admission.");
  return {
    count:
      candidate === 2 &&
      bytes(input, 3) + additionalReserveBytes <= 512 * 1048576
        ? 2
        : 1,
    storageBudget: undefined,
  };
}
/** Additional coordinator runtime fits inside the same512MiB admission; never changes worker count. */
export function globalCoordinatorQueryAdmission(
  input: GlobalQueryWorkerInit,
  parallel: boolean | undefined,
  runtimeReserveBytes: number,
  externalReservedBytes = 0,
  expectedWorkers?: number,
) {
  const original = queryPlan(input, parallel, externalReservedBytes);
  const adjusted = queryPlan(
    input,
    parallel,
    externalReservedBytes + runtimeReserveBytes,
  );
  if (
    original.count !== adjusted.count ||
    (expectedWorkers !== undefined && adjusted.count !== expectedWorkers)
  )
    throw Error("Coordinator reserve would change query worker count.");
  return adjusted.count;
}
/** One or two persistent physical CPU workers, same numeric mode in either case.
 * Only independent source queries run concurrently; pose updates stay sequential.
 * Every error/abort/timeout closes all exact owned worker handles. */
export async function createGlobalQueryPool(
  input: GlobalQueryWorkerInit,
  options: {
    parallel?: boolean;
    signal?: AbortSignal;
    runtimeReserveBytes?: number;
    externalReservedBytes?: number;
    expectedWorkers?: number;
    onQueryPoolCleanup?: (outcomes: WorkerCleanupOutcome[]) => void;
  } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Global alignment cancelled.", "AbortError");
  const { count, storageBudget } = queryPlan(
    input,
    options.parallel,
    (options.runtimeReserveBytes ?? 0) + (options.externalReservedBytes ?? 0),
  );
  if (options.runtimeReserveBytes || options.externalReservedBytes)
    globalCoordinatorQueryAdmission(
      input,
      options.parallel,
      options.runtimeReserveBytes ?? 0,
      options.externalReservedBytes ?? 0,
      options.expectedWorkers,
    );
  if (typeof Worker === "undefined") {
    let state: ReturnType<typeof createGlobalQueryWorkerState> | undefined =
      createGlobalQueryWorkerState(input);
    const indexes = state.indexes;
    let closed = false;
    return {
      physicalWorkers: 0,
      storage: undefined,
      indexesPerWorker: [indexes],
      close: () => {
        closed = true;
        state = undefined;
      },
      execute: async (job: GlobalQueryJob) => {
        if (closed || !state || options.signal?.aborted)
          throw new DOMException("Global alignment cancelled.", "AbortError");
        return state.execute(job);
      },
    };
  }
  assertNoUnresolvedOwnedWorkers();
  const poolOwner = ++nextPoolOwner,
    createdUnixMs = Date.now();
  const ownedIds: string[] = [];
  const workers: Worker[] = [];
  let initialization: GlobalQueryWorkerInit | undefined = sharingAvailable()
    ? shareGlobalQueryInput(input)
    : input;
  if (storageBudget)
    initialization = {
      storageBudget,
      scans: initialization.scans.map((scan) => ({
        ...scan,
        geometry: {
          ...scan.geometry,
          targetMeshes: scan.geometry.targetMeshes!.map((mesh) => ({
            ...mesh,
            packedNodes: true,
            compactBounds: true,
            compactNormals: true,
          })),
        },
      })),
    };
  let stopped = false,
    sequence = 0;
  let pending:
    | {
        id: number;
        parts: number[];
        values: (GlobalQueryResponse | undefined)[];
        resolve(values: GlobalQueryResponse[]): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let idle: ReturnType<typeof setTimeout>;
  const abort = () =>
    close(new DOMException("Global alignment cancelled.", "AbortError"));
  const close = (error = new Error("Global query pool is closed.")) => {
    if (stopped)
      return !retryOwnedWorkerStops(ownedIds).some((value) =>
        ownedIds.includes(value.owner),
      );
    stopped = true;
    if (pending) {
      const current = pending;
      pending = undefined;
      clearTimeout(current.timer);
      current.reject(error);
    }
    const outcomes = workers.map((worker, part) =>
      requestOwnedWorkerStop(worker, {
        owner: ownedIds[part],
        runId: poolOwner,
        target: "scan-global-query-worker.ts:" + part,
        createdUnixMs,
        expiresUnixMs: createdUnixMs + 15 * 60_000,
      }),
    );
    workers.length = 0;
    initialization = undefined;
    clearTimeout(lease);
    clearTimeout(idle);
    options.signal?.removeEventListener("abort", abort);
    try {
      options.onQueryPoolCleanup?.(outcomes);
    } catch {
      /* Diagnostic callback cannot interrupt cleanup. */
    }
    return outcomes.every((outcome) => !outcome.retained);
  };
  const lease = setTimeout(
    () => close(new Error("Global query pool lease expired.")),
    15 * 60_000,
  );
  const renew = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (!pending) close(new Error("Global query pool idle lease expired."));
    }, 30_000);
  };
  const send = (
    requests: ((id: number) => GlobalQueryRequest)[],
    parts = workers.map((_, i) => i),
  ) =>
    new Promise<GlobalQueryResponse[]>((resolve, reject) => {
      if (stopped || options.signal?.aborted) {
        reject(new DOMException("Global alignment cancelled.", "AbortError"));
        return;
      }
      if (pending) {
        reject(new Error("Global pose evaluations must be sequential."));
        return;
      }
      renew();
      const id = ++sequence;
      pending = {
        id,
        parts,
        values: Array(workers.length).fill(undefined),
        resolve,
        reject,
        timer: setTimeout(
          () => close(new Error("Global query worker timed out.")),
          30_000,
        ),
      };
      try {
        parts.forEach((part, index) =>
          workers[part].postMessage(requests[index](id)),
        );
      } catch (error) {
        close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  try {
    options.signal?.addEventListener("abort", abort, { once: true });
    for (let part = 0; part < count; part++) {
      const worker = new Worker(
        new URL("./scan-global-query-worker.ts", import.meta.url),
        { type: "module" },
      );
      workers.push(worker);
      ownedIds.push("query:" + poolOwner + ":" + part);
      worker.onmessage = ({ data }: MessageEvent<GlobalQueryResponse>) => {
        if (
          !pending ||
          !pending.parts.includes(part) ||
          data.id !== pending.id ||
          pending.values[part]
        )
          return;
        if ("error" in data) {
          close(new Error(data.error));
          return;
        }
        pending.values[part] = data;
        renew();
        if (pending.parts.every((part) => !!pending!.values[part])) {
          const current = pending;
          pending = undefined;
          clearTimeout(current.timer);
          current.resolve(
            current.parts.map(
              (part) => current.values[part]!,
            ) as GlobalQueryResponse[],
          );
        }
      };
      worker.onerror = (event) =>
        close(new Error(event.message || "Global query worker failed."));
      worker.onmessageerror = () =>
        close(new Error("Global query worker response could not be decoded."));
    }
    // Shared immutable mesh preparation is produced by the first worker only.
    // The existing conservative admission still covers preparation and metadata.
    const indexes: number[] = [];
    const expectedReserves = [storageBudget?.reserved];
    const validStorage = (
      response: GlobalQueryResponse,
      reserved: number | undefined,
    ) => {
      if (!("ready" in response) || !response.storage || !storageBudget)
        return false;
      const s = response.storage;
      return (
        [s.limit, s.reserved, s.live, s.peak].every(Number.isSafeInteger) &&
        s.limit === storageBudget.limit &&
        s.reserved === reserved &&
        s.live >= s.reserved &&
        s.peak >= s.live &&
        s.peak <= s.limit
      );
    };
    let responses: GlobalQueryResponse[];
    if (
      count > 1 &&
      sharingAvailable() &&
      input.scans.some((s) => s.geometry.targetMeshes?.length)
    ) {
      const [first] = await send(
        [
          (id) => ({
            id,
            initialize: { ...initialization!, exportPreparedMeshes: true },
          }),
        ],
        [0],
      );
      if (!("ready" in first) || !first.prepared?.preparedMeshes)
        throw Error("Missing shared prepared targets from the first worker.");
      if (storageBudget) {
        if (!validStorage(first, storageBudget.reserved))
          throw Error("Invalid bounded alignment storage report.");
        expectedReserves[1] = first.storage!.live;
        first.prepared.storageBudget = {
          limit: storageBudget.limit,
          reserved: first.storage!.live,
        };
      }
      responses = [
        first,
        ...(await send([(id) => ({ id, initialize: first.prepared! })], [1])),
      ];
    } else {
      responses = await send(
        workers.map(() => (id) => ({ id, initialize: initialization! })),
      );
    }
    for (const [part, response] of responses.entries()) {
      if (!("ready" in response) || response.indexes !== input.scans.length)
        throw new Error("Invalid global worker initialization response.");
      indexes.push(response.indexes);
      if (storageBudget && !validStorage(response, expectedReserves[part]))
        throw Error("Invalid bounded alignment storage report.");
    }
    const storage = storageBudget
      ? responses.map((response) =>
          "ready" in response ? response.storage : undefined,
        )
      : undefined;
    initialization = undefined;
    responses.length = 0;
    return {
      physicalWorkers: count,
      indexesPerWorker: indexes,
      storage,
      close: () => close(),
      execute: async (
        job: GlobalQueryJob,
      ): Promise<ReturnType<typeof nativeGlobalQuery>> => {
        try {
          if (stopped || options.signal?.aborted)
            throw new DOMException("Global alignment cancelled.", "AbortError");
          if (
            storageBudget &&
            job.cells.reduce((sum, cell) => sum + cell.length, 0) > 16384
          )
            throw Error(
              "Bounded global alignment supports at most 16384 query samples per pose.",
            );
          const samples = job.cells.flat(),
            midpoint = Math.ceil(samples.length / count);
          const responses = await send(
            workers.map((_, part) => (id) => ({
              id,
              job: {
                ...job,
                cells: [samples.slice(part * midpoint, (part + 1) * midpoint)],
              },
            })),
          );
          const pairs: ReturnType<typeof nativeGlobalQuery>["pairs"] = [];
          for (const response of responses) {
            if (
              !("result" in response) ||
              response.result.count !== response.result.pairs.length
            )
              throw new Error("Invalid global correspondence response.");
            pairs.push(...response.result.pairs);
          }
          return { count: pairs.length, pairs };
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
