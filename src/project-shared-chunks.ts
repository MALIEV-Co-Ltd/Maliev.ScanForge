import type { ProjectSharedChunk } from "./project-file-codec";
import type { ProjectValue, ProjectValueType } from "./project-value-stream";

// Closed projects are never retained merely to accelerate a later restore.
const chunks = new Map<string, WeakRef<SharedArrayBuffer>>();
globalThis.addEventListener?.("pagehide", () => chunks.clear());

export function validateProjectSharedChunks(
  value: unknown,
): ProjectSharedChunk[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid project shared chunks.");
  for (const chunk of value)
    if (
      typeof SharedArrayBuffer === "undefined" ||
      !(chunk?.buffer instanceof SharedArrayBuffer) ||
      typeof chunk.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(chunk.sha256)
    )
      throw new Error("Invalid project shared chunks.");
  return value;
}

export function rememberProjectSharedChunks(
  values: readonly ProjectSharedChunk[],
) {
  if (typeof WeakRef === "undefined") return;
  for (const { sha256, buffer } of values) {
    const key = `${sha256}:${buffer.byteLength}`;
    chunks.delete(key);
    chunks.set(key, new WeakRef(buffer));
    if (chunks.size > 128) chunks.delete(chunks.keys().next().value!);
  }
}

export function reusableProjectSharedChunks(): ProjectSharedChunk[] {
  const result: ProjectSharedChunk[] = [];
  for (const [key, reference] of chunks) {
    const buffer = reference.deref();
    if (buffer) result.push({ sha256: key.slice(0, 64), buffer });
    else chunks.delete(key);
  }
  return result;
}

/** The hash must describe the complete backing's canonical binary bytes. */
export function encodedProjectSharedChunk(
  value: ProjectValue,
  type: ProjectValueType,
  hash: { sha256: string; rawBytes: number },
): ProjectSharedChunk | undefined {
  if (
    typeof SharedArrayBuffer === "undefined" ||
    !ArrayBuffer.isView(value) ||
    !(value.buffer instanceof SharedArrayBuffer) ||
    value.byteOffset !== 0 ||
    value.byteLength !== value.buffer.byteLength ||
    value.byteLength !== hash.rawBytes ||
    new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1 ||
    !(
      (type === "f32" &&
        value instanceof Float32Array &&
        value.every(Number.isFinite)) ||
      (type === "u32" && value instanceof Uint32Array) ||
      (type === "u8" && value instanceof Uint8Array)
    )
  )
    return undefined;
  return { sha256: hash.sha256, buffer: value.buffer };
}
