import {
  parseProject,
  validateProject,
  validatePointCloudAttributes,
} from "./io";
import type { Entity, Project } from "./types";
import type { Revision } from "./history";
import { retainIndexedMesh } from "./indexed-mesh";
import { allocateImportedReadonlyBuffer } from "./import-readonly-buffer";
import {
  DISK_BLOB_BLOCK_BYTES,
  diskBackedBlob,
} from "./transient-blob-storage";
import { cloudPlacement, placedCloud } from "./point-cloud-placement";
import {
  encodeReferenceEntityData,
  decodeReferenceEntityData,
  validateReferenceEntity,
  assertReferenceCompatibleMetadata,
  type EncodedReferenceEntityData,
} from "./reference-entity";
import {
  projectValueHash,
  projectValueBlob,
  type ProjectValue,
} from "./project-value-stream";

export interface ProjectSession {
  projectId?: string;
  project: Project;
  history: Revision[];
  future: Revision[];
}

/** Internal immutable chunk backing shared across disposable restore workers. */
export interface ProjectSharedChunk {
  sha256: string;
  buffer: SharedArrayBuffer;
}
type Chunk = {
  offset: number;
  bytes: number;
  rawBytes: number;
  codec: "raw" | "gzip";
  sha256: string;
};
type Ref = { chunk: number; type: "f32" | "f64" | "u32" | "u8" | "text" };
type RecordData = Omit<
  Entity,
  | "positions"
  | "edgePositions"
  | "brep"
  | "normals"
  | "meshSelection"
  | "indexedMesh"
  | "pointCloudPlacement"
  | "pointColors"
  | "reference"
> & {
  reference?: EncodedReferenceEntityData;
  positions: Ref;
  cloudPoseBits?: string;
  edgePositions?: Ref;
  brep?: Ref;
  normals?: Ref;
  pointColors?: Ref;
  indexedMesh?: {
    vertices: Ref;
    triangles: Ref;
    normals?: Ref;
    geometryNormals?: Ref;
  };
  meshSelection?: {
    hidden: Ref;
    saved: { id: string; name: string; triangles: Ref }[];
  };
};
const magic = new TextEncoder().encode("SCANFRG2");
async function digest(bytes: Uint8Array): Promise<string> {
  // WebCrypto rejects shared buffers; the existing incremental hash borrows
  // their bytes without allocating another full decompressed chunk.
  if (!(bytes.buffer instanceof ArrayBuffer))
    return projectValueHash(bytes, "u8").sha256;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      ),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
