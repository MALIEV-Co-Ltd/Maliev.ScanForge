import { readFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { expandPlyTopology } from "../src/ply-topology";

const bytes = readFileSync(
  new URL(
    "./fixtures/m2-near-edge-native-20261107/source.stl",
    import.meta.url,
  ),
);
const positions = new STLLoader()
  .parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  .getAttribute("position").array as Float32Array;

it.each([
  ["low", 4, [2]],
  ["high", 6, [1, 1]],
] as const)(
  "matches native optimized STL connectivity for the %s key-boundary fixture",
  (name, vertexCount, componentSizes) => {
    const file = readFileSync(
      new URL(
        `./fixtures/m2-near-edge-native-20261107/key-boundary-${name}.stl`,
        import.meta.url,
      ),
    );
    const input = new STLLoader()
      .parse(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      )
      .getAttribute("position").array as Float32Array;
    const indexed = nativeStlTopology(input);
    expect(indexed.vertices.length / 3).toBe(vertexCount);
    const inventory = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions: expandPlyTopology(indexed),
      sourceIndexed: indexed,
      tolerance: 0.001,
      inventoryScope: "components",
    }).inventory!;
    expect(inventory.components.map((c) => c.triangles.length)).toEqual(
      componentSizes,
    );
  },
);

it("preserves the native two-component control after indexed STL import", () => {
  const sourceIndexed = nativeStlTopology(positions);
  expect(sourceIndexed.vertices.length / 3).toBe(6);
  const inventory = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    sourceIndexed,
    tolerance: 0.001,
    inventoryScope: "components",
  }).inventory!;
  expect(inventory.components.map((c) => c.triangles.length)).toEqual([1, 1]);
});

it.fails(
  "preserves the native two-component control without indexed topology",
  () => {
    const inventory = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions,
      tolerance: 0.001,
      inventoryScope: "components",
    }).inventory!;
    expect(inventory.components.map((c) => c.triangles.length)).toEqual([1, 1]);
  },
);
