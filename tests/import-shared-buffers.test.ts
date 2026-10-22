import { afterEach, expect, it, vi } from "vitest";
import { readScan } from "../src/import-parser";
import { expandPlyTopology, parsePlyTopology } from "../src/ply-topology";
import {
  encodeProjectFileLocally,
  decodeProjectContents,
} from "../src/project-file-codec";

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
      let expectedMesh: ReturnType<typeof parsePlyTopology> | undefined;
      const expected = await readScan(input, extension, {
        onIndexedMesh: (value) => {
          expectedMesh = value;
        },
        onMeshNormals: (value) => {
          expectedNormals = value;
        },
      });
      expect(expected.buffer).toBeInstanceOf(ArrayBuffer);
      let normals: Float32Array | undefined;
      let mesh: ReturnType<typeof parsePlyTopology> | undefined;
      const positions = await readScan(input, extension, {
        onIndexedMesh: (value) => {
          mesh = value;
        },
        sharedReadonlyBuffers: true,
        onMeshNormals: (value) => {
          normals = value;
        },
      });
      expect(positions.buffer instanceof SharedArrayBuffer).toBe(isolated);
      expect(bits(positions)).toEqual(bits(expected));
      expect(mesh).toBeDefined();
      for (const key of ["vertices", "triangles", "normals"] as const) {
        const actual = mesh![key],
          ordinary = expectedMesh![key];
        if (!ordinary) {
          expect(actual).toBeUndefined();
          continue;
        }
        expect(ordinary.buffer).toBeInstanceOf(ArrayBuffer);
        expect(actual!.buffer instanceof SharedArrayBuffer).toBe(isolated);
        expect(new Uint8Array(actual!.buffer)).toEqual(
          new Uint8Array(ordinary.buffer),
        );
        const cloned = structuredClone(actual!);
        expect(cloned.buffer instanceof SharedArrayBuffer).toBe(isolated);
        expect(Array.from(cloned)).toEqual(Array.from(actual!));
        if (isolated) {
          const original = actual![0];
          cloned[0] = original + 1;
          expect(actual![0]).toBe(original + 1);
          actual![0] = original;
        }
        const privateCopy = actual!.slice();
        expect(privateCopy.buffer).toBeInstanceOf(ArrayBuffer);
        const before = actual![0];
        privateCopy[0] = before + 1;
        expect(Object.is(actual![0], before)).toBe(true);
      }
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
  let indexed: ReturnType<typeof parsePlyTopology> | undefined;
  const positions = await readScan(scan("ply"), "ply", {
    sharedReadonlyBuffers: true,
    onIndexedMesh: (mesh) => {
      indexed = mesh;
    },
  });
  expect(positions.buffer).toBeInstanceOf(ArrayBuffer);
  for (const values of Object.values(indexed!))
    expect(values.buffer).toBeInstanceOf(ArrayBuffer);
});

it("shares packed full-buffer PLY outputs only when explicitly requested", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const data = await scan("ply").arrayBuffer();
  const ordinary = parsePlyTopology(data);
  const shared = parsePlyTopology(data, { sharedReadonlyBuffers: true });
  for (const field of ["vertices", "triangles", "normals"] as const) {
    expect(ordinary[field]!.buffer).toBeInstanceOf(ArrayBuffer);
    expect(shared[field]!.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(new Uint8Array(shared[field]!.buffer)).toEqual(
      new Uint8Array(ordinary[field]!.buffer),
    );
  }
});

it("keeps general PLY loader outputs ordinary even when final expanded buffers are shared", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  const file = new File(
    [
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 0 0 2\n1 0 0 0 3 0\n0 1 0 4 0 0\n3 2 0 1\n",
    ],
    "general.ply",
  );
  let indexed: ReturnType<typeof parsePlyTopology> | undefined;
  const positions = await readScan(file, "ply", {
    sharedReadonlyBuffers: true,
    onIndexedMesh: (mesh) => {
      indexed = mesh;
    },
  });
  expect(positions.buffer).toBeInstanceOf(SharedArrayBuffer);
  for (const values of Object.values(indexed!))
    expect(values.buffer).toBeInstanceOf(ArrayBuffer);
});

it("encodes shared indexed imports losslessly without changing any authored buffer", async () => {
  vi.stubGlobal("crossOriginIsolated", true);
  let indexedMesh: ReturnType<typeof parsePlyTopology> | undefined;
  let normals: Float32Array | undefined;
  const positions = await readScan(scan("ply"), "ply", {
    sharedReadonlyBuffers: true,
    onIndexedMesh: (mesh) => {
      indexedMesh = mesh;
    },
    onMeshNormals: (values) => {
      normals = values;
    },
  });
  const entity = {
    id: "scan",
    name: "scan.ply",
    kind: "mesh" as const,
    positions,
    normals,
    indexedMesh,
    color: "#a6a6a6",
    visible: true,
    opacity: 1,
  };
  const project = {
    format: "maliev-scanforge" as const,
    version: 1 as const,
    units: "mm" as const,
    name: "Scanner",
    entities: [entity],
  };
  const snapshot = {
    project,
    history: [{ label: "Import", entities: [entity] }],
    future: [],
  };
  const arrays = [
    positions,
    normals!,
    indexedMesh!.vertices,
    indexedMesh!.normals!,
    indexedMesh!.triangles,
  ];
  const before = arrays.map((values) => new Uint8Array(values.buffer).slice());
  const ordinary = {
    ...entity,
    positions: positions.slice(),
    normals: normals!.slice(),
    indexedMesh: {
      vertices: indexedMesh!.vertices.slice(),
      triangles: indexedMesh!.triangles.slice(),
      normals: indexedMesh!.normals!.slice(),
    },
  };
  const encoded = await encodeProjectFileLocally(structuredClone(snapshot));
  const expected = await encodeProjectFileLocally({
    ...snapshot,
    project: { ...project, entities: [ordinary] },
    history: [{ label: "Import", entities: [ordinary] }],
  });
  expect(new Uint8Array(await encoded.arrayBuffer())).toEqual(
    new Uint8Array(await expected.arrayBuffer()),
  );
  arrays.forEach((values, index) =>
    expect(new Uint8Array(values.buffer)).toEqual(before[index]),
  );
  const restored = await decodeProjectContents(encoded);
  for (const field of ["vertices", "triangles", "normals"] as const)
    expect(
      Array.from(restored.project.entities[0].indexedMesh![field]!),
    ).toEqual(Array.from(indexedMesh![field]!));
  expect(restored.history[0].entities[0].indexedMesh).toBe(
    restored.project.entities[0].indexedMesh,
  );
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
    expect(transfers).toHaveLength(isolated ? 1 : 6);
    for (const array of Object.values(
      published.indexedMesh,
    ) as ArrayBufferView[])
      expect(array.buffer instanceof SharedArrayBuffer).toBe(isolated);
    expect(bits(published.positions)).toEqual(
      bits(expandPlyTopology(published.indexedMesh)),
    );
    expect(published.renderData.indexedMesh).toBe(published.indexedMesh);
  },
);
