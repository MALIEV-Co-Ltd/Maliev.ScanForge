import { expect, it } from "vitest";
import { parsePlyTopology, expandPlyTopology } from "../src/ply-topology";
import { parseMesh } from "../src/io";
import { readScan } from "../src/import-parser";

function ply(vertices: string, faces: string) {
  return new TextEncoder().encode(
    `ply\nformat ascii 1.0\nelement vertex 5\nproperty float x\nproperty float y\nproperty float z\nelement face 2\nproperty list uchar int vertex_indices\nend_header\n${vertices}\n${faces}\n`,
  ).buffer;
}
const coordinates = "9 9 9\n0 1 0\n0 0 0\n1 0 0\n0 0 0";
function normalPly(first = "0 0 1") {
  return new TextEncoder().encode(
    `ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0 ${first}\n1 0 0 0 1 0\n0 1 0 1 0 0\n3 2 0 1\n`,
  ).buffer;
}
it("retains supplied normals in vertex order and expands them in original face order", async () => {
  const input = normalPly();
  let indexedNormals: Float32Array | undefined,
    meshNormals: Float32Array | undefined;
  parsePlyTopology(input, {
    onNormals: (value) => {
      indexedNormals = value;
    },
  });
  expect(indexedNormals).toEqual(new Float32Array([0, 0, 1, 0, 1, 0, 1, 0, 0]));
  const positions = await readScan(new Blob([input]), "ply", {
    onMeshNormals: (value) => {
      meshNormals = value;
    },
  });
  expect(meshNormals).toEqual(new Float32Array([1, 0, 0, 0, 0, 1, 0, 1, 0]));
  expect(meshNormals?.length).toBe(positions.length);
});
it("rejects nonfinite supplied normals", () => {
  expect(() => parsePlyTopology(normalPly("nan 0 1"))).toThrow("finite");
});
it("uses the indexed parser in the shared GUI and MCP scan import path", async () => {
  const input = ply(coordinates, "3 3 2 1\n3 1 4 3");
  let source: unknown;
  const imported = await readScan(new Blob([input]), "ply", {
    onSource: (value) => {
      source = value;
    },
  });
  expect(imported).toEqual(expandPlyTopology(parsePlyTopology(input)));
  expect(source).toEqual({
    bytes: input.byteLength,
    triangles: 2,
    displayedTriangles: 2,
  });
});
it("retains unused and coincident vertices and the original face order", () => {
  const input = ply(coordinates, "3 3 2 1\n3 1 4 3");
  const indexed = parsePlyTopology(input);
  expect([...indexed.vertices]).toEqual([
    9, 9, 9, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
  ]);
  expect([...indexed.triangles]).toEqual([3, 2, 1, 1, 4, 3]);
  expect([...expandPlyTopology(indexed)]).toEqual([
    1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0,
  ]);
  expect(parseMesh(input, "ply")).toEqual(expandPlyTopology(indexed));
});
it.each(["3 -1 2 1", "3 5 2 1"])(
  "rejects invalid face indices instead of generating nonfinite render data: %s",
  (face) => {
    expect(() =>
      parsePlyTopology(ply(coordinates, `${face}\n3 1 4 3`)),
    ).toThrow("PLY face index is outside the vertex buffer.");
  },
);

it("retains original indexed scanner normals as topology data", () => {
  const mesh = parsePlyTopology(normalPly());
  expect(mesh.normals).toEqual(new Float32Array([0, 0, 1, 0, 1, 0, 1, 0, 0]));
});
