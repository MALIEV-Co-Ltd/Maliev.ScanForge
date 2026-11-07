import { readFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

const bytes = readFileSync(
  new URL(
    "./fixtures/m2-small-adjacent-native-20261107/source.stl",
    import.meta.url,
  ),
);
const positions = new STLLoader()
  .parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  .getAttribute("position").array;
const componentCounts = (tolerance: number) =>
  runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    tolerance,
  }).inventory!.components.map((c) => c.triangles.length);

it.fails(
  "matches the native single component at the application tolerance",
  () => {
    expect(componentCounts(0.001)).toEqual([2]);
  },
);

it("groups this same control at finer tolerance", () => {
  expect(componentCounts(0.000001)).toEqual([2]);
});

it("retains four distinct native-reader vertices and two facets on import", () => {
  const indexed = nativeStlTopology(Float32Array.from(positions));
  expect(indexed.vertices.length / 3).toBe(4);
  expect(indexed.triangles.length / 3).toBe(2);
});

it.fails(
  "matches native connectivity after the actual indexed STL import",
  () => {
    const sourceIndexed = nativeStlTopology(Float32Array.from(positions));
    const result = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions,
      sourceIndexed,
      tolerance: 0.001,
    });
    expect(result.inventory!.components.map((c) => c.triangles.length)).toEqual(
      [2],
    );
  },
);

const collinearCorners = Float32Array.from([
  0, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0,
]);

it("retains the native collinear control's four points and two facets", () => {
  const sourceIndexed = nativeStlTopology(collinearCorners);
  expect(sourceIndexed.vertices.length / 3).toBe(4);
  expect(sourceIndexed.triangles.length / 3).toBe(2);
});

it.fails(
  "connects the native collinear-face control across its shared edge",
  () => {
    const sourceIndexed = nativeStlTopology(collinearCorners);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions: collinearCorners,
      sourceIndexed,
      tolerance: 0.001,
    });
    expect(result.inventory!.components.map((c) => c.triangles.length)).toEqual(
      [2],
    );
  },
);
