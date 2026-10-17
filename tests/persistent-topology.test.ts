import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import * as codec from "../src/topology-cache-codec";
import {
  meshTopologyCacheKey,
  preparePersistentTopology,
  type TopologyRecordStore,
} from "../src/persistent-topology";
import type { TopologyCacheRecord } from "../src/topology-cache-store";
import type { MeshProcessingOptions } from "../src/mesh-processing";

const square = () =>
  new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]);
const options = (
  stages: string[] = [],
): MeshProcessingOptions & {
  topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]>;
} => ({
  tolerance: 0.001,
  topologyCache: {},
  onProgress: (_fraction, stage) => stages.push(stage),
});
function memoryStore() {
  const records = new Map<string, TopologyCacheRecord>();
  const store: TopologyRecordStore = {
    read: vi.fn(async (key) => structuredClone(records.get(key))),
    write: vi.fn(async (record) => {
      records.set(record.key, structuredClone(record));
      return true;
    }),
    remove: vi.fn(async (key) => {
      records.delete(key);
    }),
  };
  return { records, store };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persistent full topology preparation", () => {
  it("discards an obsolete format and rebuilds under the current content key", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, records } = memoryStore();
    await preparePersistentTopology(square(), options(), store);
    const saved = [...records.values()][0];
    (saved.payload as { format: number }).format = 1;
    const stages: string[] = [];
    expect(
      (await preparePersistentTopology(square(), options(stages), store))
        .topologyCache,
    ).toBe("stored");
    expect(store.remove).toHaveBeenCalledOnce();
    expect(stages).toContain("Welding vertices");
    expect(
      ([...records.values()][0].payload as { format: number }).format,
    ).toBe(2);
  });
  it("rejects an oversized snapshot before allocating packed buffers", async () => {
    vi.stubGlobal("crypto", webcrypto);
    vi.spyOn(codec, "estimatedPackedTopologyBytes").mockReturnValue(
      128 * 1024 * 1024 + 1,
    );
    const pack = vi.spyOn(codec, "packTopology"),
      { store } = memoryStore(),
      prepared = options();
    expect(
      (await preparePersistentTopology(square(), prepared, store))
        .topologyCache,
    ).toBe("oversize");
    expect(pack).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(prepared.topologyCache.topology?.boundaryLoops).toHaveLength(1);
  });
  it("restores all topology after reopening without welding or building adjacency", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = memoryStore(),
      first = options(),
      stages: string[] = [];
    expect(
      (await preparePersistentTopology(square(), first, store)).topologyCache,
    ).toBe("stored");
    const reopened = options(stages);
    expect(
      (await preparePersistentTopology(Array.from(square()), reopened, store))
        .topologyCache,
    ).toBe("persistent-hit");
    expect(reopened.topologyCache.topology).toEqual(
      first.topologyCache.topology,
    );
    expect(stages).not.toContain("Welding vertices");
    expect(stages).not.toContain("Building topology");
  });
  it("keys every coordinate, triangle order, tolerance and cache version rather than filenames", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const positions = square(),
      same = Array.from(positions),
      edited = positions.slice();
    edited[edited.length - 1] = 0.0000001;
    const key = await meshTopologyCacheKey(positions, 0.001);
    expect(key).toMatch(/^scanforge-topology-v2:/);
    expect(await meshTopologyCacheKey(same, 0.001)).toBe(key);
    expect(await meshTopologyCacheKey(edited, 0.001)).not.toBe(key);
    expect(await meshTopologyCacheKey(positions, 0.000001)).not.toBe(key);
    expect(
      await meshTopologyCacheKey(
        [...same.slice(9), ...same.slice(0, 9)],
        0.001,
      ),
    ).not.toBe(key);
    const large = Array.from({ length: 45000 }, (_, i) => i % 31),
      changed = [...large];
    changed[changed.length - 1]++;
    expect(await meshTopologyCacheKey(large, 0.001)).not.toBe(
      await meshTopologyCacheKey(changed, 0.001),
    );
  });
  it("rebuilds and stores changed geometry while leaving the original content entry reusable", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, records } = memoryStore(),
      original = square();
    await preparePersistentTopology(original, options(), store);
    const changed = original.slice();
    changed[3] = 2;
    const stages: string[] = [];
    expect(
      (await preparePersistentTopology(changed, options(stages), store))
        .topologyCache,
    ).toBe("stored");
    expect(stages).toContain("Welding vertices");
    expect(records.size).toBe(2);
    expect(
      (await preparePersistentTopology(original.slice(), options(), store))
        .topologyCache,
    ).toBe("persistent-hit");
  });
  it("rejects corrupted payloads and regenerates the index", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store, records } = memoryStore();
    await preparePersistentTopology(square(), options(), store);
    const saved = [...records.values()][0];
    new Uint8Array(
      (saved.payload as { buffers: ArrayBuffer[] }).buffers[0],
    )[0] ^= 1;
    const stages: string[] = [];
    expect(
      (await preparePersistentTopology(square(), options(stages), store))
        .topologyCache,
    ).toBe("stored");
    expect(store.remove).toHaveBeenCalledOnce();
    expect(stages).toContain("Welding vertices");
  });
  it("falls back without breaking analysis when storage or hashing is unavailable", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = memoryStore();
    vi.mocked(store.read).mockRejectedValue(new Error("Blocked storage"));
    vi.mocked(store.write).mockResolvedValue(false);
    const first = options();
    await expect(
      preparePersistentTopology(square(), first, store),
    ).resolves.toMatchObject({ topologyCache: "unavailable" });
    expect(first.topologyCache.topology?.boundaryLoops).toHaveLength(1);
    vi.stubGlobal("crypto", undefined);
    const second = options();
    await expect(
      preparePersistentTopology(square(), second, store),
    ).resolves.toMatchObject({ topologyCache: "unavailable" });
    expect(second.topologyCache.topology?.triangles.length).toBe(6);
  });
  it("keeps successful analysis when quota prevents writing a cache", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = memoryStore();
    vi.mocked(store.write).mockRejectedValue(new Error("QuotaExceededError"));
    const prepared = options();
    await expect(
      preparePersistentTopology(square(), prepared, store),
    ).resolves.toMatchObject({ topologyCache: "unavailable" });
    expect(prepared.topologyCache.topology?.boundaryEdges).toBe(4);
  });
  it("retains live edited topology in memory without persisting its preserved vertex identities as a fresh weld", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = memoryStore(),
      prepared = options(),
      positions = square();
    await preparePersistentTopology(positions, prepared, store);
    const topology = prepared.topologyCache.topology;
    vi.mocked(store.write).mockClear();
    vi.mocked(store.read).mockClear();
    expect(
      (await preparePersistentTopology(positions, prepared, store))
        .topologyCache,
    ).toBe("memory-hit");
    expect(prepared.topologyCache.topology).toBe(topology);
    expect(store.write).not.toHaveBeenCalled();
    expect(store.read).not.toHaveBeenCalled();
  });
  it("honors cancellation and preserves invalid mesh errors", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const { store } = memoryStore(),
      controller = new AbortController();
    controller.abort();
    await expect(
      preparePersistentTopology(
        square(),
        { ...options(), signal: controller.signal },
        store,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(store.write).not.toHaveBeenCalled();
    await expect(
      preparePersistentTopology(
        [NaN, 0, 0, 1, 0, 0, 0, 1, 0],
        options(),
        store,
      ),
    ).rejects.toThrow(/finite/);
  });
});
