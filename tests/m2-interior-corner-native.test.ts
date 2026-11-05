import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter-near.stl":
    "7873e556fb2a1187dee21284b7c6eed5364c7864122f68b184b1604d739370a9",
  "cutter-near-roundtrip.stl":
    "1274b48c54bd9eb81c783e8c2a8ca2e73c17d0fc8cebf7bd23a6307c13483956",
  "native-near.stl":
    "2de05dd96287f79342fc94ebd33dad0da2703e75a7ada8a547a316792fb66004",
  "cutter-far.stl":
    "39ac42c54f52f309e25b9ef1482eabc11287dd35fac621f3da277aa6f606e12c",
  "cutter-far-roundtrip.stl":
    "36082a23e861ee2c1007c744ea036fcb1135c3c6ac6ce4bd82a6185a57ca7d5d",
  "native-far.stl":
    "73aa28526cdbb2754a064222b9f1eed58666f084614beae4be3ce713148a43f1",
} as const;
function load(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-interior-corner-split-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hashes[name]);
  return parseMesh(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "stl",
  );
}
function facets(v: ArrayLike<number>) {
  return Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[f * 9 + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
}
function split(target: Float32Array) {
  return runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: load("source.stl"),
    target,
  }).positions!;
}
it.each(["near", "far"] as const)("pins native %s cutter roundtrip", (name) => {
  const cutter = load(`cutter-${name}.stl`);
  expect([...load(`cutter-${name}-roundtrip.stl`)]).toEqual([...cutter]);
  const native = load(`native-${name}.stl`);
  expect(native.length / 9).toBe(name === "near" ? 3 : 5);
});
it.fails("matches native near-corner retained facets", () => {
  expect(facets(split(load("cutter-near.stl")))).toEqual(
    facets(load("native-near.stl")),
  );
});
it.fails("matches native outside-radius retained facets", () => {
  expect(facets(split(load("cutter-far.stl")))).toEqual(
    facets(load("native-far.stl")),
  );
});

it("pins the far native session indexed source block against its STL export", () => {
  const bytes = readFileSync(
    new URL(
      "./fixtures/m2-interior-corner-split-20261105/native-far.qsf",
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "8ac7ebbbdd246416aedcfbee21c2c43da8c4e363534bbe5496f3293c8aedc33b",
  );
  expect(bytes.readUInt32LE(456)).toBe(5);
  expect(bytes.readUInt32LE(520)).toBe(5);
  const vertices = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) =>
      bytes.readFloatLE(460 + i * 12 + a * 4),
    ),
  );
  const triangles = Array.from({ length: 5 }, (_, f) =>
    Array.from({ length: 3 }, (_, a) =>
      bytes.readUInt32LE(524 + f * 12 + a * 4),
    ),
  );
  const expanded = triangles.flatMap((face) =>
    face.flatMap((id) => vertices[id]),
  );
  expect(facets(expanded)).toEqual(facets(load("native-far.stl")));
  expect(vertices[3]).toEqual([Math.fround(0.001), Math.fround(0.001), 0]);
  expect(vertices[4]).toEqual([Math.fround(0.4), Math.fround(0.4), 0]);
  expect(
    triangles.filter((face) => face.includes(3) && face.includes(4)),
  ).toHaveLength(2);
});
