import {
  packNoiseOctree,
  partitionNoiseRoot,
  prepareNoiseOctree,
  refineNoiseOctant,
  type PackedNoiseTree,
  type NoiseIndexedSurface,
  type NoiseTreeTriangle,
} from "./scan-noise-octree";
import type { MeshProcessingOptions } from "./mesh-processing";
import type { NoiseTreeResult, NoiseTreeTask } from "./scan-noise-tree-worker";

export function noiseTreeWorkerCount(triangles: number) {
  const hardware = globalThis.navigator?.hardwareConcurrency ?? 2;
  const memory = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  // Three packed buffer copies, ordered memberships and two bounded subtree results.
  const bytes = triangles * 480 + 8008 * 4096 + 1000000 * 16;
  return typeof Worker !== "undefined" &&
    triangles >= 80000 &&
    hardware >= 4 &&
    (memory === undefined || memory >= 8) &&
    bytes <= 128 * 1024 * 1024
    ? 2
    : 1;
}

/** Dispatch only fully partitioned immutable inputs; publish after both tasks join. */
export async function refineNoiseTreeAsync(
  prepared: PackedNoiseTree,
  minimumExtent = 0.5,
  maximumDepth = 10,
  options: MeshProcessingOptions = {},
): Promise<PackedNoiseTree> {
  const aborted = () =>
    new DOMException("Mesh operation cancelled.", "AbortError");
  if (options.signal?.aborted) throw aborted();
  const workers: Worker[] = [];
  let rejectPending: ((error: Error) => void) | undefined;
  const abort = () => rejectPending?.(aborted());
  let expiry: ReturnType<typeof setTimeout> | undefined;
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await new Promise<NoiseTreeResult[]>((resolve, reject) => {
      rejectPending = reject;
      const results: (NoiseTreeResult | undefined)[] = [undefined, undefined];
      expiry = setTimeout(
        () => reject(new Error("Noise construction timed out.")),
        120_000,
      );
      for (let part = 0; part < 2; part++) {
        const worker = new Worker(
          new URL("./scan-noise-tree-worker.ts", import.meta.url),
          { type: "module" },
        );
        workers.push(worker);
        worker.onerror = (event) =>
          reject(
            new Error(event.message || "Noise construction worker failed."),
          );
        worker.onmessageerror = () =>
          reject(new Error("Noise construction result could not be decoded."));
        worker.onmessage = ({ data }: MessageEvent<NoiseTreeResult>) => {
          if (results[part]) return;
          if ("error" in data) {
            reject(new Error(data.error));
            return;
          }
          if (
            !Number.isSafeInteger(data.descendants) ||
            data.descendants < 0 ||
            data.descendants > 4000 ||
            Object.keys(data.children).length !== 4 ||
            [0, 1, 2, 3].some((i) => !data.children[part * 4 + i])
          ) {
            reject(new Error("Invalid noise construction result."));
            return;
          }
          results[part] = data;
          if (results.every(Boolean)) resolve(results as NoiseTreeResult[]);
        };
        const task: NoiseTreeTask = {
          prepared,
          begin: part * 4,
          end: part * 4 + 4,
          minimumExtent,
          maximumDepth,
        };
        worker.postMessage(task);
      }
    });
    if (options.signal?.aborted) throw aborted();
    const children = { ...prepared.root.children };
    let nodes = 8;
    for (const part of result) {
      if ("error" in part) throw new Error(part.error);
      nodes += part.descendants;
      Object.assign(children, part.children);
    }
    if (nodes > 100000)
      throw new RangeError("Noise tree exceeds its node budget");
    return { ...prepared, root: { ...prepared.root, children } };
  } catch (error) {
    if (
      options.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    )
      throw aborted();
    // Release worker copies before retrying original partitioned inputs.
    for (const worker of workers) worker.terminate();
    workers.length = 0;
    let nodes = 8;
    for (let octant = 0; octant < 8; octant++) {
      const remaining = 100000 - nodes;
      const result = refineNoiseOctant(
        prepared,
        octant,
        minimumExtent,
        maximumDepth,
        options,
        remaining,
      );
      nodes += result.descendants;
    }
    return prepared;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    clearTimeout(expiry);
    for (const worker of workers) worker.terminate();
  }
}

export async function prepareNoiseOctreeAsync(
  triangles: readonly NoiseTreeTriangle[] | NoiseIndexedSurface,
  minimumExtent = 0.5,
  maximumDepth = 10,
  options: MeshProcessingOptions = {},
  experimentalParallel = false,
) {
  const count = Array.isArray(triangles)
    ? triangles.length
    : (triangles as NoiseIndexedSurface).indices.length / 3;
  if (!experimentalParallel || noiseTreeWorkerCount(count) === 1)
    return prepareNoiseOctree(triangles, minimumExtent, maximumDepth, options);
  const prepared = packNoiseOctree(
    triangles,
    minimumExtent,
    maximumDepth,
    options,
  );
  partitionNoiseRoot(prepared, options);
  return refineNoiseTreeAsync(prepared, minimumExtent, maximumDepth, options);
}
