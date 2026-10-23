import { expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  projectValueBytes,
  projectValueHash,
  projectValueBlob,
  type ProjectValue,
  type ProjectValueType,
} from "../src/project-value-stream";

function canonical(value: ProjectValue, type: ProjectValueType) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  const width = type === "f64" ? 8 : 4;
  const bytes = new Uint8Array(value.length * width);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i++) {
    if (type === "u32") view.setUint32(i * width, value[i], true);
    else if (type === "f32") view.setFloat32(i * width, value[i], true);
    else view.setFloat64(i * width, value[i], true);
  }
  return bytes;
}

it.each(["f32", "f64", "u32", "text"] as const)(
  "retains canonical %s bytes and whole-value SHA across chunk boundaries",
  async (type) => {
    const special = [
      -0,
      0,
      Number.MIN_VALUE,
      2 ** -149,
      -(2 ** -126),
      1 / 3,
      4294967295,
    ];
    const count = (1024 * 1024) / (type === "f64" ? 8 : 4) + 3;
    const numbers = Array.from(
      { length: count },
      (_, i) => special[i % special.length],
    );
    const offset = new Float32Array(count + 8);
    offset.set(numbers, 4);
    const value =
      type === "text"
        ? "BREP\ud83d\ude80\ud800\u0000\u03a9"
        : type === "u32"
          ? Uint32Array.from(numbers)
          : type === "f32"
            ? offset.subarray(4, count + 4)
            : numbers;
    const expected = canonical(value, type);
    const pieces = [...projectValueBytes(value, type)];
    expect(pieces.every((p) => p.byteLength <= 1024 * 1024)).toBe(true);
    const joined = new Uint8Array(expected.length);
    let at = 0;
    for (const piece of pieces) {
      joined.set(piece, at);
      at += piece.length;
    }
    expect(Buffer.from(joined).equals(Buffer.from(expected))).toBe(true);
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", expected)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    expect(projectValueHash(value, type)).toEqual({
      sha256: digest,
      rawBytes: expected.length,
    });
    const zipped = await projectValueBlob(value, type, true);
    const restored = new Uint8Array(
      await new Response(
        zipped.stream().pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer(),
    );
    expect(Buffer.from(restored).equals(Buffer.from(expected))).toBe(true);
    expect(
      Buffer.from(
        await (await projectValueBlob(value, type)).arrayBuffer(),
      ).equals(Buffer.from(expected)),
    ).toBe(true);
    expect(
      Buffer.from(canonical(value, type)).equals(Buffer.from(expected)),
    ).toBe(true);
  },
);

it("reads shared storage without mutating it and hashes empty numeric values", async () => {
  const shared = new Float32Array(new SharedArrayBuffer(16));
  shared.set([-0, 1, -1, 2 ** -149]);
  const before = new Uint8Array(shared.buffer).slice();
  expect(projectValueHash(shared, "f32")).toEqual(
    projectValueHash(shared.slice(), "f32"),
  );
  await projectValueBlob(shared, "f32", true);
  expect(new Uint8Array(shared.buffer)).toEqual(before);
  expect(projectValueHash(new Uint32Array(), "u32")).toEqual({
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    rawBytes: 0,
  });
});

it("propagates compression failure", async () => {
  const failure = new Error("encoder stream failed");
  vi.stubGlobal(
    "CompressionStream",
    class {
      constructor() {
        throw failure;
      }
    },
  );
  try {
    await expect(
      projectValueBlob(new Float32Array(9), "f32", true),
    ).rejects.toBe(failure);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([false, true])(
  "borrows canonical typed storage for synchronous hashing (shared=%s)",
  (shared) => {
    const buffer = shared
      ? new SharedArrayBuffer(2 * 1024 * 1024 + 16)
      : new ArrayBuffer(2 * 1024 * 1024 + 16);
    const values = new Float32Array(buffer, 4, (2 * 1024 * 1024) / 4);
    values[0] = -0;
    values[values.length - 1] = 1 / 3;
    const chunks = [...projectValueBytes(values, "f32", true)];
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.buffer === buffer)).toBe(true);
    expect(chunks[0].byteOffset).toBe(4);
    expect(chunks[1].byteOffset).toBe(1024 * 1024 + 4);
    expect(projectValueHash(values, "f32")).toEqual(
      projectValueHash(values.slice(), "f32"),
    );
    // Streaming consumers still receive independent, non-shared staging buffers.
    const owned = [...projectValueBytes(values, "f32")];
    expect(
      owned.every(
        (chunk) =>
          chunk.buffer !== buffer && chunk.buffer instanceof ArrayBuffer,
      ),
    ).toBe(true);
  },
);
