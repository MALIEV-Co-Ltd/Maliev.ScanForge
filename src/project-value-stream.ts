import { sha256 } from "@noble/hashes/sha2.js";
import type { Positions } from "./types";

export type ProjectValue = Positions | Uint32Array | Uint8Array | string;
export type ProjectValueType = "f32" | "f64" | "u32" | "u8" | "text";
const STAGING_BYTES = 1024 * 1024;

/** Keep the existing canonical little-endian representation, including signed zero. */
export function* projectValueBytes(
  value: ProjectValue,
  type: ProjectValueType,
): Generator<Uint8Array<ArrayBuffer>> {
  if (typeof value === "string") {
    // BRep text keeps its existing UTF-8 treatment; only numeric staging is bounded.
    yield new TextEncoder().encode(value);
    return;
  }
  const width = type === "u8" ? 1 : type === "f64" ? 8 : 4;
  const perChunk = STAGING_BYTES / width;
  for (let first = 0; first < value.length; first += perChunk) {
    const count = Math.min(perChunk, value.length - first);
    const bytes = new Uint8Array(count * width);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) {
      if (type === "u8") {
        const n = value[first + i];
        if (!Number.isInteger(n) || n < 0 || n > 255)
          throw new Error("Invalid project byte value.");
        view.setUint8(i, n);
      } else if (type === "u32")
        view.setUint32(i * width, value[first + i], true);
      else if (type === "f32")
        view.setFloat32(i * width, value[first + i], true);
      else view.setFloat64(i * width, value[first + i], true);
    }
    yield bytes;
  }
}

export function projectValueHash(value: ProjectValue, type: ProjectValueType) {
  const hash = sha256.create();
  let rawBytes = 0;
  for (const bytes of projectValueBytes(value, type)) {
    hash.update(bytes);
    rawBytes += bytes.length;
  }
  return {
    sha256: Array.from(hash.digest(), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    rawBytes,
  };
}

/** A pull-driven stream never queues the complete numeric value for compression. */
export async function projectValueBlob(
  value: ProjectValue,
  type: ProjectValueType,
  gzip = false,
): Promise<Blob> {
  const chunks = projectValueBytes(value, type);
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(controller) {
      const next = chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel() {
      chunks.return(undefined);
    },
  });
  return new Response(
    gzip ? stream.pipeThrough(new CompressionStream("gzip")) : stream,
  ).blob();
}
