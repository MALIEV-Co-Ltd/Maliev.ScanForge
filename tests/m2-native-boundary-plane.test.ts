import { readFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { expect, it } from "vitest";
import { runScanEdit, type ScanEditRequest } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { indexedMeshMatches } from "../src/indexed-mesh";

const directory = "./fixtures/m2-coplanar-shared-edge-native-pending-20261106/";
function mesh(name: string) {
  const bytes = readFileSync(new URL(directory + name, import.meta.url));
  return new STLLoader()
    .parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
    .getAttribute("position").array as Float32Array;
}

// The native controls demonstrate this fixed origin XY operation; it is distinct
// from the existing read-only projected curves and optional sketch publication.
const action = "boundaryProjectMeshOxy" as ScanEditRequest["action"];

it("matches native boundary projection while retaining the interior vertex", () => {
  const positions = mesh("projection-interior-control.stl");
  const before = positions.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action,
    positions,
    sourceIndexed: nativeStlTopology(positions),
  });
  expect(result.positions).toEqual(mesh("projection-interior-native.stl"));
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  expect(positions).toEqual(before);
  expect(result.diagnostics.changed).toBe(true);
});

it.each(["translated", "rotated"])(
  "matches native projection after the mesh is %s",
  (transform) => {
    const positions = mesh(`projection-${transform}-before.stl`);
    const before = positions.slice();
    const result = runScanEdit({
      kind: "scanEdit",
      action,
      positions,
      sourceIndexed: nativeStlTopology(positions),
    });
    expect(result.positions).toEqual(mesh(`projection-${transform}-after.stl`));
    expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(
      true,
    );
    expect(positions).toEqual(before);
  },
);

it("rejects the nonmanifold native split fixture without changing the source", () => {
  const positions = mesh("native-source-split.stl");
  const before = positions.slice();
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action,
      positions,
      sourceIndexed: nativeStlTopology(positions),
    }),
  ).toThrow(/requires nondegenerate manifold topology/i);
  expect(positions).toEqual(before);
});

it("rejects a valid triangle when projection would collapse its edge", () => {
  const positions = new Float32Array([0, 0, 1, 0, 0, 0, 0, 1, 0]);
  const before = positions.slice();
  expect(() => runScanEdit({ kind: "scanEdit", action, positions })).toThrow(
    /projection would create degenerate/i,
  );
  expect(positions).toEqual(before);
});

it("projects every raw boundary corner when near-coincident corners weld together", () => {
  const positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 1e-7, 0, 1e-7, 1, 1, 0, 0, 1, 0,
  ]);
  const result = runScanEdit({ kind: "scanEdit", action, positions });
  expect(result.diagnostics.changed).toBe(true);
  expect(result.positions![11]).toBe(0);
  expect(result.positions![9]).toBe(positions[9]);
  expect(positions[11]).not.toBe(0);
});

it("rejects a collapse in the actual raw corners even when welded representatives remain nondegenerate", () => {
  const positions = [
    1e-7, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1e-7, 1, 1, 0, 0.5, 0.5, 1,
  ];
  expect(() => runScanEdit({ kind: "scanEdit", action, positions })).toThrow(
    /projection would create degenerate/i,
  );
});

it("projects precise indexed heights even below Float32 precision", () => {
  const positions = [0, 0, 1e-50, 1, 0, 1e-50, 0, 1, 1e-50];
  const sourceIndexed = { vertices: positions.slice(), triangles: [0, 1, 2] };
  const result = runScanEdit({
    kind: "scanEdit",
    action,
    positions,
    sourceIndexed,
  });
  expect(result.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  expect(sourceIndexed.vertices).toEqual(positions);
});

it("leaves an already projected mesh unchanged and supports cancellation", () => {
  const positions = mesh("projection-interior-native.stl");
  const result = runScanEdit({ kind: "scanEdit", action, positions });
  expect(result.diagnostics.changed).toBe(false);
  expect(result.positions).toEqual(positions);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    runScanEdit(
      { kind: "scanEdit", action, positions },
      { signal: controller.signal },
    ),
  ).toThrow(/cancel/i);
});
