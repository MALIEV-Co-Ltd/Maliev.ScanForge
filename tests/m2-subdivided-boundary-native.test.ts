import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const read = (name: string, hash: string) => {
  const bytes = readFileSync(
    new URL(
      `./fixtures/m2-subdivided-boundary-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
  return bytes;
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
    "1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5",
  );
const cutter = () =>
  mesh(
    "cutter.stl",
    "2118d403f57b8e75cb52a1af7c136d555d9bb669cd5eb9eb0212c26a825f0c2f",
  );
const facets = (v: ArrayLike<number>) =>
  Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();

it("pins native subdivided boundary-to-interior topology and exported facets", () => {
  const b = read(
    "native.qsf",
    "c832fc751c9fbdbec96b0c7ff0648f7734582a020bcc33ed64f7e39dd48bc0b9",
  );
  expect(b.readUInt32LE(456)).toBe(6);
  const v = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  expect(b.readUInt32LE(532)).toBe(6);
  const faces = Array.from({ length: 6 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(536 + 12 * i + 4 * a)),
  );
  const native = mesh(
    "native-result.stl",
    "a824ebbf bcc5ab913f18ee3920f4073f2e385dc4e1519cd2fca1127c2b2f4d09".replace(
      " ",
      "",
    ),
  );
  expect(facets(faces.flatMap((face) => face.flatMap((id) => v[id])))).toEqual(
    facets(native),
  );
  expect(v.slice(3)).toEqual([
    [0.5, 1, 0],
    [0.5, Math.fround(1.15), 0],
    [0.5, Math.fround(1.3), 0],
  ]);
  for (const [a, c] of [
    [3, 4],
    [4, 5],
  ])
    expect(
      faces.filter((face) => face.includes(a) && face.includes(c)),
    ).toHaveLength(2);
});

it("matches both native shared indexed segments for the subdivided cutter", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target: cutter(),
  });
  const native = mesh(
    "native-result.stl",
    "a824ebbfbcc5ab913f18ee3920f4073f2e385dc4e1519cd2fca1127c2b2f4d09",
  );
  expect(facets(result.positions!)).toEqual(facets(native));
  const m = result.indexedMesh!;
  const faces = Array.from({ length: m.triangles.length / 3 }, (_, i) =>
    Array.from(m.triangles.slice(i * 3, i * 3 + 3)),
  );
  const ids = [1, 1.15, 1.3].map((y) =>
    Array.from({ length: m.vertices.length / 3 }, (_, i) => i).find(
      (i) =>
        m.vertices[i * 3] === 0.5 &&
        Math.abs(m.vertices[i * 3 + 1] - y) < 1e-6 &&
        m.vertices[i * 3 + 2] === 0,
    ),
  );
  expect(ids.every((id) => id !== undefined)).toBe(true);
  for (const [a, c] of [
    [ids[0]!, ids[1]!],
    [ids[1]!, ids[2]!],
  ])
    expect(
      faces.filter((face) => face.includes(a) && face.includes(c)),
    ).toHaveLength(2);
});
