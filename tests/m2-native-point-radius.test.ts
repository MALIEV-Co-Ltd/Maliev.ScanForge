import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { inspectFiniteTriangleContact } from "../src/scan-edit-general-split";
import type { Vec3 } from "../src/types";

const root = "tests/fixtures/m2-split-point-radius/";
const load = (name: string, sha256: string) => {
  const bytes = readFileSync(root + name);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  return parseMesh(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "stl",
  );
};
const source = () =>
  load(
    "source-triangle.stl",
    "f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6",
  );
const cutter = () =>
  load(
    "cutter-below.stl",
    "f1934caa75204704f3b1a37ad37d251689be2341b7899227c9510a9873f49ccf",
  );
const native = () =>
  load(
    "native-below-20261029.stl",
    "adb567e7a9b37e60292749e9fe4a002c4d462653259924b3dbe6f0be45337971",
  );

it("pins native geometry for the below-radius Split control", () => {
  const p = native();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target: cutter(),
  });
  expect(result.positions?.length).toBe(5 * 9);
  const x = Math.fround(0.00009);
  expect([...p]).toEqual([
    x,
    0.5,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
    x,
    0.5,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
  ]);
  const twiceArea = (a: number) =>
    Math.abs(
      (p[a + 3] - p[a]) * (p[a + 7] - p[a + 1]) -
        (p[a + 4] - p[a + 1]) * (p[a + 6] - p[a]),
    );
  expect((twiceArea(0) + twiceArea(9)) / 2).toBeCloseTo(0.5 - x / 2, 12);
});

it.fails("matches native below-radius Split facets", () => {
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target: cutter(),
  });
  const canonical = (p: ArrayLike<number>) =>
    Array.from({ length: p.length / 9 }, (_, i) =>
      [0, 3, 6]
        .map((k) =>
          [0, 1, 2].map((j) => Math.fround(p[i * 9 + k + j])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(canonical(result.positions!)).toEqual(canonical(native()));
});

it("traces both boundary contacts and the retained native midpoint", () => {
  const s = source();
  const c = cutter();
  const face = (p: ArrayLike<number>, i: number) =>
    [0, 1, 2].map(
      (k) =>
        [p[i * 9 + k * 3], p[i * 9 + k * 3 + 1], p[i * 9 + k * 3 + 2]] as Vec3,
    ) as [Vec3, Vec3, Vec3];
  const hits = [0, 1].map((i) =>
    inspectFiniteTriangleContact(face(s, 0), face(c, i), {
      preciseCoordinates: true,
    }),
  );
  const x = Math.fround(0.00009);
  expect(hits[0].points).toEqual([
    [x, 1 - x, 0],
    [x, 0.5, 0],
  ]);
  expect(hits[1].points).toEqual([
    [x, 0, 0],
    [x, 0.5, 0],
  ]);
  expect(Math.hypot(x, x)).toBeGreaterThan(Math.fround(0.0001));
  const nativePositions = native();
  const nativePoints = new Set(
    Array.from({ length: nativePositions.length / 3 }, (_, i) =>
      [...nativePositions.slice(i * 3, i * 3 + 3)].join(","),
    ),
  );
  expect(nativePoints.has([x, 0.5, 0].join(","))).toBe(true);
  expect(nativePoints.has([x, 0, 0].join(","))).toBe(false);
  expect(
    nativePoints.has([Math.fround(x), Math.fround(1 - x), 0].join(",")),
  ).toBe(false);
});

it("pins native geometry at the nominal point-search radius", () => {
  const p = load(
    "native-at-20261029.stl",
    "42a605d8460e99a367abaef2efbe52d45a69380196f07cc6e2facf91f3a5dfc6",
  );
  const target = load(
    "cutter-at.stl",
    "90694b7b19cde7b02bc71ea500c0213da4004142162855e66502350682be0323",
  );
  const x = Math.fround(0.0001);
  expect([...p]).toEqual([
    x,
    0.5,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
    x,
    0.5,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
  ]);
  expect(
    runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions: source(),
      target,
    }).positions?.length,
  ).toBe(45);
});

it.fails("matches native at-radius Split facets", () => {
  const target = load(
    "cutter-at.stl",
    "90694b7b19cde7b02bc71ea500c0213da4004142162855e66502350682be0323",
  );
  const observed = load(
    "native-at-20261029.stl",
    "42a605d8460e99a367abaef2efbe52d45a69380196f07cc6e2facf91f3a5dfc6",
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target,
  });
  const canonical = (p: ArrayLike<number>) =>
    Array.from({ length: p.length / 9 }, (_, i) =>
      [0, 3, 6]
        .map((k) =>
          [0, 1, 2].map((j) => Math.fround(p[i * 9 + k + j])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(canonical(result.positions!)).toEqual(canonical(observed));
});

it("detects the uncovered wedge in the native below-radius output", () => {
  const x = Math.fround(0.00009);
  const point = [x / 4, 0.75];
  const contains = (p: ArrayLike<number>) => {
    for (let i = 0; i < p.length; i += 9) {
      const sign = (a: number, b: number) =>
        (p[b] - p[a]) * (point[1] - p[a + 1]) -
        (p[b + 1] - p[a + 1]) * (point[0] - p[a]);
      const v = [sign(i, i + 3), sign(i + 3, i + 6), sign(i + 6, i)];
      if (v.every((n) => n >= 0) || v.every((n) => n <= 0)) return true;
    }
    return false;
  };
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target: cutter(),
  });
  expect(contains(source())).toBe(true);
  expect(contains(native())).toBe(false);
  expect(contains(result.positions!)).toBe(true);
});

it("pins native geometry above the nominal point-search radius", () => {
  const p = load(
    "native-above-20261029.stl",
    "225f62796f16f8e249b15df46c16c07f32473cc17fad5e8753c742a389914313",
  );
  const target = load(
    "cutter-above.stl",
    "df8c162f55c96600c9f223c131d98b7ce7e3a43eb85136b8790c08a9487ea29f",
  );
  const x = Math.fround(0.00011);
  expect([...p]).toEqual([
    x,
    0.5,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
    x,
    0.5,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
  ]);
  expect(
    runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions: source(),
      target,
    }).positions?.length,
  ).toBe(45);
});

it.fails("matches native above-radius Split facets", () => {
  const target = load(
    "cutter-above.stl",
    "df8c162f55c96600c9f223c131d98b7ce7e3a43eb85136b8790c08a9487ea29f",
  );
  const observed = load(
    "native-above-20261029.stl",
    "225f62796f16f8e249b15df46c16c07f32473cc17fad5e8753c742a389914313",
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source(),
    target,
  });
  const canonical = (p: ArrayLike<number>) =>
    Array.from({ length: p.length / 9 }, (_, i) =>
      [0, 3, 6]
        .map((k) =>
          [0, 1, 2].map((j) => Math.fround(p[i * 9 + k + j])).join(","),
        )
        .sort()
        .join("|"),
    ).sort();
  expect(canonical(result.positions!)).toEqual(canonical(observed));
});
