import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
const read = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-folded-open-native-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
  return b;
};
const facets = (v: ArrayLike<number>) =>
  Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
it("pins native folded cutter indexed topology and exported facets", () => {
  const b = read(
    "native.qsf",
    "8924eb8b08dc57f1578d09087ba9a68f3fefb18e75c3ccd270a2f75da28a1455",
  );
  expect(b.readUInt32LE(456)).toBe(9);
  const vertices = Array.from({ length: 9 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(568)).toBe(11);
  const faces = Array.from({ length: 11 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(572 + 12 * i + 4 * a)),
  );
  const stl = read(
    "native-result.stl",
    "3887de1097ed584c36a29b6bf2c4d9ec1cf2cbd33eb6cdc24727f1e15274ba12",
  );
  const native = parseMesh(
    stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength),
    "stl",
  );
  expect(facets(faces.flatMap((f) => f.flatMap((id) => vertices[id])))).toEqual(
    facets(native),
  );
  const edges = new Map<string, number>();
  for (const f of faces)
    for (let i = 0; i < 3; i++) {
      const a = f[i],
        c = f[(i + 1) % 3];
      const key = [a, c].sort((x, y) => x - y).join(":");
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  let boundary = 0;
  for (const [key, count] of edges)
    if (count === 1) {
      const [a, c] = key.split(":").map(Number);
      boundary += Math.hypot(...vertices[a].map((x, i) => x - vertices[c][i]));
    }
  expect(boundary).toBeCloseTo(8, 10);
  for (const [a, c] of [
    [6, 5],
    [5, 8],
    [8, 7],
    [7, 4],
  ])
    expect(edges.get([a, c].sort((x, y) => x - y).join(":"))).toBe(2);
});

it.fails(
  "matches native folded boundary length through the shared split operation",
  () => {
    const load = (name: string, hash: string) => {
      const b = read(name, hash);
      return parseMesh(
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        "stl",
      );
    };
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions: load(
        "source.stl",
        "9b2cf1071e07942d8e7acc2d20d41364fd1a74fa1291ec4704b65ce34a70c785",
      ),
      target: load(
        "cutter.stl",
        "047e23f79335cbcf94e4bbc5e2d2c0659b5741799d65da39ca9888748707357e",
      ),
    });
    const m = result.indexedMesh!;
    const edges = new Map<string, number>();
    for (let i = 0; i < m.triangles.length; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = m.triangles[i + j],
          c = m.triangles[i + ((j + 1) % 3)],
          k = [a, c].sort((x, y) => x - y).join(":");
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    let boundary = 0;
    for (const [k, count] of edges)
      if (count === 1) {
        const [a, c] = k.split(":").map(Number);
        boundary += Math.hypot(
          ...[0, 1, 2].map(
            (i) => m.vertices[3 * a + i] - m.vertices[3 * c + i],
          ),
        );
      }
    expect(boundary).toBeCloseTo(8, 10);
  },
);
