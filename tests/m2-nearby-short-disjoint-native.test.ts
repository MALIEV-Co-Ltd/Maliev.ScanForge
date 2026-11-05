import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const load = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-nearby-short-disjoint-20261105/${name}`,
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
    "f1cd9a480c33eb243156625c3a4c16de85b75e40abc087da14d955ef8a77d78c",
  ),
  native: load(
    "native-result.stl",
    "8ebfdec52e7936e242da3560c23138d91c63ecc173705647ea1378b61ba2a507",
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

it("pins the short disjoint-cut cutter round trip and native Split observation", () => {
  const { source, cutter, native } = inputs();
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "c4c86317c5f76c1826378f858dcf16550026c2fc4891ac5ad0113603d1f05ced",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const result = split(source, cutter);
  expect(result.diagnostics.parts).toBeGreaterThan(0);
  expect(native.length / 9).toBe(4);
  expect(result.positions!.length).toBeGreaterThan(0);
});

it.fails("matches the short disjoint-cut retained native Split facets", () => {
  const { source, cutter, native } = inputs();
  expect(facets(split(source, cutter).positions!)).toEqual(facets(native));
});
