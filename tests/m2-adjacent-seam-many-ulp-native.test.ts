import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const load = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-adjacent-seam-many-ulp-below-20261105/${name}`,
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
    "7fbc905d5e47ad52a8f583307483922d17bbdab0f78353dfb017012b2f91008e",
  ),
  native: load(
    "native-result.stl",
    "dc295b159937de3fbffc20cf3ff2369c61758ca64df953af2e085d86af15abfe",
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

it("pins the many-step cutter round trip and native Split observation", () => {
  const { source, cutter, native } = inputs();
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "69b475ffbd6c327b4afac8670ba843edd5bc09f76282a3a7529851e562e0e4a1",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const result = split(source, cutter);
  expect(result.diagnostics.parts).toBe(2);
  expect(native.length / 9).toBe(3);
  expect(result.positions!.length / 9).toBe(5);
});

it.fails("matches the many-step retained native Split facets", () => {
  const { source, cutter, native } = inputs();
  expect(facets(split(source, cutter).positions!)).toEqual(facets(native));
});
