import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

const load = (name: string, hash: string) => {
  const b = readFileSync(
    new URL(
      `./fixtures/m2-nearby-short-disjoint-20261105/${name}`,
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
  return parseMesh(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    "stl",
  );
};
const inputs = () => ({
  source: load(
    "source.stl",
    "1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5",
  ),
  cutter: load(
    "cutter.stl",
    "f1cd9a480c33eb243156625c3a4c16de85b75e40abc087da14d955ef8a77d78c",
  ),
  native: load(
    "native-result.stl",
    "8ebfdec52e7936e242da3560c23138d91c63ecc173705647ea1378b61ba2a507",
  ),
});
const facets = (v: ArrayLike<number>) =>
  Array.from({ length: v.length / 9 }, (_, f) =>
    [0, 3, 6]
      .map((o) => [0, 1, 2].map((a) => Math.fround(v[9 * f + o + a])).join(","))
      .sort()
      .join("|"),
  ).sort();
const split = (source: Float32Array, target: Float32Array) =>
  runScanEdit({ kind: "scanEdit", action: "split", positions: source, target });

it("pins the short disjoint-cut cutter round trip and native Split observation", () => {
  const { source, cutter, native } = inputs();
  const roundtrip = load(
    "native-cutter-roundtrip.stl",
    "c4c86317c5f76c1826378f858dcf16550026c2fc4891ac5ad0113603d1f05ced",
  );
  expect([...roundtrip]).toEqual([...cutter]);
  const result = split(source, cutter);
  expect(result.diagnostics.parts).toBeGreaterThan(0);
  expect(native.length / 9).toBe(4);
  expect(result.positions!.length).toBeGreaterThan(0);
});

it("matches the short disjoint-cut retained native Split facets", () => {
  const { source, cutter, native } = inputs();
  expect(facets(split(source, cutter).positions!)).toEqual(facets(native));
});

it("pins the native boundary-to-interior shared indexed edge", () => {
  const b = readFileSync(
    new URL(
      "./fixtures/m2-nearby-short-disjoint-20261105/native.qsf",
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(b).digest("hex")).toBe(
    "8fe0292aee3e6c4e11087daa821baa681157a2a9a5ee8c36a2189a71bab01767",
  );
  expect(b.readUInt32LE(456)).toBe(5);
  expect(b.readUInt32LE(520)).toBe(4);
  const v = Array.from({ length: 5 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readFloatLE(460 + 12 * i + 4 * a)),
  );
  const faces = Array.from({ length: 4 }, (_, i) =>
    Array.from({ length: 3 }, (_, a) => b.readUInt32LE(524 + 12 * i + 4 * a)),
  );
  expect(facets(faces.flatMap((face) => face.flatMap((id) => v[id])))).toEqual(
    facets(inputs().native),
  );
  expect(v[3]).toEqual([0.5, 1, 0]);
  expect(v[4]).toEqual([0.5, Math.fround(1.3), 0]);
  expect(
    faces.filter((face) => face.includes(3) && face.includes(4)),
  ).toHaveLength(2);
});

it("matches the native boundary-to-interior indexed edge", () => {
  const { source, cutter } = inputs();
  const mesh = split(source, cutter).indexedMesh!;
  const ids = Array.from({ length: mesh.vertices.length / 3 }, (_, i) => i);
  const a = ids.find(
    (i) =>
      mesh.vertices[3 * i] === 0.5 &&
      mesh.vertices[3 * i + 1] === 1 &&
      mesh.vertices[3 * i + 2] === 0,
  );
  const b = ids.find(
    (i) =>
      mesh.vertices[3 * i] === 0.5 &&
      Math.abs(mesh.vertices[3 * i + 1] - 1.3) < 1e-6 &&
      mesh.vertices[3 * i + 2] === 0,
  );
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  const faces = Array.from({ length: mesh.triangles.length / 3 }, (_, i) =>
    Array.from(mesh.triangles.slice(i * 3, i * 3 + 3)),
  );
  expect(
    faces.filter((face) => face.includes(a!) && face.includes(b!)),
  ).toHaveLength(2);
});

it("rejects actually degenerate and nonmanifold cutters at fine tolerance", () => {
  const { source } = inputs();
  const degenerate = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const nonmanifold = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1,
  ]);
  for (const target of [degenerate, nonmanifold])
    expect(() =>
      runScanEdit({
        kind: "scanEdit",
        action: "split",
        positions: source,
        target,
        tolerance: 0.000001,
      }),
    ).toThrow(/nondegenerate manifold triangles/i);
});
