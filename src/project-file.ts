import { parseProject, validateProject } from "./io";
import type { Entity, Project } from "./types";
import type { Revision } from "./history";
import { retainIndexedMesh } from "./indexed-mesh";

export interface ProjectSession {
  projectId?: string;
  project: Project;
  history: Revision[];
  future: Revision[];
}
type Chunk = {
  offset: number;
  bytes: number;
  rawBytes: number;
  codec: "raw" | "gzip";
  sha256: string;
};
type Ref = { chunk: number; type: "f32" | "f64" | "u32" | "text" };
type RecordData = Omit<
  Entity,
  | "positions"
  | "edgePositions"
  | "brep"
  | "normals"
  | "meshSelection"
  | "indexedMesh"
> & {
  positions: Ref;
  edgePositions?: Ref;
  brep?: Ref;
  normals?: Ref;
  indexedMesh?: { vertices: Ref; triangles: Ref };
  meshSelection?: {
    hidden: Ref;
    saved: { id: string; name: string; triangles: Ref }[];
  };
};
const magic = new TextEncoder().encode("SCANFRG2");
async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
async function compress(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}
/** Portable, lossless binary container. Identical revision payloads are stored once. */
export async function encodeProjectFile(
  session: ProjectSession,
): Promise<Blob> {
  const chunks: Chunk[] = [],
    payloads: Uint8Array<ArrayBuffer>[] = [],
    records: RecordData[] = [];
  const chunkIds = new Map<string, number>(),
    recordIds = new Map<string, number>();
  const entityCache = new Map<Entity, number>();
  const valueCache = new WeakMap<object, Ref>();
  let offset = 0;
  async function store(
    value: Entity["positions"] | Uint32Array | string,
    integer = false,
  ): Promise<Ref> {
    const type =
      typeof value === "string"
        ? "text"
        : integer
          ? "u32"
          : value instanceof Float32Array
            ? "f32"
            : "f64";
    if (typeof value !== "string") {
      const cached = valueCache.get(value);
      if (cached?.type === type) return cached;
    }
    let bytes: Uint8Array<ArrayBuffer>;
    if (typeof value === "string") bytes = new TextEncoder().encode(value);
    else {
      const width = type === "f64" ? 8 : 4;
      bytes = new Uint8Array(value.length * width);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < value.length; i++) {
        if (integer) view.setUint32(i * width, value[i], true);
        else if (width === 4) view.setFloat32(i * width, value[i], true);
        else view.setFloat64(i * width, value[i], true);
      }
    }
    const sha256 = await digest(bytes);
    let chunk = chunkIds.get(sha256);
    if (chunk === undefined) {
      const zipped = await compress(bytes),
        smaller = zipped.length < bytes.length;
      const data = smaller ? zipped : bytes;
      chunk = chunks.length;
      chunks.push({
        offset,
        bytes: data.length,
        rawBytes: bytes.length,
        codec: smaller ? "gzip" : "raw",
        sha256,
      });
      payloads.push(data);
      offset += data.length;
      chunkIds.set(sha256, chunk);
    }
    const ref: Ref = { chunk, type };
    if (typeof value !== "string") valueCache.set(value, ref);
    return ref;
  }
  async function state(entities: Entity[]): Promise<number[]> {
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
          meshSelection,
          indexedMesh,
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
        const record: RecordData = {
          ...metadata,
          positions: await store(positions),
          ...(edgePositions
            ? { edgePositions: await store(edgePositions) }
            : {}),
          ...(brep !== undefined ? { brep: await store(brep) } : {}),
          ...(normals ? { normals: await store(normals) } : {}),
          ...(selection ? { meshSelection: selection } : {}),
          ...(indexedMesh
            ? {
                indexedMesh: {
                  vertices: await store(indexedMesh.vertices),
                  triangles: await store(indexedMesh.triangles, true),
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
        version: 2,
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
  return new Blob([header, manifest, ...payloads], {
    type: "application/x-scanforge",
  });
}

export async function decodeProjectFile(file: Blob): Promise<ProjectSession> {
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
    m.version !== 2 ||
    m.units !== "mm" ||
    !Array.isArray(m.chunks) ||
    !Array.isArray(m.records) ||
    !Array.isArray(m.current) ||
    !Array.isArray(m.history) ||
    !Array.isArray(m.future)
  )
    return invalid();
  const data: Uint8Array<ArrayBuffer>[] = [];
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
    const bytes = new Uint8Array(chunk.rawBytes);
    let used = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        if (used + next.value.length > bytes.length) return invalid();
        bytes.set(next.value, used);
        used += next.value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (used !== bytes.length || (await digest(bytes)) !== chunk.sha256)
      return invalid();
    data.push(bytes);
    expected += chunk.bytes;
  }
  if (expected !== total) return invalid();
  const decoded = new Map<string, string | number[] | Float32Array>();
  function read(ref: Ref): string | number[] | Float32Array {
    if (
      !ref ||
      !Number.isInteger(ref.chunk) ||
      !data[ref.chunk] ||
      !["f32", "f64", "u32", "text"].includes(ref.type)
    )
      return invalid();
    const key = `${ref.chunk}:${ref.type}`,
      cached = decoded.get(key);
    if (cached !== undefined) return cached;
    const bytes = data[ref.chunk];
    let result: string | number[] | Float32Array;
    if (ref.type === "text")
      result = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    else {
      const width = ref.type === "f64" ? 8 : 4;
      if (bytes.length % width) return invalid();
      const v = new DataView(bytes.buffer);
      const values =
        ref.type === "f32"
          ? new Float32Array(bytes.length / width)
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
    return {
      ...record,
      positions: read(record.positions),
      indexedMesh: record.indexedMesh
        ? {
            vertices: read(record.indexedMesh.vertices),
            triangles: read(record.indexedMesh.triangles),
          }
        : undefined,
      edgePositions: record.edgePositions
        ? read(record.edgePositions)
        : undefined,
      brep: record.brep ? read(record.brep) : undefined,
      normals: record.normals ? read(record.normals) : undefined,
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
    items: { label: string; entities: number[] }[],
  ): Revision[] {
    return items.map((item) => {
      if (!item || typeof item.label !== "string") return invalid();
      return { label: item.label, entities: state(item.entities) };
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
