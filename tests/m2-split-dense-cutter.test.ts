import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { analyzeIndexedMesh } from "../src/mesh-processing";

import { overlapArea, type Point } from "./split-coverage-utils";

it("matches the newly exported native dense-cutter facets", () => {
  const root = new URL(
    "./fixtures/m2-tree-depth-control-20261029/",
    import.meta.url,
  );
  const load = (name: string, hash: string) => {
    const bytes = readFileSync(new URL(name, root));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load(
    "vertical-source.stl",
    "930d69565f9b94989a465b7a5f4b4b79f48da8f0d1410c2b21134eea504b057e",
  );
  const target = load(
    "grid-128.stl",
    "e8609260000042e973da8557b7c53c3ebccf6193918768f8f4505791d14b3ec0",
  );
  const native = load(
    "native-dense-result-20261029.stl",
    "da52d7afd8d4e9b1cb316e8598cd213422680381b56280008ae53c5de40381f7",
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  const facets = (p: ArrayLike<number>) =>
    Array.from({ length: p.length / 9 }, (_, i) =>
      [0, 3, 6]
        .map((k) =>
          [0, 1, 2].map((j) => Math.fround(p[i * 9 + k + j])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(facets(result.positions!)).toEqual(facets(native));
});

it("distinguishes shared edges from overlapping interiors in the coverage check", () => {
  const triangle: Point[] = [
    [0, 0],
    [1, 0],
    [0, 1],
  ];
  expect(
    overlapArea(triangle, [
      [1, 0],
      [1, 1],
      [0, 1],
    ]),
  ).toBe(0);
  expect(overlapArea(triangle, triangle)).toBe(0.5);
});

it("splits a vertical face pair against a dense planar cutter without changing its inputs", () => {
  const root = new URL(
    "./fixtures/m2-tree-depth-control-20261029/",
    import.meta.url,
  );
  const load = (name: string, hash: string) => {
    const bytes = readFileSync(new URL(name, root));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load(
    "vertical-source.stl",
    "930d69565f9b94989a465b7a5f4b4b79f48da8f0d1410c2b21134eea504b057e",
  );
  const cutter = load(
    "grid-128.stl",
    "e8609260000042e973da8557b7c53c3ebccf6193918768f8f4505791d14b3ec0",
  );
  const before = source.slice(),
    targetBefore = cutter.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(result.indexedMesh).toBeDefined();
  expect(result.positions).toBeDefined();
  const mesh = result.indexedMesh!;
  const topology = analyzeIndexedMesh(
    Float64Array.from(mesh.vertices),
    Uint32Array.from(mesh.triangles),
  );
  expect(topology.components).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.boundaryEdges).toBe(36);
  let signedArea = 0;
  const faces: Point[][] = [];
  for (let i = 0; i < result.positions!.length; i += 9) {
    const p = result.positions!;
    const face: Point[] = [];
    for (let corner = 0; corner < 3; corner++) {
      const at = i + corner * 3;
      expect(p[at + 1]).toBeCloseTo(0.125, 12);
      expect(p[at]).toBeGreaterThanOrEqual(-2.25);
      expect(p[at]).toBeLessThanOrEqual(2.25);
      expect(p[at + 2]).toBeGreaterThanOrEqual(-1);
      expect(p[at + 2]).toBeLessThanOrEqual(2);
      face.push([p[at], p[at + 2]]);
    }
    faces.push(face);
    const ux = p[i + 3] - p[i],
      uz = p[i + 5] - p[i + 2],
      vx = p[i + 6] - p[i],
      vz = p[i + 8] - p[i + 2];
    const projected = ux * vz - uz * vx;
    expect(projected).toBeGreaterThan(0);
    signedArea += projected;
  }
  expect(signedArea).toBeCloseTo(27, 9);
  for (let i = 0; i < faces.length; i++)
    for (let j = i + 1; j < faces.length; j++)
      expect(overlapArea(faces[i], faces[j])).toBeLessThan(1e-10);
  expect(source).toEqual(before);
  expect(cutter).toEqual(targetBefore);
});
