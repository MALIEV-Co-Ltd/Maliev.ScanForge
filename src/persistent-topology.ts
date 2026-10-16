import type { Positions } from "./types";
import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import {
  packTopology,
  unpackTopology,
  packedTopologyBytes,
  estimatedPackedTopologyBytes,
  type PackedTopology,
} from "./topology-cache-codec";
import {
  readTopologyRecord,
  writeTopologyRecord,
  deleteTopologyRecord,
  type TopologyCacheRecord,
} from "./topology-cache-store";

// Bump when welding, adjacency, diagnostics, boundary ordering, or packing changes.
const VERSION = "scanforge-topology-v1";
const CHUNK_BYTES = 256 * 1024;
const MAX_RECORD_BYTES = 128 * 1024 * 1024;
export interface TopologyRecordStore {
  read(key: string): Promise<TopologyCacheRecord | undefined>;
  write(record: TopologyCacheRecord): Promise<boolean>;
  remove(key: string): Promise<void>;
}
const storage: TopologyRecordStore = {
  read: readTopologyRecord,
  write: writeTopologyRecord,
  remove: deleteTopologyRecord,
};
type PreparationOptions = MeshProcessingOptions & {
  topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]>;
};
export interface PersistentTopologyDiagnostics {
  topologyCache:
    "memory-hit" | "persistent-hit" | "stored" | "unavailable" | "oversize";
  topologyCacheBytes?: number;
}
function checkpoint(options: MeshProcessingOptions, stage: string) {
  options.signal?.throwIfAborted();
  options.onProgress?.(0, stage);
  options.signal?.throwIfAborted();
}
async function digest(data: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
async function finishDigest(
  metadata: string,
  hashes: Uint8Array[],
): Promise<string> {
  const header = new TextEncoder().encode(metadata);
  const root = new Uint8Array(header.length + hashes.length * 32);
  root.set(header);
  hashes.forEach((hash, i) => root.set(hash, header.length + i * 32));
  return hex(await digest(root.buffer));
}

/** Canonical ordered Float64 values make equivalent STL/project arrays share a key.
 * Fixed-size SHA-256 leaves avoid copying a whole multi-million-facet mesh. */
export async function meshTopologyCacheKey(
  positions: Positions,
  tolerance: number,
  options: MeshProcessingOptions = {},
): Promise<string | undefined> {
  if (
    !globalThis.crypto?.subtle ||
    !positions.length ||
    positions.length % 9 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    return;
  const hashes: Uint8Array[] = [];
  for (let offset = 0; offset < positions.length; offset += CHUNK_BYTES / 8) {
    checkpoint(options, "Checking saved mesh topology");
    const count = Math.min(CHUNK_BYTES / 8, positions.length - offset);
    const chunk = new ArrayBuffer(count * 8),
      view = new DataView(chunk);
    for (let i = 0; i < count; i++) {
      const value = positions[offset + i];
      if (!Number.isFinite(value)) return;
      view.setFloat64(i * 8, value, true);
    }
    hashes.push(await digest(chunk));
  }
  options.signal?.throwIfAborted();
  return `${VERSION}:${await finishDigest(`${VERSION}:${positions.length}:${tolerance}:float64-le:${CHUNK_BYTES}:`, hashes)}`;
}
async function payloadChecksum(
  payload: PackedTopology,
  options: MeshProcessingOptions,
): Promise<string> {
  const hashes: Uint8Array[] = [];
  for (const buffer of payload.buffers) {
    for (let offset = 0; offset < buffer.byteLength; offset += CHUNK_BYTES) {
      checkpoint(options, "Verifying saved mesh topology");
      hashes.push(
        await digest(
          buffer.slice(
            offset,
            Math.min(offset + CHUNK_BYTES, buffer.byteLength),
          ),
        ),
      );
    }
  }
  options.signal?.throwIfAborted();
  return finishDigest(
    `${VERSION}:payload:${payload.format}:${payload.buffers.map((buffer) => buffer.byteLength).join(",")}:`,
    hashes,
  );
}
function boundedPayload(value: unknown): value is PackedTopology {
  if (!value || typeof value !== "object") return false;
  const payload = value as PackedTopology;
  return (
    payload.format === 1 &&
    Array.isArray(payload.buffers) &&
    payload.buffers.length === 14 &&
    payload.buffers.every((buffer) => buffer instanceof ArrayBuffer) &&
    packedTopologyBytes(payload) <= MAX_RECORD_BYTES
  );
}

/** Restore or build the canonical topology before any edit can mutate its index.
 * The cache is optional: storage errors never turn a valid mesh into a failed job. */
export async function preparePersistentTopology(
  positions: Positions,
  options: PreparationOptions,
  store: TopologyRecordStore = storage,
): Promise<PersistentTopologyDiagnostics> {
  options.signal?.throwIfAborted();
  const tolerance = options.tolerance ?? 1e-6,
    cache = options.topologyCache;
  if (
    cache.positions === positions &&
    cache.tolerance === tolerance &&
    cache.topology
  )
    return { topologyCache: "memory-hit" };
  let key: string | undefined;
  try {
    key = await meshTopologyCacheKey(positions, tolerance, options);
    if (key) {
      const saved = await store.read(key);
      options.signal?.throwIfAborted();
      if (saved) {
        const payload = saved.payload;
        if (
          saved.key === key &&
          saved.sourceLength === positions.length &&
          saved.tolerance === tolerance &&
          boundedPayload(payload) &&
          saved.bytes === packedTopologyBytes(payload) &&
          saved.checksum === (await payloadChecksum(payload, options))
        ) {
          const topology = unpackTopology(payload, positions.length);
          if (topology) {
            checkpoint(options, "Restoring saved mesh topology");
            cache.positions = positions;
            cache.tolerance = tolerance;
            cache.topology = topology;
            return {
              topologyCache: "persistent-hit",
              topologyCacheBytes: saved.bytes,
            };
          }
        }
        await store.remove(key);
      }
    }
  } catch {
    options.signal?.throwIfAborted();
    // A cache failure must not hide errors from normal mesh analysis below.
  }
  options.signal?.throwIfAborted();
  const topology = analyzeMesh(positions, options);
  if (!key) return { topologyCache: "unavailable" };
  try {
    if (estimatedPackedTopologyBytes(topology) > MAX_RECORD_BYTES)
      return { topologyCache: "oversize" };
    checkpoint(options, "Saving mesh topology cache");
    const payload = packTopology(topology),
      bytes = packedTopologyBytes(payload);
    if (bytes > MAX_RECORD_BYTES) return { topologyCache: "oversize" };
    const checksum = await payloadChecksum(payload, options);
    options.signal?.throwIfAborted();
    const written = await store.write({
      key,
      sourceLength: positions.length,
      tolerance,
      payload,
      checksum,
      bytes,
      createdAt: Date.now(),
    });
    options.signal?.throwIfAborted();
    return written
      ? { topologyCache: "stored", topologyCacheBytes: bytes }
      : { topologyCache: "unavailable" };
  } catch {
    options.signal?.throwIfAborted();
    return { topologyCache: "unavailable" };
  }
}
