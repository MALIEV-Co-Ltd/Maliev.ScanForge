import { expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  projectValueBytes,
  projectValueHash,
  projectValueBlob,
  type ProjectValue,
  type ProjectValueType,
} from "../src/project-value-stream";

it("borrows finite private Float64 bytes for synchronous hashes", () => {
  const backing = new ArrayBuffer(40);
  const values = new Float64Array(backing, 8, 3);
  values.set([0.1, -0, 2.5]);
  const input = values as unknown as ProjectValue;
  const chunks = [...projectValueBytes(input, "f64", true)];
  expect(chunks).toHaveLength(1);
  expect(chunks[0].buffer).toBe(backing);
  expect(chunks[0].byteOffset).toBe(8);
  expect(chunks[0]).toEqual(canonical([0.1, -0, 2.5], "f64"));
  expect(projectValueHash(input, "f64")).toEqual(
    projectValueHash([0.1, -0, 2.5], "f64"),
  );
  expect([...projectValueBytes(input, "f64")][0].buffer).not.toBe(backing);
});

it("keeps Float64 shared and nonfinite input on the canonical staging path", () => {
  const shared = new Float64Array(new SharedArrayBuffer(24));
  shared.set([0.1, -0, 2.5]);
  const sharedChunk = [...projectValueBytes(shared, "f64", true)][0];
  expect(sharedChunk.buffer).not.toBe(shared.buffer);
  expect(sharedChunk).toEqual(canonical([0.1, -0, 2.5], "f64"));
  const nonfinite = new Float64Array([NaN]);
  expect([...projectValueBytes(nonfinite, "f64", true)][0].buffer).not.toBe(
    nonfinite.buffer,
  );
});

it("bounds borrowed Float64 views and retains their byte offsets across chunks", () => {
  const buffer = new ArrayBuffer(2 * 1024 * 1024 + 16);
  const values = new Float64Array(buffer, 8, (2 * 1024 * 1024) / 8);
  values[0] = -0;
  values[values.length - 1] = 0.1;
  const chunks = [...projectValueBytes(values, "f64", true)];
  expect(chunks.map((chunk) => chunk.length)).toEqual([
    1024 * 1024,
    1024 * 1024,
  ]);
  expect(chunks.every((chunk) => chunk.buffer === buffer)).toBe(true);
  expect(chunks.map((chunk) => chunk.byteOffset)).toEqual([8, 1024 * 1024 + 8]);
  expect(projectValueHash(values, "f64")).toEqual(
    projectValueHash(Array.from(values), "f64"),
  );
});

it("reuses bounded staging only for consumers that finish each hash chunk", () => {
  const values = Array.from({ length: 131075 }, (_, i) => (i % 2 ? -0 : i / 7));
  const iterator = projectValueBytes(values, "f64", true, true);
  const first = iterator.next().value!;
  const firstCopy = first.slice();
  const second = iterator.next().value!;
  expect(second.buffer === first.buffer).toBe(true);
  expect(second.length).toBe(24);
  const expected = canonical(values, "f64");
  expect(firstCopy).toEqual(expected.subarray(0, firstCopy.length));
  expect(second).toEqual(expected.subarray(firstCopy.length));
  expect(iterator.next().done).toBe(true);
  expect(projectValueHash(values, "f64").rawBytes).toBe(expected.length);
});

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

it("matches WebCrypto for a large byte view with a nonzero offset", async () => {
  const storage = new Uint8Array(1024 * 1024 + 31);
  for (let i = 0; i < storage.length; i++) storage[i] = (i * 37 + 11) & 255;
  const bytes = storage.subarray(7, storage.length - 3);
  const expected = Buffer.from(
    await crypto.subtle.digest("SHA-256", bytes),
  ).toString("hex");
  expect(projectValueHash(bytes, "u8")).toEqual({
    sha256: expected,
    rawBytes: bytes.length,
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
