import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "9fba4de0378221c260ea5ce0b741466102b5de70ed8a5dc72dbe45fca7c3246e",
  "cutter.stl":
    "43d095883803576175f703bbf1043d704db17d749d64f6e783335666937d2b47",
  "cutter-roundtrip.stl":
    "7a7060ee9c5766710beb682a02c2a9364b85a605dd1ca6d54790d8da965f41f4",
  "native-result.stl":
    "568e37bc6b3e8d933aaf75a64cbc6ef072999604588002b6e4a691500b788dfa",
  "session.qsf":
    "097b27d1469975c5cec61380ee29c5551ef76e44247a9b1eb602ca181f3f3077",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-ambiguous-corner-native-20261105/${name}`,
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
it("pins the native ambiguous-corner result and cutter round trip", () => {
  expect(facets(mesh("cutter-roundtrip.stl"))).toEqual(
    facets(mesh("cutter.stl")),
  );
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(5);
  expect(b.readUInt32LE(520)).toBe(4);
  const vertices = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  const faces = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(524 + 12 * i + 4 * a)),
  );
  expect(
    facets(faces.flatMap((face) => face.flatMap((i) => vertices[i]))),
  ).toEqual(facets(mesh("native-result.stl")));
  expect(vertices).toEqual([
    [0, Math.fround(0.0008), 0],
    [0, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [Math.fround(0.3), Math.fround(0.0002), 0],
  ]);
  expect(
    faces.filter((face) => face.includes(0) && face.includes(4)),
  ).toHaveLength(2);
  expect(
    faces.filter((face) => face.includes(1) && face.includes(4)),
  ).toHaveLength(2);
});
it.fails("matches native facets for an edge contact near two corners", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
});
