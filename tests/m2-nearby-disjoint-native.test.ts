import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const load = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-nearby-disjoint-cuts-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
  return parseMesh(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "stl",
  );
};
const inputs = () => ({
  source: load(
    "source.stl",
    "1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5",
  ),
  cutter: load(
    "cutter.stl",
    "8fde3110427f68f3ec74d76774b7afb5788809bb8d452925c604c6a7f69ce731",
  ),
  native: load(
    "native-result.stl",
    "a5d3c0edb203a7d9b8b49231492025f634aaeb096d896800f276eca9e514ef5f",
  ),
});
const facets = (v: ArrayLike<number>) =>
  Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
const split = (source: Float32Array, target: Float32Array) =>
  runScanEdit({ kind: "scanEdit", action: "split", positions: source, target });

it("pins the disjoint-cut cutter round trip and native Split observation", () => {
  const { source, cutter, native } = inputs();
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "aa2c14e5cb874f3b2d6bb3cc4498a984523024356d51ae38803d2962c12cd740",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const result = split(source, cutter);
  expect(result.diagnostics.parts).toBeGreaterThan(0);
  expect(native.length / 9).toBe(6);
  expect(result.positions!.length).toBeGreaterThan(0);
});

it("matches the disjoint-cut retained native Split facets", () => {
  const { source, cutter, native } = inputs();
  expect(facets(split(source, cutter).positions!)).toEqual(facets(native));
});
