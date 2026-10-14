import type { Entity, Positions } from "./types";
import { datumScanTransformPlan } from "./datum-alignment";
import {
  executeDatumTransform,
  type DatumTransformRequest,
  type DatumTransformResponse,
} from "./datum-transform-worker";
const CHUNK_VALUES = 262_144 * 3;
export function createDatumTransformExecutor(
  options: {
    parallel?: boolean;
    signal?: AbortSignal;
    threshold?: number;
  } = {},
) {
  const workers: Worker[] = [];
  let sequence = 0,
    closed = false,
    fallbackReason =
      options.parallel === false ? "single-core requested" : undefined;
  const pending = new Map<
    number,
    {
      resolve: (value: DatumTransformResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(lease);
    options.signal?.removeEventListener("abort", close);
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new DOMException("Alignment cancelled.", "AbortError"));
    }
    pending.clear();
    for (const worker of workers) worker.terminate();
  };
  const lease = setTimeout(close, 180_000);
  options.signal?.addEventListener("abort", close, { once: true });
  const check = () => {
    if (closed || options.signal?.aborted)
      throw new DOMException("Alignment cancelled.", "AbortError");
  };
  const start = () => {
    if (workers.length || fallbackReason) return;
    if (
      typeof Worker === "undefined" ||
      (globalThis.navigator?.hardwareConcurrency ?? 1) < 2
    ) {
      fallbackReason = "CPU workers unavailable";
      return;
    }
    const memory = (
      globalThis.navigator as Navigator & { deviceMemory?: number }
    )?.deviceMemory;
    if (memory !== undefined && memory < 4) {
      fallbackReason = "device memory admission";
      return;
    }
    try {
      for (let i = 0; i < 2; i++) {
        const worker = new Worker(
          new URL("./datum-transform-worker.ts", import.meta.url),
          { type: "module" },
        );
        workers.push(worker);
        worker.onmessage = ({ data }: MessageEvent<DatumTransformResponse>) => {
          const entry = pending.get(data.id);
          if (!entry) return;
          pending.delete(data.id);
          clearTimeout(entry.timer);
          if ("error" in data) entry.reject(new Error(data.error));
          else entry.resolve(data);
        };
        worker.onerror = (event) => {
          for (const entry of pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(
              new Error(event.message || "Alignment worker failed."),
            );
          }
          pending.clear();
          close();
        };
      }
    } catch {
      for (const worker of workers) worker.terminate();
      workers.length = 0;
      fallbackReason = "CPU worker startup failed";
    }
  };
  const send = (worker: Worker, input: DatumTransformRequest) =>
    new Promise<DatumTransformResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(input.id);
        reject(new Error("Alignment transform worker timed out."));
        close();
      }, 30_000);
      pending.set(input.id, { resolve, reject, timer });
      try {
        worker.postMessage(input, [input.input.buffer as ArrayBuffer]);
      } catch (error) {
        pending.delete(input.id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  const transform = async (
    input: Positions,
    matrix: readonly number[],
    vector = false,
  ) => {
    check();
    if (
      input.length % 3 ||
      matrix.length !== 12 ||
      !matrix.every(Number.isFinite)
    )
      throw new Error(
        "Alignment transform requires XYZ coordinates and a finite 3x4 matrix.",
      );
    const usePool =
      options.parallel !== false &&
      input.length / 3 >= (options.threshold ?? 1_048_576);
    if (usePool) start();
    const lanes = usePool && workers.length ? workers.length : 1;
    const output = new Float32Array(input.length),
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (
      let offset = 0;
      offset < input.length;
      offset += CHUNK_VALUES * lanes
    ) {
      check();
      const requests: {
        offset: number;
        length: number;
        request: DatumTransformRequest;
      }[] = [];
      for (let lane = 0; lane < lanes; lane++) {
        const first = offset + lane * CHUNK_VALUES;
        if (first >= input.length) break;
        const length = Math.min(CHUNK_VALUES, input.length - first),
          values =
            input instanceof Float32Array
              ? input.slice(first, first + length)
              : new Float64Array(length);
        if (!(input instanceof Float32Array))
          for (let i = 0; i < length; i++) values[i] = input[first + i];
        requests.push({
          offset: first,
          length,
          request: {
            id: ++sequence,
            input: values,
            matrix: Array.from(matrix),
            vector,
          },
        });
      }
      const results = await Promise.all(
        requests.map((part, lane) =>
          lanes > 1
            ? send(workers[lane], part.request)
            : Promise.resolve(executeDatumTransform(part.request)),
        ),
      );
      check();
      results.forEach((result, lane) => {
        if ("error" in result) throw new Error(result.error);
        if (result.output.length !== requests[lane].length)
          throw new Error(
            "Alignment worker returned an invalid coordinate count.",
          );
        output.set(result.output, requests[lane].offset);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], result.min[axis]);
          max[axis] = Math.max(max[axis], result.max[axis]);
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      check();
    }
    return {
      output,
      bounds: { min, max },
      execution: {
        physicalWorkers: lanes > 1 ? lanes : 0,
        chunkVertices: CHUNK_VALUES / 3,
        fallbackReason:
          lanes > 1
            ? undefined
            : options.parallel === false
              ? "single-core requested"
              : usePool
                ? fallbackReason
                : "small scan serial path",
      },
    };
  };
  return {
    close,
    transform,
    transformScan: async (entity: Entity, matrix: readonly number[]) => {
      check();
      const plan = datumScanTransformPlan(entity);
      const positions = await transform(entity.positions, matrix);
      const vertices = plan.indexed
        ? await transform(plan.indexed.vertices, matrix)
        : undefined;
      const normals = entity.normals
        ? await transform(entity.normals, matrix, true)
        : undefined;
      return {
        entity: plan.assemble(
          positions.output,
          vertices?.output,
          normals?.output,
        ),
        bounds: positions.bounds,
        execution: positions.execution,
      };
    },
  };
}