/** Portable, lossless binary container. Identical revision payloads are stored once. */
/** Same lossless encoder used inside the bounded worker and non-browser hosts. */
export async function encodeProjectFileLocally(
  session: ProjectSession,
): Promise<Blob> {
  const chunks: Chunk[] = [],
    payloads: Blob[] = [],
    records: RecordData[] = [];
  const chunkIds = new Map<string, number>(),
    recordIds = new Map<string, number>();
  const entityCache = new Map<Entity, number>();
  const valueCache = new WeakMap<object, Ref>();
  let pendingPayloads: Blob[] = [];
  let pendingBytes = 0;
  let offset = 0;
  let deferredClouds = false;
  let cloudAttributes = false;
  let constructionMetadata = false;
  async function store(value: ProjectValue, integer = false): Promise<Ref> {
    const type =
      typeof value === "string"
        ? "text"
        : integer
          ? "u32"
          : value instanceof Uint8Array
            ? "u8"
            : value instanceof Float32Array
              ? "f32"
              : "f64";
    if (typeof value !== "string") {
      const cached = valueCache.get(value);
      if (cached?.type === type) return cached;
    }
    const { sha256, rawBytes } = projectValueHash(value, type);
    let chunk = chunkIds.get(sha256);
    if (chunk === undefined) {
      const zipped = await projectValueBlob(value, type, true),
        smaller = zipped.size < rawBytes;
      const data = smaller ? zipped : await projectValueBlob(value, type);
      chunk = chunks.length;
      chunks.push({
        offset,
        bytes: data.size,
        rawBytes,
        codec: smaller ? "gzip" : "raw",
        sha256,
      });
      pendingPayloads.push(data);
      pendingBytes += data.size;
      // Release completed payloads before encoding the rest of a large history.
      if (pendingBytes >= DISK_BLOB_BLOCK_BYTES) {
        payloads.push(await diskBackedBlob(new Blob(pendingPayloads)));
        pendingPayloads = [];
        pendingBytes = 0;
      }
      offset += data.size;
      chunkIds.set(sha256, chunk);
    }
    const ref: Ref = { chunk, type };
    if (typeof value !== "string") valueCache.set(value, ref);
    return ref;
  }
  async function state(entities: Entity[]): Promise<number[]> {
    for (const entity of entities) validateReferenceEntity(entity);
    entities = entities.map(retainIndexedMesh);
    validateProject({ ...session.project, entities });
    const ids: number[] = [];
    for (const entity of entities) {
      let id = entityCache.get(entity);
      if (id === undefined) {
        const {
          kernelId: _kernel,
          fit: _fit,
          positions,
          edgePositions,
          brep,
          normals,
          pointColors,
          meshSelection,
          indexedMesh,
          pointCloudPlacement: _placement,
          reference,
          ...metadata
        } = entity;
        const selection: RecordData["meshSelection"] = meshSelection
          ? {
              hidden: await store(meshSelection.hidden, true),
              saved: [],
            }
          : undefined;
        if (selection && meshSelection)
          for (const saved of meshSelection.saved) {
            selection.saved.push({
              id: saved.id,
              name: saved.name,
              triangles: await store(saved.triangles, true),
            });
          }
        const placement = cloudPlacement(entity);
        if (placement) deferredClouds = true;
        if (pointColors !== undefined || entity.ascAttributes !== undefined)
          cloudAttributes = true;
        if (
          reference !== undefined ||
          entity.constructionOrderKey !== undefined
        )
          constructionMetadata = true;
        const record: RecordData = {
          ...metadata,
          ...(reference !== undefined
            ? { reference: encodeReferenceEntityData(reference) }
            : {}),
          positions: await store(placement?.sourcePositions ?? positions),
          ...(placement ? { cloudPoseBits: placement.matrixBits } : {}),
          ...(pointColors !== undefined
            ? {
                pointColors: await store(validatePointCloudAttributes(entity)!),
              }
            : {}),
          ...(edgePositions
            ? { edgePositions: await store(edgePositions) }
            : {}),
          ...(brep !== undefined ? { brep: await store(brep) } : {}),
          ...((placement ? placement.sourceNormals : normals)
            ? {
                normals: await store(
                  (placement ? placement.sourceNormals : normals)!,
                ),
              }
            : {}),
          ...(selection ? { meshSelection: selection } : {}),
          ...(indexedMesh
            ? {
                indexedMesh: {
                  vertices: await store(indexedMesh.vertices),
                  triangles: await store(indexedMesh.triangles, true),
                  ...(indexedMesh.normals
                    ? { normals: await store(indexedMesh.normals) }
                    : {}),
                  ...(indexedMesh.geometryNormals
                    ? {
                        geometryNormals: await store(
                          indexedMesh.geometryNormals,
                        ),
                      }
                    : {}),
                },
              }
            : {}),
        };
        const key = JSON.stringify(record);
        id = recordIds.get(key);
        if (id === undefined) {
          id = records.length;
          records.push(record);
          recordIds.set(key, id);
        }
        entityCache.set(entity, id);
      }
      ids.push(id);
    }
    return ids;
  }
  async function revisions(items: Revision[]) {
    return Promise.all(
      items.map(async (item) => ({
        label: item.label,
        ...(item.restoreVisibilityFor?.length
          ? { restoreVisibilityFor: item.restoreVisibilityFor }
          : {}),
        entities: await state(item.entities),
      })),
    );
  }
  // Serialize sequentially: chunk offsets and identity tables belong to this writer.
  const current = await state(session.project.entities);
  const history = [];
  for (const item of session.history)
    history.push(...(await revisions([item])));
  const future = [];
  for (const item of session.future) future.push(...(await revisions([item])));
  const manifest = new TextEncoder().encode(
    JSON.stringify(
      {
        format: "scanforge-binary",
        version: constructionMetadata
          ? 5
          : cloudAttributes
            ? 4
            : deferredClouds
              ? 3
              : 2,
        name: session.project.name,
        projectId: session.projectId,
        units: "mm",
        authoring: session.project.authoring,
        current,
        history,
        future,
        records,
        chunks,
      },
      null,
      2,
    ),
  );
  if (manifest.length > 0xffffffff || offset > 0xffffffff)
    throw new Error("Project exceeds the v2 container address range.");
  const header = new Uint8Array(16);
  header.set(magic);
  const view = new DataView(header.buffer);
  view.setUint32(8, manifest.length, true);
  view.setUint32(12, offset, true);
  return new Blob([header, manifest, ...payloads, ...pendingPayloads], {
    type: "application/x-scanforge",
  });
}

