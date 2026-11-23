import { requestOwnedWorkerStop } from "./scan-global-worker-cleanup";
import type { Entity } from "./types";
import { createDatumTransformExecutor } from "./datum-transform-pool";
import type {
  initializeGlobalSamples,
  GlobalInitializationFit,
  GlobalInitializationScan,
} from "./global-alignment-initialization-core";
export type GlobalInitializationResult = ReturnType<
  typeof initializeGlobalSamples
> & { order?: string[] };
/** Surface coverage is independent of tessellation density; compare bounded stratified facet areas. */
export function globalAlignmentCoverage(entity: Entity) {
  const triangles = Math.floor(entity.positions.length / 9),
    count = Math.min(6000, triangles);
  let area = 0;
  for (let i = 0; i < count; i++) {
    const slot = Math.floor((i * triangles) / count) * 9,
      p = entity.positions,
      ax = p[slot + 3] - p[slot],
      ay = p[slot + 4] - p[slot + 1],
      az = p[slot + 5] - p[slot + 2],
      bx = p[slot + 6] - p[slot],
      by = p[slot + 7] - p[slot + 1],
      bz = p[slot + 8] - p[slot + 2];
    area +=
      Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) * 0.5;
  }
  return count ? (area * triangles) / count : 0;
}
export function sampleGlobalInitialization(
  entities: readonly Entity[],
  limit = 6000,
): GlobalInitializationScan[] {
  return [...entities]
    .map((e) => ({ e, area: globalAlignmentCoverage(e) }))
    .sort(
      (a, b) => b.area - a.area || b.e.positions.length - a.e.positions.length,
    )
    .map((item) => item.e)
    .map((e) => {
      const corners = e.positions.length / 3,
        count = Math.min(limit, Math.floor(corners / 3));
      const points = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const slot = Math.floor((i * (corners / 3)) / count) * 9;
        for (let a = 0; a < 3; a++) points[i * 3 + a] = e.positions[slot + a];
      }
      return { id: e.id, points };
    });
}
async function runGlobalPlacement(
  entities: readonly Entity[],
  options: {
    signal: AbortSignal;
    check: () => void;
    parallel?: boolean;
    onPose?: (poses: GlobalInitializationFit[]) => void;
    onProgress?: (n: number, s: string) => void;
    surfaceDistance?: number;
    anchorId?: string;
    surfaceCandidates?: Record<string, number[][]>;
  },
) {
  const surface = options.surfaceDistance !== undefined;
  const samples = sampleGlobalInitialization(
    entities,
    surface ? 2000 : 6000,
  ).map((s) => ({ ...s, candidates: options.surfaceCandidates?.[s.id] }));
  if (surface && options.anchorId) {
    const index = samples.findIndex((s) => s.id === options.anchorId);
    if (index < 0)
      throw Error("Surface anchor is not in the aligned scan set.");
    samples.unshift(...samples.splice(index, 1));
  }
  const meshes = surface
    ? entities.map((e) => ({
        id: e.id,
        vertices:
          e.indexedMesh?.vertices instanceof Float32Array
            ? e.indexedMesh.vertices
            : Float32Array.from(e.indexedMesh?.vertices ?? e.positions),
        triangles:
          e.indexedMesh?.triangles instanceof Uint32Array
            ? e.indexedMesh.triangles
            : e.indexedMesh?.triangles
              ? Uint32Array.from(e.indexedMesh.triangles)
              : Uint32Array.from(
                  { length: e.positions.length / 3 },
                  (_, i) => i,
                ),
      }))
    : undefined;
  if (
    meshes &&
    meshes.reduce(
      (sum, m) =>
        sum +
        m.vertices.byteLength +
        m.triangles.byteLength +
        (m.triangles.length / 3) * 64,
      0,
    ) >
      512 * 1024 * 1024
  )
    throw Error(
      "Automatic surface placement exceeds its 512 MiB workspace limit.",
    );

  if (samples.some((s) => s.points.length < 9))
    throw Error(
      "Automatic placement requires at least three scan samples per object.",
    );
  options.check();
  const result = await new Promise<GlobalInitializationResult>(
    (resolve, reject) => {
      const worker = new Worker(
        new URL("./global-alignment-initialization-worker.ts", import.meta.url),
        {
          type: "module",
          name: surface
            ? "global-surface-placement"
            : "global-coarse-placement",
        },
      );
      const started = Date.now();
      const identity = {
        owner: crypto.randomUUID(),
        runId: started,
        target: surface
          ? "global-surface-placement"
          : "global-coarse-placement",
        createdUnixMs: started,
        expiresUnixMs: started + 180000,
      };
      let settled = false;
      const finish = (error?: Error, result?: GlobalInitializationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(stale);
        options.signal.removeEventListener("abort", abort);
        const cleanup = requestOwnedWorkerStop(worker, identity);
        if (cleanup.retained)
          error = Error(
            "Automatic placement worker cleanup is unconfirmed; retry before starting another alignment.",
          );
        if (error) reject(error);
        else resolve(result!);
      };
      const abort = () =>
        finish(
          new DOMException("Automatic placement cancelled.", "AbortError"),
        );
      const timer = setTimeout(
        () => finish(Error("Automatic placement timed out.")),
        180000,
      );
      const stale = setInterval(() => {
        try {
          options.check();
        } catch (e) {
          finish(e instanceof Error ? e : Error(String(e)));
        }
      }, 100);
      const ids = new Set(samples.map((s) => s.id));
      const validate = (poses: GlobalInitializationFit[]) => {
        if (
          !Array.isArray(poses) ||
          poses.length !== ids.size ||
          new Set(poses.map((p) => p.id)).size !== ids.size ||
          poses.some(
            (p) =>
              !ids.has(p.id) ||
              p.matrix.length !== 12 ||
              !p.matrix.every(Number.isFinite) ||
              !Number.isFinite(p.rms) ||
              p.rms < 0 ||
              (p.beforeRms !== undefined &&
                (!Number.isFinite(p.beforeRms) || p.beforeRms < 0)) ||
              (p.iterations !== undefined &&
                (!Number.isInteger(p.iterations) ||
                  p.iterations < 0 ||
                  p.iterations > 80)) ||
              typeof p.ambiguous !== "boolean",
          )
        )
          throw Error("Invalid automatic-placement pose response.");
      };
      worker.onmessage = ({ data }) => {
        try {
          options.check();
          if (data.error) throw Error(data.error);
          if (data.poses) {
            validate(data.poses);
            options.onPose?.(data.poses);
          } else if (data.result) {
            validate(data.result.fits);
            if (
              data.result.order !== undefined &&
              (!Array.isArray(data.result.order) ||
                data.result.order.length !== ids.size ||
                new Set(data.result.order).size !== ids.size ||
                data.result.order.some((id: string) => !ids.has(id)) ||
                data.result.order[0] !== data.result.anchorId)
            )
              throw Error("Invalid surface fitting order.");
            if (!ids.has(data.result.anchorId))
              throw Error("Invalid automatic placement anchor.");
            finish(undefined, data.result);
          } else throw Error("Invalid automatic placement response.");
        } catch (e) {
          finish(e instanceof Error ? e : Error(String(e)));
        }
      };
      worker.onerror = (e) =>
        finish(Error(e.message || "Automatic placement worker failed."));
      worker.onmessageerror = () =>
        finish(Error("Automatic placement response could not be decoded."));
      options.signal.addEventListener("abort", abort, { once: true });
      try {
        options.check();
        worker.postMessage(
          surface
            ? { samples, meshes, distanceLimit: options.surfaceDistance }
            : samples,
          samples.map((s) => s.points.buffer),
        );
      } catch (e) {
        finish(e instanceof Error ? e : Error(String(e)));
      }
    },
  );
  const executor = createDatumTransformExecutor({
    ...options,
    threshold: 0,
    typedNormals: true,
    sharedOutput: true,
  });
  const output: Entity[] = [];
  try {
    for (const e of entities) {
      options.check();
      const fit = result.fits.find((f) => f.id === e.id)!;
      options.onProgress?.(
        output.length / entities.length,
        surface
          ? "Applying surface-fitted scan frames"
          : "Preparing automatically placed scans",
      );
      output.push(
        e.id === result.anchorId
          ? e
          : (await executor.transformScanStages(e, [fit.matrix])).entity,
      );
    }
    options.check();
    return { ...result, entities: output };
  } finally {
    executor.close();
  }
}

export const initializeGlobalAlignment = (
  entities: readonly Entity[],
  options: Parameters<typeof runGlobalPlacement>[1],
) => runGlobalPlacement(entities, options);
export const refineGlobalSurfaceAlignment = (
  entities: readonly Entity[],
  options: Parameters<typeof runGlobalPlacement>[1] & {
    surfaceDistance: number;
  },
) => runGlobalPlacement(entities, options);
