import { readFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

function load(name: string): Float32Array {
  const bytes = readFileSync(
    new URL(
      `./fixtures/m2-native-extract-lifecycle-20261107/${name}`,
      import.meta.url,
    ),
  );
  return new STLLoader()
    .parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    )
    .getAttribute("position").array as Float32Array;
}

it("matches the native exported two-triangle component and preserves the remainder", () => {
  const positions = load("source.stl");
  const expected = load("native-two-triangle.stl");
  const expectedRemainder = load("native-one-triangle.stl");
  const sourceIndexed = nativeStlTopology(positions);
  const inventory = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    sourceIndexed,
    inventoryScope: "components",
  }).inventory!;
  const index = inventory.components.findIndex((c) => c.triangles.length === 2);
  expect(index).toBeGreaterThanOrEqual(0);
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "componentExtract",
      positions,
      sourceIndexed,
      indices: [index],
    },
    { includeComponentRemainder: true },
  );
  expect(Array.from(result.segments![0])).toEqual(Array.from(expected));
  expect(Array.from(result.componentRemainder!.positions)).toEqual(
    Array.from(expectedRemainder),
  );
});
