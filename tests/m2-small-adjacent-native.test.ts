import { readFileSync } from "node:fs";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";

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
