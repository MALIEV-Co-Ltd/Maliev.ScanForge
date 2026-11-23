import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

it("preserves the native concave cutter's imported vertex and facet order", () => {
  const root = new URL(
    "./fixtures/m2-native-concave-split-20261029/",
    import.meta.url,
  );
  const bytes = readFileSync(new URL("concave-cutter.stl", root));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "0aa225313e6897518d77eddfee449f3cb61df8afabdb73eefb6da1373e42015d",
  );
  const expected = JSON.parse(
    readFileSync(new URL("native-cutter-topology.json", root), "utf8"),
  ) as { vertices: number[]; triangles: number[] };
  const input = parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
  const indexed = nativeStlTopology(input);
  expect([...indexed.vertices]).toEqual(expected.vertices);
  expect([...indexed.triangles]).toEqual(expected.triangles);
});
