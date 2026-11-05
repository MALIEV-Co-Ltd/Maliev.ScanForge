import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter.stl":
    "850b5491848cc36c9df2a0b610fd142b16df21cca70bdbdbb8cca6a272d1d287",
  "cutter-roundtrip.stl":
    "e97d9b2faf47da3c5e4c0c0d3f19f198b073f56732255a6d93710b897195f790",
  "native-result.stl":
    "5416a63f9dd5b3f224a5848bd5ea491806ab19a4c99b733e27e66b851c182d59",
  "session.qsf":
    "622f0e9ac452287923b9eb4fa26d2f2fe8ba136e3872918a1a5d253a7732b9a3",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-folded-junction-native-20261105/${name}`,
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
it("pins the native folded-cutter inputs and indexed result", () => {
  expect(facets(mesh("cutter.stl"))).toEqual(
    facets(mesh("cutter-roundtrip.stl")),
  );
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(5);
  const vertices = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(520)).toBe(5);
  const faces = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(524 + 12 * i + 4 * a)),
  );
  expect(facets(faces.flatMap((f) => f.flatMap((i) => vertices[i])))).toEqual(
    facets(mesh("native-result.stl")),
  );
  expect(vertices).not.toContainEqual([
    Math.fround(0.0004),
    Math.fround(0.0004),
    0,
  ]);
});
it.fails("matches native facets for a shared folded-cutter junction", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
});

it("keeps the two folded-cutter constraints joined at one endpoint", () => {
  const result = refineFiniteCutterMesh(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    new Uint32Array([0, 1, 2]),
    mesh("cutter.stl"),
    { preciseCoordinates: true },
  );
  const [a, b, c, d] = result.constraints;
  expect(result.constraints).toHaveLength(4);
  expect(new Set([a, b, c, d]).size).toBe(3);
  expect(a === c || a === d || b === c || b === d).toBe(true);
});