export async function decodeProjectContents(
  file: Blob,
  options: {
    sharedReadonlyBuffers?: boolean;
    reusableChunks?: readonly ProjectSharedChunk[];
    onSharedChunk?: (chunk: ProjectSharedChunk) => void;
  } = {},
): Promise<ProjectSession> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!magic.every((byte, i) => header[i] === byte))
    return {
      project: parseProject(await file.text()),
      history: [],
      future: [],
    };
  const invalid = () => {
    throw new Error("Invalid or damaged ScanForge project file.");
  };
  if (header.length !== 16) return invalid();
  const view = new DataView(header.buffer),
    length = view.getUint32(8, true),
    total = view.getUint32(12, true);
  if (16 + length + total !== file.size) return invalid();
  const m = JSON.parse(await file.slice(16, 16 + length).text());
  if (
    m.format !== "scanforge-binary" ||
    ![2, 3, 4, 5].includes(m.version) ||
    m.units !== "mm" ||
    !Array.isArray(m.chunks) ||
    !Array.isArray(m.records) ||
    !Array.isArray(m.current) ||
    !Array.isArray(m.history) ||
    !Array.isArray(m.future)
  )
    return invalid();
  const data: Uint8Array[] = [];
  const reusable = new Map<string, SharedArrayBuffer>();
  if (
    options.sharedReadonlyBuffers &&
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== "undefined"
  )
    for (const chunk of options.reusableChunks ?? [])
      if (
        chunk?.buffer instanceof SharedArrayBuffer &&
        /^[a-f0-9]{64}$/.test(chunk.sha256)
      )
        reusable.set(
          `${chunk.sha256}:${chunk.buffer.byteLength}`,
          chunk.buffer,
        );
  let expected = 0;
  for (const chunk of m.chunks as Chunk[]) {
    if (
      !chunk ||
      chunk.offset !== expected ||
      !Number.isSafeInteger(chunk.bytes) ||
      chunk.bytes < 0 ||
      !Number.isSafeInteger(chunk.rawBytes) ||
      chunk.rawBytes < 0 ||
      chunk.offset + chunk.bytes > total ||
      !["raw", "gzip"].includes(chunk.codec) ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256)
    )
      return invalid();
    const stored = file.slice(
      16 + length + chunk.offset,
      16 + length + chunk.offset + chunk.bytes,
    );
    // Bound decompression by its declared length, rather than allocating an unbounded response.
    const reader = (
      chunk.codec === "gzip"
        ? stored.stream().pipeThrough(new DecompressionStream("gzip"))
        : stored.stream()
    ).getReader();
    // Decompress into the final readonly backing. Keeping private chunks and
    // later copying all geometry into shared buffers doubles restore storage.
    const existing = reusable.get(`${chunk.sha256}:${chunk.rawBytes}`);
    let borrowed = existing !== undefined;
    let bytes = new Uint8Array(
      existing ??
        allocateImportedReadonlyBuffer(
          chunk.rawBytes,
          options.sharedReadonlyBuffers,
        ),
    );
    let used = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (used + next.value.length > bytes.length) return invalid();
        // Still consume and verify the incoming file. Never write into a live
        // consumer's backing; a mismatch gets an independent replacement.
        if (borrowed)
          for (let i = 0; i < next.value.length; i++)
            if (bytes[used + i] !== next.value[i]) {
              const replacement = new Uint8Array(
                allocateImportedReadonlyBuffer(
                  chunk.rawBytes,
                  options.sharedReadonlyBuffers,
                ),
              );
              replacement.set(bytes.subarray(0, used));
              bytes = replacement;
              borrowed = false;
              break;
            }
        if (!borrowed) bytes.set(next.value, used);
        used += next.value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (used !== bytes.length || (await digest(bytes)) !== chunk.sha256)
      return invalid();
    if (
      typeof SharedArrayBuffer !== "undefined" &&
      bytes.buffer instanceof SharedArrayBuffer
    )
      options.onSharedChunk?.({ sha256: chunk.sha256, buffer: bytes.buffer });
    data.push(bytes);
    expected += chunk.bytes;
  }
  if (expected !== total) return invalid();
  const decoded = new Map<string, ProjectValue>();
  function read(ref: Ref, typedIndices = false): ProjectValue {
    if (
      !ref ||
      !Number.isInteger(ref.chunk) ||
      !data[ref.chunk] ||
      ![
        "f32",
        "f64",
        "u32",
        "text",
        ...([4, 5].includes(m.version) ? ["u8"] : []),
      ].includes(ref.type)
    )
      return invalid();
    // Selection lists can share a chunk with topology, but retain array semantics.
    const unsignedTopology = typedIndices && ref.type === "u32";
    const key = `${ref.chunk}:${ref.type}:${unsignedTopology ? "indices" : ""}`,
      cached = decoded.get(key);
    if (cached !== undefined) return cached;
    const bytes = data[ref.chunk];
    let result: ProjectValue;
    if (ref.type === "text")
      result = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else if (ref.type === "u8") result = bytes;
    else {
      const width = ref.type === "f64" ? 8 : 4;
      if (bytes.length % width) return invalid();
      // Decoded chunks own their bytes. Keep typed geometry views rather than
      // widening topology and repacking it into Float64 transport staging.
      if (
        (ref.type === "f32" || unsignedTopology) &&
        bytes.byteOffset % width === 0 &&
        new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
      ) {
        result = unsignedTopology
          ? new Uint32Array(
              bytes.buffer,
              bytes.byteOffset,
              bytes.length / width,
            )
          : new Float32Array(
              bytes.buffer,
              bytes.byteOffset,
              bytes.length / width,
            );
        decoded.set(key, result);
        return result;
      }
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const values =
        ref.type === "f32"
          ? new Float32Array(
              allocateImportedReadonlyBuffer(
                bytes.length,
                options.sharedReadonlyBuffers,
              ),
            )
          : unsignedTopology
            ? new Uint32Array(
                allocateImportedReadonlyBuffer(
                  bytes.length,
                  options.sharedReadonlyBuffers,
                ),
              )
            : new Array<number>(bytes.length / width);
      for (let i = 0; i < values.length; i++)
        values[i] =
          ref.type === "u32"
            ? v.getUint32(i * width, true)
            : width === 4
              ? v.getFloat32(i * width, true)
              : v.getFloat64(i * width, true);
      result = values;
    }
    decoded.set(key, result);
    return result;
  }
  const entities = (m.records as RecordData[]).map((record) => {
    if (!record || typeof record !== "object") return invalid();
    assertReferenceCompatibleMetadata(record);
    if (
      (record.pointColors !== undefined ||
        record.ascAttributes !== undefined) &&
      ![4, 5].includes(m.version)
    )
      return invalid();
    if (record.pointColors !== undefined && record.pointColors.type !== "u8")
      return invalid();
    if (
      (record.reference !== undefined ||
        record.constructionOrderKey !== undefined) &&
      m.version !== 5
    )
      return invalid();
    const entity = {
      ...record,
      ...(record.reference !== undefined
        ? { reference: decodeReferenceEntityData(record.reference) }
        : {}),
      positions: read(record.positions),
      indexedMesh: record.indexedMesh
        ? {
            vertices: read(record.indexedMesh.vertices),
            triangles: read(record.indexedMesh.triangles, true),
            ...(record.indexedMesh.normals
              ? { normals: read(record.indexedMesh.normals) }
              : {}),
            ...(record.indexedMesh.geometryNormals
              ? { geometryNormals: read(record.indexedMesh.geometryNormals) }
              : {}),
          }
        : undefined,
      edgePositions: record.edgePositions
        ? read(record.edgePositions)
        : undefined,
      brep: record.brep ? read(record.brep) : undefined,
      normals: record.normals ? read(record.normals) : undefined,
      ...(record.pointColors !== undefined
        ? { pointColors: read(record.pointColors) }
        : {}),
      meshSelection: record.meshSelection
        ? {
            hidden: read(record.meshSelection.hidden),
            saved: record.meshSelection.saved.map((saved) => ({
              id: saved.id,
              name: saved.name,
              triangles: read(saved.triangles),
            })),
          }
        : undefined,
    } as Entity;
    if (record.cloudPoseBits !== undefined) {
      if (![3, 4, 5].includes(m.version) || entity.kind !== "pointcloud")
        return invalid();
      return placedCloud(entity, {
        matrixBits: record.cloudPoseBits,
        sourcePositions: entity.positions,
        sourceNormals: entity.normals,
      });
    }
    return entity;
  });
  function state(refs: number[]): Entity[] {
    if (
      !Array.isArray(refs) ||
      refs.some((i) => !Number.isInteger(i) || i < 0 || i >= entities.length)
    )
      return invalid();
    return validateProject({
      format: "maliev-scanforge",
      version: 1,
      units: "mm",
      name: m.name,
      entities: refs.map((i) => entities[i]),
    }).entities;
  }
  function revisions(
    items: {
      label: string;
      entities: number[];
      restoreVisibilityFor?: string[];
    }[],
  ): Revision[] {
    return items.map((item) => {
      if (!item || typeof item.label !== "string") return invalid();
      const ids = item.restoreVisibilityFor;
      if (
        ids !== undefined &&
        (!Array.isArray(ids) ||
          ids.length > 100000 ||
          ids.some(
            (id) => typeof id !== "string" || !id.length || id.length > 1024,
          ) ||
          new Set(ids).size !== ids.length)
      )
        return invalid();
      return {
        label: item.label,
        entities: state(item.entities),
        ...(ids?.length ? { restoreVisibilityFor: [...ids] } : {}),
      };
    });
  }
  const project = validateProject({
    format: "maliev-scanforge",
    version: 1,
    units: "mm",
    name: m.name,
    authoring: m.authoring,
    entities: state(m.current),
  });
  return {
    ...(typeof m.projectId === "string" &&
    /^[a-zA-Z0-9-]{1,128}$/.test(m.projectId)
      ? { projectId: m.projectId }
      : {}),
    project,
    history: revisions(m.history),
    future: revisions(m.future),
  };
}
