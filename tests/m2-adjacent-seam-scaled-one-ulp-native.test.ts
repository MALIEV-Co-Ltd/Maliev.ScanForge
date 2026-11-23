import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const load = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-adjacent-seam-scaled-one-ulp-20261105/${name}`,
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
    "a22bfaafb76d72830b40edf646a128b02667b75217f84b4978c4b884faf838ce",
  ),
  cutter: load(
    "cutter.stl",
    "e76798500bafb14f072c0eb3bde5b79641bd9b83b90469282f1b0de6b530d524",
  ),
  native: load(
    "native-result.stl",
    "7d3d79e8023f9299b32951aa98e73f53c6c85a208f0fd2d5c15c348b55120087",
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

it("pins the one-step cutter round trip and native Split observation", () => {
  const { source, cutter, native } = inputs();
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "f91de66e509cfd4a8a458e402bb8ec5e6e550d7e3a6995f29aec1d6fb946deba",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const result = split(source, cutter);
  expect(result.diagnostics.parts).toBe(2);
  expect(native.length / 9).toBe(3);
  expect(result.positions!.length / 9).toBe(3);
});

it("matches the one-step retained native Split facets", () => {
  const { source, cutter, native } = inputs();
  expect(facets(split(source, cutter).positions!)).toEqual(facets(native));
});
