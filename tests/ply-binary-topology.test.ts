import { expect, it } from "vitest";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { parsePackedBinaryPly } from "../src/ply-binary-topology";
import { parsePlyTopology } from "../src/ply-topology";

const vertices = [
  [-0, -2.5, 2 ** -149, -0, 7, -3],
  [1, 0, -(2 ** -126), 2, 0, 0],
  [0, 1, 0, 0, -4, 0],
  [9, 9, 9, 1, 1, 1],
];

function binary(
  rows = vertices,
  faces = [
    [2, 0, 1],
    [1, 0, 2],
  ],
  options: { crlf?: boolean; extra?: boolean; bigEndian?: boolean } = {},
) {
  const header = new TextEncoder().encode(
    [
      "ply",
      `format ${options.bigEndian ? "binary_big_endian" : "binary_little_endian"} 1.0`,
      "comment File generated",
      `element vertex ${rows.length}`,
      ...["x", "y", "z", "nx", "ny", "nz"].map(
        (name) => `property float ${name}`,
      ),
      ...(options.extra ? ["property float quality"] : []),
      `element face ${faces.length}`,
      "property list uchar int vertex_indices",
      "end_header",
      "",
    ].join(options.crlf ? "\r\n" : "\n"),
  );
  const data = new ArrayBuffer(
    header.length +
      rows.length * (options.extra ? 28 : 24) +
      faces.reduce((sum, face) => sum + 1 + face.length * 4, 0),
  );
  new Uint8Array(data).set(header);
  const view = new DataView(data);
  let offset = header.length;
  for (const row of rows) {
    for (const value of [...row, ...(options.extra ? [42] : [])]) {
      view.setFloat32(offset, value, !options.bigEndian);
      offset += 4;
    }
  }
  for (const face of faces) {
    view.setUint8(offset++, face.length);
    for (const id of face) {
      view.setInt32(offset, id, !options.bigEndian);
      offset += 4;
    }
  }
  return data;
}

function reference(data: ArrayBuffer) {
  const geometry = new PLYLoader().parse(data);
  try {
    return {
      vertices: Float32Array.from(geometry.getAttribute("position").array),
      normals: Float32Array.from(geometry.getAttribute("normal").array),
      triangles: Uint32Array.from(geometry.index!.array),
    };
  } finally {
    geometry.dispose();
  }
}

function expectExact(
  actual: ReturnType<typeof parsePlyTopology>,
  expected: ReturnType<typeof reference>,
) {
  expect(new Uint8Array(actual.vertices.buffer)).toEqual(
    new Uint8Array(expected.vertices.buffer),
  );
  expect(new Uint8Array(actual.normals!.buffer)).toEqual(
    new Uint8Array(expected.normals.buffer),
  );
  expect(new Uint8Array(actual.triangles.buffer)).toEqual(
    new Uint8Array(expected.triangles.buffer),
  );
}

it.each([false, true])(
  "matches Three byte for byte, retaining signed zero, subnormals and order (CRLF=%s)",
  (crlf) => {
    const data = binary(vertices, undefined, { crlf });
    const expected = reference(data);
    const packed = parsePackedBinaryPly(data)!;
    expect(packed).toBeDefined();
    expectExact(packed, expected);
    let suppliedNormals: Float32Array | undefined;
    const actual = parsePlyTopology(data, {
      onNormals: (value) => (suppliedNormals = value),
    });
    expectExact(actual, expected);
    expect(suppliedNormals).toBe(actual.normals);
    for (const array of [actual.vertices, actual.normals!, actual.triangles]) {
      expect(array.buffer).not.toBe(data);
      expect(array.byteOffset).toBe(0);
      expect(array.byteLength).toBe(array.buffer.byteLength);
    }
  },
);

it.each([-1, 4])("rejects the invalid face index %s", (id) => {
  expect(() => parsePlyTopology(binary(vertices, [[0, id, 2]]))).toThrow(
    "PLY face index is outside the vertex buffer.",
  );
});

it("retains face-validation precedence over invalid authored normals", () => {
  const rows = vertices.map((row) => [...row]);
  rows[0][3] = NaN;
  expect(() => parsePlyTopology(binary(rows, [[0, -1, 2]]))).toThrow(
    "PLY face index is outside the vertex buffer.",
  );
});

it.each([NaN, Infinity, -Infinity])(
  "rejects nonfinite coordinates and normals: %s",
  (value) => {
    const rows = vertices.map((row) => [...row]);
    rows[0][0] = value;
    expect(() => parsePlyTopology(binary(rows))).toThrow(
      "Invalid PLY coordinates",
    );
    rows[0][0] = 0;
    rows[0][3] = value;
    expect(() => parsePlyTopology(binary(rows))).toThrow(
      "PLY vertex normals must be finite",
    );
  },
);

it.each([{ extra: true }, { bigEndian: true }])(
  "keeps the general loader for the schema %j",
  (options) => {
    const data = binary(vertices, undefined, options);
    expect(parsePackedBinaryPly(data)).toBeUndefined();
    expectExact(parsePlyTopology(data), reference(data));
  },
);

it("keeps polygon triangulation in the general loader", () => {
  const data = binary(vertices, [[0, 1, 2, 3]]);
  expect(parsePackedBinaryPly(data)).toBeUndefined();
  expectExact(parsePlyTopology(data), reference(data));
});

it("preflights every face count before choosing the packed path", () => {
  const data = binary();
  new DataView(data).setUint8(data.byteLength - 13, 2);
  expect(parsePackedBinaryPly(data)).toBeUndefined();
});

it("declines truncated data and impossible declared counts before allocation", () => {
  const data = binary();
  expect(parsePackedBinaryPly(data.slice(0, -1))).toBeUndefined();
  const text = new TextDecoder().decode(data.slice(0, 300));
  const header =
    text.slice(0, text.indexOf("end_header") + "end_header".length) + "\n";
  const huge = new TextEncoder().encode(
    header.replace("element vertex 4", "element vertex 999999999999999999999"),
  );
  expect(parsePackedBinaryPly(huge.buffer)).toBeUndefined();
});

it("leaves ASCII input to the general loader", () => {
  const data = new TextEncoder().encode(
    "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 0 0 2\n1 0 0 0 0 2\n0 1 0 0 0 2\n3 2 0 1\n",
  ).buffer;
  expect(parsePackedBinaryPly(data)).toBeUndefined();
  expectExact(parsePlyTopology(data), reference(data));
});
