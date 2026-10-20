import { afterEach, expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { expandPlyTopology, parsePlyTopology } from "../src/ply-topology";
import { convertScanUnits } from "../src/import-units";
import { placeScanOnOrigin } from "../src/import-origin";

afterEach(() => vi.restoreAllMocks());

function geometry(
  vertices: Float32Array | Float64Array,
  indices: Uint16Array | Uint32Array,
  normals?: Float32Array | Float64Array,
  normalizedIndex = false,
) {
  const result = new BufferGeometry();
  result.setAttribute("position", new BufferAttribute(vertices, 3));
  result.setIndex(new BufferAttribute(indices, 1, normalizedIndex));
  if (normals) result.setAttribute("normal", new BufferAttribute(normals, 3));
  return result;
}

function bits(values: Float32Array) {
  return Array.from(
    new Uint32Array(values.buffer, values.byteOffset, values.length),
  );
}

it("takes ownership of private F32 and U32 loader buffers after validation", () => {
  const vertices = new Float32Array([-0, 0, 0, 1, 0, 0, 0, 2, 0, 9, 9, 9]);
  const normals = new Float32Array([-0, -2, 0, 3, 0, 0, 0, 0, -4, 5, 0, 0]);
  const indices = new Uint32Array([2, 0, 1, 1, 0, 2]);
  const loaded = geometry(vertices, indices, normals);
  const dispose = vi.spyOn(loaded, "dispose");
  vi.spyOn(PLYLoader.prototype, "parse").mockReturnValueOnce(loaded);
  const before = [bits(vertices), bits(normals), Array.from(indices)];
  const onNormals = vi.fn();
  const mesh = parsePlyTopology(new ArrayBuffer(0), { onNormals });

  expect(mesh.vertices).toBe(vertices);
  expect(mesh.normals).toBe(normals);
  expect(mesh.triangles).toBe(indices);
  expect(onNormals).toHaveBeenCalledTimes(1);
  expect(onNormals).toHaveBeenCalledWith(normals);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect([bits(vertices), bits(normals), Array.from(indices)]).toEqual(before);
  expect(Array.from(expandPlyTopology(mesh))).toEqual([
    0, 2, 0, -0, 0, 0, 1, 0, 0, 1, 0, 0, -0, 0, 0, 0, 2, 0,
  ]);
  expect(mesh.vertices.buffer.byteLength).toBe(vertices.byteLength);
});

it("keeps F32 conversion and Uint16 widening fallbacks", () => {
  const vertices = new Float64Array([-0, 0, 0, 1 / 3, 0, 0, 0, 2 / 3, 0]);
  const normals = new Float64Array([-0, -2, 0, 3, 0, 0, 0, 0, -4]);
  const indices = new Uint16Array([2, 0, 1]);
  vi.spyOn(PLYLoader.prototype, "parse").mockReturnValueOnce(
    geometry(vertices, indices, normals),
  );
  const mesh = parsePlyTopology(new ArrayBuffer(0));

  expect(mesh.vertices).not.toBe(vertices);
  expect(mesh.normals).not.toBe(normals);
  expect(mesh.triangles).not.toBe(indices);
  expect(bits(mesh.vertices)).toEqual(bits(Float32Array.from(vertices)));
  expect(bits(mesh.normals!)).toEqual(bits(Float32Array.from(normals)));
  expect(mesh.triangles).toEqual(new Uint32Array([2, 0, 1]));
});

it("does not adopt normalized U32 indices whose getX values differ", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint32Array([0xffffffff, 0, 0]);
  vi.spyOn(PLYLoader.prototype, "parse").mockReturnValueOnce(
    geometry(vertices, indices, undefined, true),
  );
  const mesh = parsePlyTopology(new ArrayBuffer(0));

  expect(mesh.triangles).not.toBe(indices);
  expect(mesh.triangles).toEqual(new Uint32Array([1, 0, 0]));
  expect(indices[0]).toBe(0xffffffff);
});

it.each(["coordinates", "indices", "normals"] as const)(
  "rejects invalid %s and disposes without publishing normals",
  (invalid) => {
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([2, 0, 1]);
    const normals = new Float32Array([0, 0, 2, 0, 3, 0, 4, 0, 0]);
    if (invalid === "coordinates") vertices[0] = NaN;
    if (invalid === "indices") indices[0] = 3;
    if (invalid === "normals") normals[0] = Infinity;
    const loaded = geometry(vertices, indices, normals);
    const dispose = vi.spyOn(loaded, "dispose");
    vi.spyOn(PLYLoader.prototype, "parse").mockReturnValueOnce(loaded);
    const onNormals = vi.fn();
    const expected =
      invalid === "indices" ? "outside the vertex buffer" : "finite";

    expect(() => parsePlyTopology(new ArrayBuffer(0), { onNormals })).toThrow(
      expected,
    );
    expect(onNormals).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
  },
);

it("parses real PLY bytes and preserves bits, nonunit normals and placed face order", () => {
  const lines = [
    "ply",
    "format ascii 1.0",
    "element vertex 3",
    "property float x",
    "property float y",
    "property float z",
    "property float nx",
    "property float ny",
    "property float nz",
    "element face 1",
    "property list uchar int vertex_indices",
    "end_header",
    "-0 20 30 -0 -2 0",
    "2 20 30 3 0 0",
    "-0 24 31 0 0 -4",
    "3 2 0 1",
    "",
  ];
  const input = new TextEncoder().encode(lines.join(String.fromCharCode(10)));
  const originalParse = PLYLoader.prototype.parse;
  let loaded: BufferGeometry | undefined;
  vi.spyOn(PLYLoader.prototype, "parse").mockImplementation(function (
    this: PLYLoader,
    data: Parameters<PLYLoader["parse"]>[0],
  ) {
    loaded = originalParse.call(this, data);
    return loaded;
  });
  const mesh = parsePlyTopology(input.buffer);

  expect(mesh.vertices).toBe(loaded!.getAttribute("position").array);
  expect(mesh.normals).toBe(loaded!.getAttribute("normal").array);
  expect(bits(mesh.vertices)[0]).toBe(0x80000000);
  expect(mesh.triangles).toEqual(new Uint32Array([2, 0, 1]));
  expect(Array.from(mesh.normals!)).toEqual([-0, -2, 0, 3, 0, 0, 0, 0, -4]);
  const normalBits = bits(mesh.normals!);
  const positions = expandPlyTopology(mesh);
  convertScanUnits(positions, "in");
  convertScanUnits(mesh.vertices, "in");
  placeScanOnOrigin(positions, false, [mesh.vertices]);
  expect(expandPlyTopology(mesh)).toEqual(positions);
  expect(bits(mesh.normals!)).toEqual(normalBits);
});
