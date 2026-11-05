import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "8c271934342899229088dc9b5638cfabdbf4063161acc6c4b6c7ab6d3b09183b",
  "cutter.stl":
    "cd7254bbb12682262aedbd4d320f840e788c076ee29c0c438ba438e937bd6ef4",
  "cutter-roundtrip.stl":
    "2e0f1f840f442341cfa1a76d1689bf2a5d7b52fd86ade5e200ea5da597a75e4c",
  "native-result.stl":
    "46a48121a4206cb90540f3fb20d2b05637914e9e30736f9c684ea81924fa047c",
  "session.qsf":
    "31dffef3ec46ade4538449300bd53bdfb443dc07dea13998be1015c25728aa98",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-shared-edge-corner-native-20261105/${name}`,
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
it("pins the native cutter round trip and indexed shared-edge result", () => {
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
  expect(facets(faces.flatMap((f) => f.flatMap((i) => vertices[i])))).toEqual(
    facets(mesh("native-result.stl")),
  );
  expect(vertices).toEqual([
    [0, 1, 0],
    [0, 0, 0],
    [0, -1, 0],
    [1, 0, 0],
    [Math.fround(0.4), Math.fround(0.3), 0],
  ]);
  expect(faces.filter((f) => f.includes(1) && f.includes(3))).toHaveLength(2);
  expect(faces.filter((f) => f.includes(1) && f.includes(4))).toHaveLength(2);
});
it.fails(
  "matches native facets when a shared-edge contact snaps to a corner",
  () => {
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions: mesh("source.stl"),
      target: mesh("cutter.stl"),
    });
    expect(facets(result.positions!)).toEqual(
      facets(mesh("native-result.stl")),
    );
  },
);
