import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
const read = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-subdivided-corner-native-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
  return b;
};
const mesh = (name: string, hash: string) => {
  const b = read(name, hash);
  return parseMesh(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "stl",
  );
};
const source = () =>
  mesh(
    "source.stl",
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  );
const cutter = () =>
  mesh(
    "cutter.stl",
    "fa1920d572d16fc280e7ff0892ee74637aafc4a3a763b75cbe841229c29d014a",
  );
const native = () =>
  mesh(
    "native-result.stl",
    "6749f22ca0c205c580d9f9790ad6d4ed5f439d9d8b731153bf5c20115cfd951f",
  );
const facets = (v: ArrayLike<number>) =>
  Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
it("pins the subdivided cutter round trip and native indexed result", () => {
  const roundtrip = mesh(
    "cutter-roundtrip.stl",
    "97f58e855a0b92abc496b943bbbca38136e442c9e9e71d5f129c2ece71d20936",
  );
  expect(facets(cutter())).toEqual(facets(roundtrip));
  const b = read(
    "native.qsf",
    "b3f26de6be6c5efe391804382ad80149ac828532d76e4424f42cc8a8e6a71c97",
  );
  expect(b.readUInt32LE(456)).toBe(5);
  const v = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(520)).toBe(5);
  const fs = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(524 + 12 * i + 4 * a)),
  );
  expect(facets(fs.flatMap((f) => f.flatMap((i) => v[i])))).toEqual(
    facets(native()),
  );
  expect(v[1]).toEqual([0, 0, 0]);
  expect(v[3]).toEqual([Math.fround(0.2002), Math.fround(0.2002), 0]);
  expect(v[4]).toEqual([Math.fround(0.4), Math.fround(0.4), 0]);
  for (const [a, c] of [
    [1, 3],
    [3, 4],
  ])
    expect(fs.filter((f) => f.includes(a) && f.includes(c))).toHaveLength(2);
});
it.fails("matches the native subdivided near-corner result", () => {
  const r = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target: cutter(),
  });
  expect(facets(r.positions!)).toEqual(facets(native()));
});
