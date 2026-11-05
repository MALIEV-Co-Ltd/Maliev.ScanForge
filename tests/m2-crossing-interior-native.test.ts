import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  "cutter.stl":
    "7d6c6ad71dcf91817e5cf2806ff7e89c60025bbe04493624cd92dcef0598e0ff",
  "native-result.stl":
    "9f41b71ca054a2a91245bf6aef707d5bd34a88583082e842cdc3dee14a511904",
  "session.qsf":
    "957d6b9bb277425958ae5a0d73f728cac3d2971dc575c2b88c431a30ec97397c",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-crossing-interior-split-20261105/${name}`,
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
  expect(vertices[3]).toEqual([0.5, Math.fround(0.1), 0]);
  expect(vertices[4]).toEqual([0.5, Math.fround(0.2), 0]);
  expect(
    faces.filter((face) => face.includes(3) && face.includes(4)),
  ).toHaveLength(2);
});
it("matches the crossing interior native facets", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
});
