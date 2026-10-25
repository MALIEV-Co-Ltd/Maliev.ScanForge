import { sha256 } from "@noble/hashes/sha2.js";
import { projectValueBytes } from "./project-value-stream";
import type { Entity, Positions } from "./types";
import { validateReferenceEntity } from "./reference-entity";

export interface GeometryDigestBuffer {
  path: string;
  encoding: "f32" | "f64" | "u32" | "u8";
  elements: number;
  rawBytes: number;
  sha256: string;
  storage: "number-array" | "array-buffer" | "shared-array-buffer";
  backingId: number;
  byteOffset?: number;
  backingBytes?: number;
  shared: boolean;
}
export interface GeometryDigest {
  entityId: string;
  units: "mm";
  buffers: GeometryDigestBuffer[];
  pointCloudMatrixBits?: string;
}
export interface GeometryDigestOptions {
  signal?: AbortSignal;
  check?: () => void;
  onProgress?: (fraction: number) => void;
}

/** Hash canonical project bytes without copying or serializing whole geometry. */
export async function digestEntityGeometry(
  entity: Entity,
  options: GeometryDigestOptions = {},
): Promise<GeometryDigest> {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Geometry digest aborted.", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Geometry digest aborted.", "AbortError");
  };
  check();
  const fields: {
    path: string;
    value: Positions | Uint32Array | Uint8Array;
    encoding: GeometryDigestBuffer["encoding"];
  }[] = [];
  const add = (
    path: string,
    value: Positions | Uint32Array | undefined,
    integer = false,
  ) => {
    if (value === undefined && path !== "positions") return;
    if (!(
      Array.isArray(value) ||
      value instanceof Float32Array ||
      (integer && value instanceof Uint32Array)
    ))
      throw new Error(`Unsupported numeric geometry carrier: ${path}.`);
    fields.push({
      path,
      value,
      encoding: integer ? "u32" : value instanceof Float32Array ? "f32" : "f64",
    });
  };
  const reference = validateReferenceEntity(entity);
  if (reference) {
    const geometry = reference.geometry;
    if (geometry.kind === "point")
      add("reference.geometry.position", [...geometry.position]);
    else {
      add("reference.geometry.start", [...geometry.start]);
      add("reference.geometry.direction", [...geometry.direction]);
      add("reference.geometry.length", [geometry.length]);
    }
  } else add("positions", entity.positions);
  add("normals", entity.normals);
  if (entity.indexedMesh) {
    add("indexedMesh.vertices", entity.indexedMesh.vertices);
    add("indexedMesh.triangles", entity.indexedMesh.triangles, true);
    add("indexedMesh.normals", entity.indexedMesh.normals);
    add("indexedMesh.geometryNormals", entity.indexedMesh.geometryNormals);
  }
  add("edgePositions", entity.edgePositions);
  add(
    "pointCloudPlacement.sourcePositions",
    entity.pointCloudPlacement?.sourcePositions,
  );
  add(
    "pointCloudPlacement.sourceNormals",
    entity.pointCloudPlacement?.sourceNormals,
  );
  if (
    entity.ascAttributes !== undefined &&
    (entity.kind !== "pointcloud" ||
      !["xyz-normal", "xyz-rgb"].includes(entity.ascAttributes))
  )
    throw new Error("Invalid ASC attribute interpretation.");
  if (entity.pointColors !== undefined) {
    if (
      entity.kind !== "pointcloud" ||
      !(entity.pointColors instanceof Uint8Array) ||
      entity.pointColors.length !== (entity.positions.length / 3) * 4
    )
      throw new Error("Invalid point-cloud RGBA colors.");
    fields.push({
      path: "pointColors",
      value: entity.pointColors,
      encoding: "u8",
    });
  }
  const total = fields.reduce(
    (sum, f) =>
      sum +
      f.value.length * (f.encoding === "u8" ? 1 : f.encoding === "f64" ? 8 : 4),
    0,
  );
  if (!Number.isSafeInteger(total))
    throw new Error("Geometry byte count exceeds the safe integer range.");
  const backings = new Map<object, number>(),
    buffers: GeometryDigestBuffer[] = [];
  let completed = 0;
  for (const field of fields) {
    check();
    const { path, value, encoding } = field,
      width = encoding === "u8" ? 1 : encoding === "f64" ? 8 : 4;
    const hash = sha256.create(),
      chunks = projectValueBytes(value, encoding, true);
    let first = 0;
    try {
      while (first < value.length) {
        check();
        const end = Math.min(value.length, first + (1024 * 1024) / width);
        for (let i = first; i < end; i++) {
          const n = value[i];
          if (typeof n !== "number" || !Number.isFinite(n))
            throw new Error(
              `Geometry must contain finite numbers: ${path}[${i}].`,
            );
          if (
            encoding === "u32" &&
            (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
          )
            throw new Error(
              `Triangle index is outside u32 range: ${path}[${i}].`,
            );
          if (encoding === "f32" && !Number.isFinite(Math.fround(n)))
            throw new Error(
              `Geometry exceeds finite f32 range: ${path}[${i}].`,
            );
          if (
            encoding === "u8" &&
            (!Number.isInteger(n) ||
              n < 0 ||
              n > 255 ||
              (i % 4 === 3 && n !== 255))
          )
            throw new Error(
              `Point-cloud colors must be opaque RGBA bytes: ${path}[${i}].`,
            );
        }
        check();
        const chunk = chunks.next();
        if (chunk.done) throw new Error("Geometry changed during digest.");
        hash.update(chunk.value);
        completed += chunk.value.byteLength;
        first = end;
        options.onProgress?.(total ? completed / total : 1);
        check();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        check();
      }
    } finally {
      chunks.return(undefined);
    }
    const typed = ArrayBuffer.isView(value),
      backing = typed ? value.buffer : value;
    let backingId = backings.get(backing);
    if (backingId === undefined) {
      backingId = backings.size;
      backings.set(backing, backingId);
    }
    const shared =
      typed &&
      typeof SharedArrayBuffer !== "undefined" &&
      backing instanceof SharedArrayBuffer;
    buffers.push({
      path,
      encoding,
      elements: value.length,
      rawBytes: value.length * width,
      sha256: Array.from(hash.digest(), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
      storage: !typed
        ? "number-array"
        : shared
          ? "shared-array-buffer"
          : "array-buffer",
      backingId,
      shared,
      ...(typed
        ? {
            byteOffset: value.byteOffset,
            backingBytes: value.buffer.byteLength,
          }
        : {}),
    });
  }
  if (total === 0) {
    options.onProgress?.(1);
    check();
  }
  check();
  return {
    entityId: entity.id,
    units: "mm",
    buffers,
    ...(entity.pointCloudPlacement
      ? { pointCloudMatrixBits: entity.pointCloudPlacement.matrixBits }
      : {}),
  };
}
