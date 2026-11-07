import type { ProjectEncodingSnapshot } from "./project-encoding-snapshot";
import type { ProjectSharedChunk } from "./project-file-codec";

export interface ProjectEncodingChunkToken {
  sourceToken: number;
  sha256: string;
}

/** Operation-local original wrappers; worker cloning must not become their owner. */
export function projectEncodingChunkSources(
  snapshot: ProjectEncodingSnapshot,
): SharedArrayBuffer[] {
  const sources: SharedArrayBuffer[] = [],
    seen = new Set<SharedArrayBuffer>();
  const add = (value: unknown) => {
    if (
      sources.length === 128 ||
      typeof SharedArrayBuffer === "undefined" ||
      !(
        value instanceof Float32Array ||
        value instanceof Uint32Array ||
        value instanceof Uint8Array
      ) ||
      !(value.buffer instanceof SharedArrayBuffer) ||
      value.byteOffset !== 0 ||
      value.byteLength !== value.buffer.byteLength ||
      seen.has(value.buffer)
    )
      return;
    seen.add(value.buffer);
    sources.push(value.buffer);
  };
  const states = [
    snapshot.session.project,
    ...snapshot.session.history,
    ...snapshot.session.future,
  ];
  for (const { entities } of states)
    for (const entity of entities) {
      add(entity.positions);
      add(entity.normals);
      add(entity.pointColors);
      const mesh = entity.indexedMesh;
      if (mesh) {
        add(mesh.vertices);
        add(mesh.triangles);
        add(mesh.normals);
        add(mesh.geometryNormals);
        add(mesh.facetNormals);
      }
      if (entity.meshSelection) {
        add(entity.meshSelection.hidden);
        for (const saved of entity.meshSelection.saved) add(saved.triangles);
      }
      if (sources.length === 128) return sources;
    }
  return sources;
}

export function validateEncodingChunkSources(
  value: unknown,
): SharedArrayBuffer[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128)
    throw Error("Invalid project encoding chunk sources.");
  const seen = new Set<SharedArrayBuffer>();
  for (const buffer of value) {
    if (
      typeof SharedArrayBuffer === "undefined" ||
      !(buffer instanceof SharedArrayBuffer) ||
      seen.has(buffer)
    )
      throw Error("Invalid project encoding chunk source.");
    seen.add(buffer);
  }
  return value;
}

/** Validate the complete reply before any cache publication or file storage. */
export function resolveEncodingChunkTokens(
  value: unknown,
  sources: readonly SharedArrayBuffer[],
): ProjectSharedChunk[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128)
    throw Error("Invalid project encoding chunk tokens.");
  const result: ProjectSharedChunk[] = [],
    seen = new Set<number>();
  for (const token of value) {
    if (
      !token ||
      !Number.isSafeInteger(token.sourceToken) ||
      token.sourceToken < 0 ||
      token.sourceToken >= sources.length ||
      seen.has(token.sourceToken) ||
      typeof token.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(token.sha256)
    )
      throw Error("Invalid project encoding chunk token.");
    seen.add(token.sourceToken);
    result.push({ sha256: token.sha256, buffer: sources[token.sourceToken] });
  }
  return result;
}
