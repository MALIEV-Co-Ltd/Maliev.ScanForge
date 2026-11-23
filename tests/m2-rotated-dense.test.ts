import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("preserves area and finite faces for the rotated dense control", () => {
  const root = "tests/fixtures/m2-native-rotated-dense-20261029/";
  const load = (name: string, hash: string) => {
    const b = readFileSync(root + name);
    expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "vertical-source.stl",
    "b33ffb30fdc5704165f1017584c93f8ff68628c733ae05309e8cf7e07fa2f1a6",
  );
  const target = load(
    "grid-128.stl",
    "eec41aa1580de2960509d206379fe9c5ae0a79b5b6a248ccf2f218a2efecdf01",
  );
  load(
    "native-rotated-result-20261029.stl",
    "05ea52970253179382885d3ea716b8cc5b88f9e1b68e0c5f796abed39e69b9d3",
  );
  const before = source.slice(),
    targetBefore = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(result.positions).toBeDefined();
  expect(result.positions!.every(Number.isFinite)).toBe(true);
  const area = (p: ArrayLike<number>) => {
    let total = 0;
    for (let i = 0; i < p.length; i += 9) {
      const a = [0, 1, 2].map((j) => p[i + 3 + j] - p[i + j]);
      const b = [0, 1, 2].map((j) => p[i + 6 + j] - p[i + j]);
      const cross = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const x = Math.hypot(...cross);
      expect(x).toBeGreaterThan(0);
      total += x / 2;
    }
    return total;
  };
  expect(
    Math.abs(area(result.positions!) - area(source)) / area(source),
  ).toBeLessThan(1e-8);
  expect(source).toEqual(before);
  expect(target).toEqual(targetBefore);
});

it.fails("matches native rotated Split facets", () => {
  const root = "tests/fixtures/m2-native-rotated-dense-20261029/";
  const load = (name: string, hash: string) => {
    const b = readFileSync(root + name);
    expect(createHash("sha256").update(b).digest("hex")).toBe(hash);
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load(
    "vertical-source.stl",
    "b33ffb30fdc5704165f1017584c93f8ff68628c733ae05309e8cf7e07fa2f1a6",
  );
  const target = load(
    "grid-128.stl",
    "eec41aa1580de2960509d206379fe9c5ae0a79b5b6a248ccf2f218a2efecdf01",
  );
  const native = load(
    "native-rotated-result-20261029.stl",
    "05ea52970253179382885d3ea716b8cc5b88f9e1b68e0c5f796abed39e69b9d3",
  );
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
  expect(facets(actual)).toEqual(facets(native));
});
