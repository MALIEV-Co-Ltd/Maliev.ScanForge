import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter.stl":
    "ae3333be9fa08b3f42d4c5f5d850ab064a0a74fe1d62f270ef4cfb5459ca52ea",
  "native-result.stl":
    "56523f64e34c8f772bad98484729449177125d2cf2e1f4ac99b2200430bdd479",
  "session.qsf":
    "e862d4d25be279d693951d387b66aaa13304de56ab927528d9fbe6698e662ae6",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-general-interior-split-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hashes[name]);
  return b;
}
function mesh(name: Exclude<keyof typeof hashes, "session.qsf">) {
  const b = bytes(name);
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
it("pins the native indexed interior edge against the exported facets", () => {
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(5);
  expect(b.readUInt32LE(520)).toBe(5);
  const vertices = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + i * 12 + a * 4)),
  );
  const faces = Array.from({ length: 5 }, (_, f) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(524 + f * 12 + a * 4)),
  );
  expect(
    facets(faces.flatMap((face) => face.flatMap((id) => vertices[id]))),
  ).toEqual(facets(mesh("native-result.stl")));
  expect(vertices[3]).toEqual([Math.fround(0.2), Math.fround(0.2), 0]);
  expect(vertices[4]).toEqual([Math.fround(0.4), Math.fround(0.4), 0]);
  expect(
    faces.filter((face) => face.includes(3) && face.includes(4)),
  ).toHaveLength(2);
});
it("matches the general interior native facets", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
});
