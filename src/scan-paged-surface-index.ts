import { ReductionSurfaceBVH } from "./scan-reduction-surface";
import {
  checkScanAbort,
  type ScanBounds,
  type ScanBudget,
  type ScanBudgetLease,
  type ScanCoordinates,
  type ScanPageRef,
  type ScanPageStore,
  type ScanReductionManifest,
} from "./scan-geometry-source";
import {
  scanDirectoryEntries,
  scanDirectoryWriter,
} from "./scan-page-directory";

export interface ScanSurfaceIndex {
  queryBatch(
    points: ScanCoordinates,
    radius: number,
    signal?: AbortSignal,
  ): Promise<{
    distances: Float64Array;
    triangleIds: Float64Array;
    release(): void;
  }>;
  dispose(): void;
}
type Chunk = {
  first: number;
  count: number;
  page: ScanPageRef;
  bounds: ScanBounds;
};

/** Paged spatial runs and one leased local BVH; all candidate runs participate. */
export async function preparePagedReductionSurface(
  manifest: ScanReductionManifest,
  store: ScanPageStore,
  budget: ScanBudget,
  signal?: AbortSignal,
): Promise<ScanSurfaceIndex> {
  checkScanAbort(signal);
  const writer = scanDirectoryWriter(store, budget, signal);
  let count = 0,
    largestChunkBytes = 0,
    largestChunkTriangles = 0;
  try {
    for await (const entry of scanDirectoryEntries(
      manifest.chunks,
      store,
      budget,
      signal,
    )) {
      if (entry.first !== count)
        throw new Error(
          "Reduction chunks must have contiguous global triangle IDs.",
        );
      const page = await store.read(entry.page, signal);
      const bounds: [number, number, number, number, number, number] = [
        Infinity,
        Infinity,
        Infinity,
        -Infinity,
        -Infinity,
        -Infinity,
      ];
      try {
        const points =
          manifest.precision === "float32"
            ? new Float32Array(
                page.bytes.buffer,
                page.bytes.byteOffset,
                page.bytes.length / 4,
              )
            : new Float64Array(
                page.bytes.buffer,
                page.bytes.byteOffset,
                page.bytes.length / 8,
              );
        if (points.length !== entry.count * 9)
          throw new Error(
            "Reduced chunk byte count does not match its manifest.",
          );
        for (let at = 0; at < points.length; at++) {
          if (at % 4096 === 0) checkScanAbort(signal);
          const value = Math.fround(points[at]),
            axis = at % 3;
          if (!Number.isFinite(value))
            throw new Error(
              "Reduced coordinates must be finite Float32 values.",
            );
          bounds[axis] = Math.min(bounds[axis], value);
          bounds[axis + 3] = Math.max(bounds[axis + 3], value);
        }
      } finally {
        page.release();
      }
      const scratch = await budget.reserve(
        "surface directory encoding",
        4096,
        signal,
      );
      try {
        const metadata = await store.append(
          new TextEncoder().encode(JSON.stringify({ ...entry, bounds })),
          signal,
        );
        await writer.append({
          first: entry.first,
          count: entry.count,
          page: metadata,
        });
      } finally {
        scratch.release();
      }
      count += entry.count;
      largestChunkBytes = Math.max(largestChunkBytes, entry.page.bytes);
      largestChunkTriangles = Math.max(largestChunkTriangles, entry.count);
    }
    if (count !== manifest.triangles)
      throw new Error("Reduced chunk count does not match its manifest.");
    const directory = await writer.finish();
    let cached:
      | {
          id: string;
          query: ReturnType<ReductionSurfaceBVH["createQuery"]>;
          lease: ScanBudgetLease;
        }
      | undefined;
    let closed = false,
      busy = false;
    const lifetime = new AbortController();
    const evict = () => {
      cached?.lease.release();
      cached = undefined;
    };
    return {
      async queryBatch(points, radius, querySignal) {
        querySignal = AbortSignal.any([
          lifetime.signal,
          ...(signal ? [signal] : []),
          ...(querySignal ? [querySignal] : []),
        ]);
        checkScanAbort(querySignal);
        if (closed || busy)
          throw new Error("Surface index is closed or already in use.");
        if (points.length % 3 || !Number.isFinite(radius) || radius <= 0)
          throw new Error(
            "Surface queries require complete points and a positive finite radius.",
          );
        const samples = points.length / 3;
        evict();
        const free =
          budget.snapshot().capacityBytes - budget.snapshot().reservedBytes;
        const minimum =
          16 * samples +
          8192 +
          largestChunkTriangles * 256 +
          largestChunkBytes +
          16384 +
          512 * directory.levels;
        if (minimum > free)
          throw new RangeError(
            "Surface query cannot fit its working set; split the comparison batch or source chunks.",
          );
        busy = true;
        let lease: ScanBudgetLease | undefined;
        try {
          lease = await budget.reserve(
            "surface query output",
            samples * 16,
            querySignal,
          );
          checkScanAbort(querySignal);
          const distances = new Float64Array(samples).fill(NaN),
            triangleIds = new Float64Array(samples).fill(-1);
          const point = [0, 0, 0];
          for (const value of points)
            if (!Number.isFinite(Math.fround(value)))
              throw new Error(
                "Comparison coordinates must be finite Float32 values.",
              );
          for await (const entry of scanDirectoryEntries(
            directory,
            store,
            budget,
            querySignal,
          )) {
            const scratch = await budget.reserve(
              "surface directory decoding",
              4096,
              querySignal,
            );
            let chunk: Chunk;
            try {
              const metadata = await store.read(entry.page, querySignal);
              try {
                chunk = JSON.parse(new TextDecoder().decode(metadata.bytes));
              } finally {
                metadata.release();
              }
            } finally {
              scratch.release();
            }
            if (
              !chunk.bounds?.every(Number.isFinite) ||
              chunk.first !== entry.first ||
              chunk.count !== entry.count
            )
              throw new Error("Invalid paged surface metadata.");
            const intersects = (id: number, best: number) => {
              for (let axis = 0; axis < 3; axis++) {
                const p = Math.fround(points[id * 3 + axis]);
                if (
                  p < chunk.bounds[axis] - best ||
                  p > chunk.bounds[axis + 3] + best
                )
                  return false;
              }
              return true;
            };
            let candidate = false;
            for (let id = 0; id < samples; id++)
              if (
                intersects(
                  id,
                  Number.isNaN(distances[id])
                    ? radius
                    : Math.abs(distances[id]),
                )
              ) {
                candidate = true;
                break;
              }
            if (!candidate) continue;
            if (cached?.id !== chunk.page.id) {
              evict(); // release before reserving another local index, including on failure
              const treeLease = await budget.reserve(
                "local surface BVH",
                8192 + chunk.count * 256,
                querySignal,
              );
              try {
                const page = await store.read(chunk.page, querySignal);
                try {
                  const coordinates =
                    manifest.precision === "float32"
                      ? new Float32Array(
                          page.bytes.buffer,
                          page.bytes.byteOffset,
                          page.bytes.length / 4,
                        )
                      : new Float64Array(
                          page.bytes.buffer,
                          page.bytes.byteOffset,
                          page.bytes.length / 8,
                        );
                  const indices = Uint32Array.from(
                    { length: chunk.count * 3 },
                    (_, id) => id,
                  );
                  const tree = new ReductionSurfaceBVH(
                    { coordinates, indices },
                    { signal: querySignal },
                  );
                  cached = {
                    id: chunk.page.id,
                    query: tree.createQuery(),
                    lease: treeLease,
                  };
                } finally {
                  page.release();
                }
              } catch (error) {
                treeLease.release();
                throw error;
              }
            }
            for (let id = 0; id < samples; id++) {
              checkScanAbort(querySignal);
              const best = Number.isNaN(distances[id])
                ? radius
                : Math.abs(distances[id]);
              if (!intersects(id, best)) continue;
              for (let axis = 0; axis < 3; axis++)
                point[axis] = Math.fround(points[id * 3 + axis]);
              // Local strict-radius queries must still expose ties across runs.
              const hit = cached!.query(
                point,
                best + Math.max(Number.MIN_VALUE, best * Number.EPSILON),
              );
              if (!hit) continue;
              const absolute = Math.abs(hit.distance),
                global = chunk.first + hit.triangle;
              if (
                absolute < best ||
                (absolute === best &&
                  triangleIds[id] >= 0 &&
                  global < triangleIds[id])
              ) {
                distances[id] = hit.distance;
                triangleIds[id] = global;
              }
            }
          }
          return { distances, triangleIds, release: lease.release };
        } catch (error) {
          lease?.release();
          evict();
          throw error;
        } finally {
          busy = false;
        }
      },
      dispose() {
        closed = true;
        lifetime.abort(
          new DOMException("Surface index disposed.", "AbortError"),
        );
        evict();
      },
    };
  } finally {
    writer.dispose();
  }
}
