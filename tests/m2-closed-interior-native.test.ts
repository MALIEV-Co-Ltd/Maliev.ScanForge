import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const hashes = {
  "source.stl":
    "9a6d45c387ec087df8fbb14480b9bdd42d12c1b6cf106d1db68c094eb3c2e4f6",
  "cutter.stl":
    "39ac42c54f52f309e25b9ef1482eabc11287dd35fac621f3da277aa6f606e12c",
  "native-result.stl":
    "0f6d0c02c31b13a14328c5dbac84df47385b3a193e9aabc15f6512dfcad1c033",
  "session.qsf":
    "14b86c19f1f05336fb4ca7d72bbb93534ca79718a9c71ca99daa7dc3441b2fc5",
} as const;
function bytes(name: keyof typeof hashes) {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-closed-interior-split-20261105/${name}`,
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
it("pins the closed native indexed result and shared cut edge", () => {
  const b = bytes("session.qsf");
  expect(b.readUInt32LE(456)).toBe(6);
  expect(b.readUInt32LE(532)).toBe(8);
  const vertices = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + i * 12 + a * 4)),
  );
  const faces = Array.from({ length: 8 }, (_, f) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(536 + f * 12 + a * 4)),
  );
  expect(
    facets(faces.flatMap((face) => face.flatMap((id) => vertices[id]))),
  ).toEqual(facets(mesh("native-result.stl")));
  expect(vertices[4]).toEqual([Math.fround(0.001), Math.fround(0.001), 0]);
  expect(vertices[5]).toEqual([Math.fround(0.4), Math.fround(0.4), 0]);
  expect(
    faces.filter((face) => face.includes(4) && face.includes(5)),
  ).toHaveLength(2);
  const edges = new Map<string, number>();
  for (const face of faces)
    for (const [a, c] of [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ]) {
      const key = [a, c].sort((x, y) => x - y).join(",");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  expect([...edges.values()]).toEqual(Array(12).fill(2));
});
it("matches the native closed-source facets", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: mesh("source.stl"),
    target: mesh("cutter.stl"),
  });
  expect(facets(result.positions!)).toEqual(facets(mesh("native-result.stl")));
});
