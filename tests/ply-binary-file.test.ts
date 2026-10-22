import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readScan, type ScanFile } from "../src/import-parser";
import { expandPlyTopology, parsePlyTopology } from "../src/ply-topology";

function packed(
  options: {
    vertices?: number;
    faces?: number;
    crlf?: boolean;
    extra?: boolean;
    bigEndian?: boolean;
    polygon?: boolean;
  } = {},
) {
  const vertices = options.vertices ?? 4;
  const faces = options.faces ?? 2;
  const header = new TextEncoder().encode(
    [
      "ply",
      `format ${options.bigEndian ? "binary_big_endian" : "binary_little_endian"} 1.0`,
      "comment scanner fixture",
      `element vertex ${vertices}`,
      ...["x", "y", "z", "nx", "ny", "nz"].map(
        (name) => `property float ${name}`,
      ),
      ...(options.extra ? ["property float quality"] : []),
      `element face ${faces}`,
      "property list uchar int vertex_indices",
      "end_header",
      "",
    ].join(options.crlf ? "\r\n" : "\n"),
  );
  const stride = options.extra ? 28 : 24;
  const corners = options.polygon ? 4 : 3;
  const data = new ArrayBuffer(
    header.length + vertices * stride + faces * (1 + corners * 4),
  );
  new Uint8Array(data).set(header);
  const view = new DataView(data);
  const little = !options.bigEndian;
  for (let vertex = 0; vertex < vertices; vertex++) {
    const values =
      vertex === 0
        ? [-0, -2.5, 2 ** -149, -0, 7, -3]
        : [vertex, vertex % 3, -(2 ** -126), 2, 0, -4];
    for (let axis = 0; axis < values.length; axis++)
      view.setFloat32(
        header.length + vertex * stride + axis * 4,
        values[axis],
        little,
      );
  }
  const faceStart = header.length + vertices * stride;
  for (let face = 0; face < faces; face++) {
    const offset = faceStart + face * (1 + corners * 4);
    view.setUint8(offset, corners);
    for (let corner = 0; corner < corners; corner++)
      view.setInt32(offset + 1 + corner * 4, [2, 0, 1, 3][corner], little);
  }
  return { data, headerBytes: header.length, faceStart };
}

function source(data: ArrayBuffer, wholeFileAllowed = false) {
  const reads: { start: number; end: number }[] = [];
  const whole = vi.fn(async () => {
    if (!wholeFileAllowed) throw new Error("Whole-file read forbidden");
    return data;
  });
  const file: ScanFile = {
    size: data.byteLength,
    arrayBuffer: whole,
    slice(start = 0, end = data.byteLength) {
      return {
        async arrayBuffer() {
          reads.push({ start, end });
          return data.slice(start, end);
        },
      };
    },
  };
  return { file, reads, whole };
}

const digest = (array: ArrayBufferView) =>
  createHash("sha256")
    .update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    .digest("hex");

it("reports monotonic PLY decoding and expansion progress through completion", async () => {
  const { data } = packed();
  const { file } = source(data);
  const progress: number[] = [];
  await readScan(file, "ply", { onProgress: (value) => progress.push(value) });
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  expect(progress).toContain(0.4);
  expect(progress).toContain(0.5);
  expect(progress).toContain(0.6);
  expect(progress).toContain(0.65);
  expect(progress).toContain(0.9);
  expect(progress.at(-1)).toBe(1);
});

