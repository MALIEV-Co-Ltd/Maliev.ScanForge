import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it.each([
  [
    "below",
    "c7eb2ecef247eb1679157622cf315a6873f8d949e3bb2eecb8572df58ab98f1f",
    Math.fround(0.0009),
  ],
  [
    "above",
    "4b58488fd59bb876bc4acd6891bfbe9fa30d25128baeadeedb95db69c65ac1b5",
    Math.fround(0.0011),
  ],
])("preserves the source across the wider %s control", (label, hash, x) => {
  const root = "tests/fixtures/m2-split-wide-radius-20261029/";
  const load = (name: string, expected: string) => {
    const b = readFileSync(root + name);
    expect(createHash("sha256").update(b).digest("hex")).toBe(expected);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "source-triangle.stl",
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  );
  const target = load(`cutter-near-0p001-${label}.stl`, hash);
  const nativeHash =
    label === "below"
      ? "11c7961ed8a23cd1177aa9aea82de56d3d41fb155d75601e4be4a4a31c5fbe89"
      : "78845bfb3383874ecc79957d14ccfb15cc838900b700396fa70e2ca63bad37a3";
  expect(
    load(`native-wide-radius-${label}-20261029.stl`, nativeHash).length,
  ).toBe((label === "below" ? 4 : 5) * 9);
  expect(
    Array.from(target)
      .filter((_, i) => i % 3 === 0)
      .every((v) => v === x),
  ).toBe(true);
  const oldSource = source.slice(),
    oldTarget = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(result.positions).toBeDefined();
  expect(result.positions!.every(Number.isFinite)).toBe(true);
  let area = 0;
  for (let i = 0; i < result.positions!.length; i += 9) {
    const p = result.positions!;
    const signed =
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
    expect(signed).toBeGreaterThan(0);
    area += signed / 2;
  }
  expect(area).toBeCloseTo(0.5, 12);
  expect(source).toEqual(oldSource);
  expect(target).toEqual(oldTarget);
});

it.fails.each([
  [
    "below",
    "c7eb2ecef247eb1679157622cf315a6873f8d949e3bb2eecb8572df58ab98f1f",
    "11c7961ed8a23cd1177aa9aea82de56d3d41fb155d75601e4be4a4a31c5fbe89",
  ],
  [
    "above",
    "4b58488fd59bb876bc4acd6891bfbe9fa30d25128baeadeedb95db69c65ac1b5",
    "78845bfb3383874ecc79957d14ccfb15cc838900b700396fa70e2ca63bad37a3",
  ],
])("matches native wider %s facets", (label, cutterHash, nativeHash) => {
  const root = "tests/fixtures/m2-split-wide-radius-20261029/";
  const load = (name: string, expected: string) => {
    const b = readFileSync(root + name);
    expect(createHash("sha256").update(b).digest("hex")).toBe(expected);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "source-triangle.stl",
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  );
  const target = load(`cutter-near-0p001-${label}.stl`, cutterHash);
  const observed = load(`native-wide-radius-${label}-20261029.stl`, nativeHash);
  const actual = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  }).positions!;
  const facets = (p: ArrayLike<number>) =>
    Array.from({ length: p.length / 9 }, (_, i) =>
      [0, 3, 6]
        .map((k) =>
          [0, 1, 2].map((j) => Math.fround(p[i * 9 + k + j])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(facets(actual)).toEqual(facets(observed));
});
