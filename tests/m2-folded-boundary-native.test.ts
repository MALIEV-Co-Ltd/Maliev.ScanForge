import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "126431c2e8a871619b5bb055df2833fdb762f7a7dabd3f54fe8346446473a75d",
  "cutter.stl":
    "2db772d3f784dcc1c1cede5dde2f8ad0e6d92431a430942dce7ddbc9f2dc669e",
  "cutter-roundtrip.stl":
    "f8f8033acbd86fb9e1e93a5264dd6c570e5b9f3efcb38a1a634c251aef405315",
  "native-result.stl":
    "3d790ae82c039b14e1a0f05ac134b8e04848ffdf6c6375b6d95106c854c986d9",
  "session.qsf":
    "91ab931eb3babac7d9fedb8db5d3057bdb23ed3de3f7fcc2ad3d0ab4ef69d606",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-folded-boundary-native-20261105/${name}`,
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
it("pins the native folded boundary split and its disjoint faces", () => {
  expect(facets(mesh("cutter.stl"))).toEqual(
    facets(mesh("cutter-roundtrip.stl")),
  );
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(9);
  const vertices = Array.from({ length: 9 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(568)).toBe(3);
  const faces = Array.from({ length: 3 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(572 + 12 * i + 4 * a)),
  );
  expect(facets(faces.flatMap((f) => f.flatMap((i) => vertices[i])))).toEqual(
    facets(mesh("native-result.stl")),
  );
  expect(new Set(faces.flat()).size).toBe(9);
});
it.fails("matches the native three-piece folded boundary split", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
  expect(result.indexedMesh!.triangles).toHaveLength(9);
  expect(new Set(result.indexedMesh!.triangles).size).toBe(9);
});