it.each([0.5, 0.65])(
  "cancels at expansion boundary %s without completion",
  async (boundary) => {
    const { data } = packed();
    const { file } = source(data);
    const controller = new AbortController();
    const onSource = vi.fn(),
      onMeshNormals = vi.fn();
    const progress: number[] = [];
    await expect(
      readScan(file, "ply", {
        signal: controller.signal,
        onSource,
        onMeshNormals,
        onProgress(value) {
          progress.push(value);
          if (value === boundary) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress.at(-1)).toBe(boundary);
    expect(onSource).not.toHaveBeenCalled();
    expect(onMeshNormals).not.toHaveBeenCalled();
  },
);

it("keeps progress monotonic when a later short read uses the general loader", async () => {
  const { data } = packed();
  const { file, reads, whole } = source(data, true);
  const sliced = file.slice;
  file.slice = (start, end) => ({
    async arrayBuffer() {
      const bytes = await sliced(start, end).arrayBuffer();
      return reads.length === 4 ? bytes.slice(0, -1) : bytes;
    },
  });
  const progress: number[] = [];
  await readScan(file, "ply", { onProgress: (value) => progress.push(value) });
  expect(whole).toHaveBeenCalledOnce();
  expect(progress).toEqual([...progress].sort((a, b) => a - b));
  expect(progress.at(-1)).toBe(1);
});

it("does not report completion when a PLY consumer rejects its geometry", async () => {
  const { data } = packed();
  const { file } = source(data);
  const progress: number[] = [];
  await expect(
    readScan(file, "ply", {
      onProgress: (value) => progress.push(value),
      onIndexedMesh() {
        throw new Error("Consumer failed");
      },
    }),
  ).rejects.toThrow("Consumer failed");
  expect(progress).not.toContain(1);
});

function originalFileHashes(path: string, sourceSha256: string) {
  const bytes = readFileSync(path);
  expect(digest(bytes)).toBe(sourceSha256);
  const data =
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? (bytes.buffer as ArrayBuffer)
      : (bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer);
  const mesh = parsePlyTopology(data);
  const positions = expandPlyTopology(mesh);
  const cornerNormals = new Float32Array(positions.length);
  for (let slot = 0; slot < mesh.triangles.length; slot++) {
    const vertex = mesh.triangles[slot] * 3;
    cornerNormals[slot * 3] = mesh.normals![vertex];
    cornerNormals[slot * 3 + 1] = mesh.normals![vertex + 1];
    cornerNormals[slot * 3 + 2] = mesh.normals![vertex + 2];
  }
  return {
    bytes: bytes.byteLength,
    vertices: digest(mesh.vertices),
    normals: digest(mesh.normals!),
    triangles: digest(mesh.triangles),
    positions: digest(positions),
    cornerNormals: digest(cornerNormals),
  };
}

it.each([false, true])(
  "streams packed scanner bytes exactly (CRLF=%s)",
  async (crlf) => {
    const { data } = packed({ crlf });
    const expected = parsePlyTopology(data);
    const { file, whole } = source(data);
    let mesh: ReturnType<typeof parsePlyTopology> | undefined;
    let normals: Float32Array | undefined;
    const progress: number[] = [];
    const positions = await readScan(file, "ply", {
      onIndexedMesh: (value) => {
        mesh = value;
      },
      onMeshNormals: (value) => {
        normals = value;
      },
      onProgress: (value) => progress.push(value),
    });
    expect(whole).not.toHaveBeenCalled();
    expect(digest(mesh!.vertices)).toBe(digest(expected.vertices));
    expect(digest(mesh!.normals!)).toBe(digest(expected.normals!));
    expect(mesh!.triangles).toEqual(expected.triangles);
    expect(digest(positions)).toBe(digest(expandPlyTopology(expected)));
    expect(Array.from(normals!.subarray(0, 9))).toEqual([
      2, 0, -4, -0, 7, -3, 2, 0, -4,
    ]);
    expect(progress.at(-1)).toBe(1);
  },
);

it("bounds vertex and face reads across multiple chunks without buffering the file", async () => {
  const { data } = packed({ vertices: 50_000, faces: 90_000 });
  const expected = parsePlyTopology(data);
  const { file, reads, whole } = source(data);
  let mesh: ReturnType<typeof parsePlyTopology> | undefined;
  const positions = await readScan(file, "ply", {
    onIndexedMesh: (value) => {
      mesh = value;
    },
  });
  expect(whole).not.toHaveBeenCalled();
  expect(reads[0].end - reads[0].start).toBeLessThanOrEqual(65_536);
  expect(
    Math.max(...reads.map(({ start, end }) => end - start)),
  ).toBeLessThanOrEqual(1024 * 1024);
  expect(reads.length).toBeGreaterThan(4);
  expect(digest(mesh!.vertices)).toBe(digest(expected.vertices));
  expect(digest(mesh!.normals!)).toBe(digest(expected.normals!));
  expect(digest(mesh!.triangles)).toBe(digest(expected.triangles));
  expect(digest(positions)).toBe(digest(expandPlyTopology(expected)));
});

it.each([{ extra: true }, { bigEndian: true }, { polygon: true }])(
  "retains general-loader output for unsupported packed schema %j",
  async (options) => {
    const { data } = packed(options);
    const { file, whole } = source(data, true);
    const actual = await readScan(file, "ply");
    expect(digest(actual)).toBe(
      digest(expandPlyTopology(parsePlyTopology(data))),
    );
    expect(whole).toHaveBeenCalledOnce();
  },
);

it.each(["coordinate", "index", "normal", "index-before-normal"])(
  "preserves validation errors and publishes no topology for %s",
  async (invalid) => {
    const { data, headerBytes, faceStart } = packed();
    const view = new DataView(data);
    if (invalid === "coordinate") view.setFloat32(headerBytes, NaN, true);
    if (invalid === "normal" || invalid === "index-before-normal")
      view.setFloat32(headerBytes + 12, NaN, true);
    if (invalid === "index" || invalid === "index-before-normal")
      view.setInt32(faceStart + 1, -1, true);
    const onIndexedMesh = vi.fn();
    const { file } = source(data);
    const error = invalid.startsWith("index")
      ? "PLY face index is outside the vertex buffer."
      : invalid === "coordinate"
        ? "Invalid PLY coordinates: values must be finite."
        : "PLY vertex normals must be finite.";
    await expect(readScan(file, "ply", { onIndexedMesh })).rejects.toThrow(
      error,
    );
    expect(onIndexedMesh).not.toHaveBeenCalled();
  },
);

it.each([1, 2, 3, 4])(
  "cancels after read %s without fallback or further reads",
  async (afterRead) => {
    const { data } = packed();
    const { file, reads, whole } = source(data);
    const controller = new AbortController();
    const sliced = file.slice;
    file.slice = (start, end) => ({
      async arrayBuffer() {
        const bytes = await sliced(start, end).arrayBuffer();
        if (reads.length === afterRead) controller.abort();
        return bytes;
      },
    });
    await expect(
      readScan(file, "ply", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reads).toHaveLength(afterRead);
    expect(whole).not.toHaveBeenCalled();
  },
);

it("preflights later face counts before choosing streaming", async () => {
  const { data, faceStart } = packed();
  const view = new DataView(data);
  view.setUint8(faceStart + 13, 2);
  const { file, whole } = source(data, true);
  const actual = await readScan(file, "ply");
  expect(digest(actual)).toBe(
    digest(expandPlyTopology(parsePlyTopology(data))),
  );
  expect(whole).toHaveBeenCalledOnce();
});

it("retains ASCII input and large-header fallback", async () => {
  const ascii = new TextEncoder().encode(
    "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n",
  ).buffer;
  const original = new Uint8Array(packed().data);
  const comment = new TextEncoder().encode(
    "comment " + "a".repeat(65_536) + "\n",
  );
  const large = new Uint8Array(original.length + comment.length);
  large.set(original.subarray(0, 4));
  large.set(comment, 4);
  large.set(original.subarray(4), 4 + comment.length);
  for (const data of [ascii, large.buffer]) {
    const { file, whole, reads } = source(data, true);
    const actual = await readScan(file, "ply");
    expect(digest(actual)).toBe(
      digest(expandPlyTopology(parsePlyTopology(data))),
    );
    expect(whole).toHaveBeenCalledOnce();
    expect(reads).toHaveLength(1);
    expect(reads[0].end).toBeLessThanOrEqual(65_536);
  }
});

it("retains truncated and impossible-count fallback errors", async () => {
  const { data } = packed();
  const impossible = new TextEncoder().encode(
    "ply\nformat binary_little_endian 1.0\nelement vertex 999999999999999999999\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
  ).buffer;
  for (const input of [data.slice(0, -1), impossible]) {
    const { file, whole } = source(input, true);
    await expect(readScan(file, "ply")).rejects.toThrow();
    expect(whole).toHaveBeenCalledOnce();
  }
});

it.each([1, 2, 3, 4])(
  "falls back after short read %s without publishing partial topology",
  async (shortRead) => {
    const { data } = packed();
    const { file, whole, reads } = source(data, true);
    const sliced = file.slice;
    file.slice = (start, end) => ({
      async arrayBuffer() {
        const bytes = await sliced(start, end).arrayBuffer();
        return reads.length === shortRead ? bytes.slice(0, -1) : bytes;
      },
    });
    const onIndexedMesh = vi.fn();
    const positions = await readScan(file, "ply", { onIndexedMesh });
    expect(digest(positions)).toBe(
      digest(expandPlyTopology(parsePlyTopology(data))),
    );
    expect(onIndexedMesh).toHaveBeenCalledOnce();
    expect(whole).toHaveBeenCalledOnce();
  },
);

const originalFolder = process.env.SCANFORGE_ALIGNMENT_EXAMPLES;
for (const [name, sourceSha256] of [
  [
    "ply-1.ply",
    "e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05",
  ],
  [
    "ply-2.ply",
    "3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f",
  ],
  [
    "ply-3.ply",
    "bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2",
  ],
] as const) {
  it.skipIf(!originalFolder)(
    `streams original ${name} with exact prior indexed and authored buffer hashes`,
    async () => {
      const path = join(originalFolder!, name);
      // Return only hashes so reference geometry does not belong to the streaming run.
      const expected = originalFileHashes(path, sourceSha256);
      const handle = await open(path, "r");
      let wholeFileReads = 0;
      let maximumSliceBytes = 0;
      let slices = 0;
      try {
        expect((await handle.stat()).size).toBe(expected.bytes);
        const file: ScanFile = {
          size: expected.bytes,
          async arrayBuffer() {
            wholeFileReads++;
            throw new Error("Original packed PLY must not be buffered whole");
          },
          slice(start = 0, end = expected.bytes) {
            return {
              async arrayBuffer() {
                const length = end - start;
                maximumSliceBytes = Math.max(maximumSliceBytes, length);
                slices++;
                const data = new ArrayBuffer(length);
                const view = new Uint8Array(data);
                let filled = 0;
                while (filled < length) {
                  const { bytesRead } = await handle.read(
                    view,
                    filled,
                    length - filled,
                    start + filled,
                  );
                  if (!bytesRead) break;
                  filled += bytesRead;
                }
                return filled === length ? data : data.slice(0, filled);
              },
            };
          },
        };
        const actual: Partial<typeof expected> = { bytes: file.size };
        const positions = await readScan(file, "ply", {
          onIndexedMesh(mesh) {
            actual.vertices = digest(mesh.vertices);
            actual.normals = digest(mesh.normals!);
            actual.triangles = digest(mesh.triangles);
          },
          onMeshNormals(normals) {
            actual.cornerNormals = digest(normals);
          },
        });
        actual.positions = digest(positions);
        expect(actual).toEqual(expected);
        expect(wholeFileReads).toBe(0);
        expect(maximumSliceBytes).toBeLessThanOrEqual(1024 * 1024);
        expect(slices).toBeGreaterThan(3);
        process.stdout.write(
          JSON.stringify({
            file: name,
            maximumSliceBytes,
            slices,
            wholeFileReads,
            hashes: actual,
          }) + "\n",
        );
      } finally {
        await handle.close();
      }
    },
    30_000,
  );
}
