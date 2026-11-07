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
  .getAttribute("position").array as Float32Array;
const componentCounts = (tolerance: number) =>
  runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    tolerance,
  }).inventory!.components.map((c) => c.triangles.length);

it("matches the native single component at the application tolerance", () => {
  expect(componentCounts(0.001)).toEqual([2]);
});

it("groups this same control at finer tolerance", () => {
  expect(componentCounts(0.000001)).toEqual([2]);
});

it("retains four distinct native-reader vertices and two facets on import", () => {
  const indexed = nativeStlTopology(Float32Array.from(positions));
  expect(indexed.vertices.length / 3).toBe(4);
  expect(indexed.triangles.length / 3).toBe(2);
});

it("matches native connectivity after the actual indexed STL import", () => {
  const sourceIndexed = nativeStlTopology(Float32Array.from(positions));
  const result = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    sourceIndexed,
    tolerance: 0.001,
  });
  expect(result.inventory!.components.map((c) => c.triangles.length)).toEqual([
    2,
  ]);
  const scoped = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    inventoryScope: "components",
    positions,
    sourceIndexed,
    tolerance: 0.001,
  });
  expect(scoped.inventory!.components.map((c) => c.triangles.length)).toEqual([
    2,
  ]);
  const extracted = runScanEdit({
    kind: "scanEdit",
    action: "componentExtract",
    positions,
    sourceIndexed,
    indices: [0],
    tolerance: 0.001,
  });
  expect(extracted.segments!.map((segment) => segment.length / 9)).toEqual([2]);
});

const collinearCorners = Float32Array.from([
  0, 0, 0, 1, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0,
]);

it("retains the native collinear control's four points and two facets", () => {
  const sourceIndexed = nativeStlTopology(collinearCorners);
  expect(sourceIndexed.vertices.length / 3).toBe(4);
  expect(sourceIndexed.triangles.length / 3).toBe(2);
});

it("connects the native collinear-face control across its shared edge", () => {
  const sourceIndexed = nativeStlTopology(collinearCorners);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions: collinearCorners,
    sourceIndexed,
    tolerance: 0.001,
  });
  expect(result.inventory!.components.map((c) => c.triangles.length)).toEqual([
    2,
  ]);
});

it("uses the same component for scoped inventory and extraction after welding", () => {
  const base = { kind: "scanEdit" as const, positions, tolerance: 0.001 };
  const scoped = runScanEdit({
    ...base,
    action: "inventory",
    inventoryScope: "components",
  });
  expect(scoped.inventory!.components.map((c) => c.triangles.length)).toEqual([
    2,
  ]);
  const extracted = runScanEdit({
    ...base,
    action: "componentExtract",
    indices: [0],
  });
  expect(extracted.segments!.map((segment) => segment.length / 9)).toEqual([2]);
});

it("reports collapsed-face grouping while a component edit is running", () => {
  const events: { fraction: number; stage: string }[] = [];
  runScanEdit(
    {
      kind: "scanEdit",
      action: "componentExtract",
      positions,
      tolerance: 0.001,
      indices: [0],
    },
    { onProgress: (fraction, stage) => events.push({ fraction, stage }) },
  );
  const group = events.find(
    (event) => event.stage === "Grouping collapsed components",
  );
  expect(group).toBeDefined();
  expect(group!.fraction).toBeLessThan(1);
  expect(
    events.findIndex(
      (event) => event.stage === "Grouping collapsed components",
    ),
  ).toBeLessThan(
    events.findIndex(
      (event) => event.stage === "Preparing component coordinates",
    ),
  );
});
