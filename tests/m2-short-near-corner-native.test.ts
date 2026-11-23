import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter.stl":
    "404787d961fd52155db2261936d0fa1a97ca77efd321f203e14c4c53919e193b",
  "native-result.stl":
    "454a5967e1aa74e1a74884b1bbf284b949d1c3083f8cd1eed5388d7dff2a0174",
  "session.qsf":
    "baadee758a86489fa36c47d1b862a671f5f90ed7d0c06a076f84c8452c668a28",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-short-near-corner-20261105/${name}`,
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
it("pins the unchanged native source and retained cutter coordinates", () => {
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(3);
  expect(b.readUInt32LE(496)).toBe(1);
  const source = Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => b.readFloatLE(460 + 12 * i + 4 * j)),
  );
  const face = Array.from({ length: 3 }, (_, i) => b.readUInt32LE(500 + 4 * i));
  expect(facets(face.flatMap((id) => source[id]))).toEqual(
    facets(mesh("source.stl")),
  );
  expect(facets(mesh("native-result.stl"))).toEqual(facets(mesh("source.stl")));
  const cutter = mesh("cutter.stl");
  const saved = [936, 924, 912].flatMap((offset) =>
    Array.from({ length: 3 }, (_, i) => b.readFloatLE(offset + 4 * i)),
  );
  expect(saved).toEqual([...cutter]);
});
it("matches the native unchanged source for the short near-corner cut", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(result.diagnostics.changed).toBe(false);
  expect(facets(result.positions ?? mesh("source.stl"))).toEqual(
    facets(mesh("native-result.stl")),
  );
});
