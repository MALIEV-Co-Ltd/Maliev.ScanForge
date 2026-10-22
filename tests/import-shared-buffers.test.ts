import { afterEach, expect, it, vi } from "vitest";
import { readScan } from "../src/import-parser";
import { expandPlyTopology } from "../src/ply-topology";

afterEach(() => vi.unstubAllGlobals());

function scan(extension: "ply" | "stl") {
  const xyz = [-5, -5, 0, 5, -5, 0, 0, 5, 0];
  if (extension === "stl") {
    const data = new ArrayBuffer(134);
    const view = new DataView(data);
    view.setUint32(80, 1, true);
    xyz.forEach((value, component) =>
      view.setFloat32(96 + component * 4, value, true),
    );
    return new File([data], "scan.stl");
  }
  const header = new TextEncoder().encode(
    "ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n",
  );
  const data = new ArrayBuffer(header.length + 72 + 13);
  new Uint8Array(data).set(header);
  const view = new DataView(data);
  for (let vertex = 0; vertex < 3; vertex++) {
    for (let axis = 0; axis < 3; axis++) {
      view.setFloat32(
        header.length + vertex * 24 + axis * 4,
        xyz[vertex * 3 + axis],
        true,
      );
      view.setFloat32(
        header.length + vertex * 24 + 12 + axis * 4,
        [-0, 0.25, 2][axis],
        true,
      );
    }
  }
  view.setUint8(header.length + 72, 3);
  [2, 0, 1].forEach((id, corner) =>
    view.setInt32(header.length + 73 + corner * 4, id, true),
  );
  return new File([data], "scan.ply");
}

const bits = (values: Float32Array) =>
  Array.from(new Uint32Array(values.buffer, values.byteOffset, values.length));

it.each(["ply", "stl"] as const)(
  "shares only opted-in isolated %s final buffers, retaining identical bytes",
  async (extension) => {
    for (const isolated of [false, true]) {
      vi.stubGlobal("crossOriginIsolated", isolated);
      const input = scan(extension);
      let expectedNormals: Float32Array | undefined;
      const expected = await readScan(input, extension, {
        onMeshNormals: (value) => {
          expectedNormals = value;
        },
      });
      expect(expected.buffer).toBeInstanceOf(ArrayBuffer);
      let normals: Float32Array | undefined;
      const positions = await readScan(input, extension, {
        sharedReadonlyBuffers: true,
        onMeshNormals: (value) => {
          normals = value;
        },
      });
      expect(positions.buffer instanceof SharedArrayBuffer).toBe(isolated);
      expect(bits(positions)).toEqual(bits(expected));
      if (extension === "ply") {
        expect(normals!.buffer instanceof SharedArrayBuffer).toBe(isolated);
        expect(bits(normals!)).toEqual(bits(expectedNormals!));
      }
    }
  },
);

it("keeps ordinary backing when SharedArrayBuffer is unavailable", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  vi.stubGlobal("SharedArrayBuffer", undefined);
  const positions = await readScan(scan("ply"), "ply", {
    sharedReadonlyBuffers: true,
  });
  expect(positions.buffer).toBeInstanceOf(ArrayBuffer);
});

it("shares structured-clone storage while mutation workers receive independent sliced buffers", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const positions = await readScan(scan("ply"), "ply", {
    sharedReadonlyBuffers: true,
  });
  const cloned = structuredClone(positions);
  expect(cloned.buffer).toBeInstanceOf(SharedArrayBuffer);
  expect(bits(cloned)).toEqual(bits(positions));
  const original = positions[0];
  cloned[0] = 123;
  expect(positions[0]).toBe(123);
  positions[0] = original;
  const privateCopy = positions.slice();
  expect(privateCopy.buffer).toBeInstanceOf(ArrayBuffer);
  privateCopy[0] = 456;
  expect(positions[0]).toBe(original);
  expect(cloned[0]).toBe(original);
});

it.each([false, true])(
  "publishes worker geometry through a valid transfer list (isolated=%s)",
  async (isolated) => {
    vi.stubGlobal("crossOriginIsolated", isolated);
    let published: any;
    let transfers: Transferable[] = [];
    const scope = {
      onmessage: undefined as
        undefined | ((event: { data: unknown }) => Promise<void>),
      postMessage(message: any, transfer: Transferable[] = []) {
        if (!message.positions) return;
        transfers = transfer;
        published = structuredClone(message, { transfer });
      },
    };
    vi.stubGlobal("self", scope);
    vi.resetModules();
    await import("../src/import-worker");
    await scope.onmessage!({
      data: {
        file: scan("ply"),
        extension: "ply",
        unit: "mm",
        placeAtOrigin: true,
      },
    });
    expect(published).toBeDefined();
    expect(published.positions.buffer instanceof SharedArrayBuffer).toBe(
      isolated,
    );
    expect(published.meshNormals.buffer instanceof SharedArrayBuffer).toBe(
      isolated,
    );
    expect(transfers.every((buffer) => buffer instanceof ArrayBuffer)).toBe(
      true,
    );
    expect(transfers).toHaveLength(isolated ? 4 : 6);
    expect(published.indexedMesh.vertices.buffer).toBeInstanceOf(ArrayBuffer);
    expect(bits(published.positions)).toEqual(
      bits(expandPlyTopology(published.indexedMesh)),
    );
    expect(published.renderData.indexedMesh).toBe(published.indexedMesh);
  },
);
