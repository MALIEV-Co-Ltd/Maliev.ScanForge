import { expect, it } from "vitest";
import { runScanEdit } from "../src/scan-edit";
import { splitGeneralCutter } from "../src/scan-edit-general-split";

const positions = new Float32Array([-0.0005, 0, 0, -0.002, 1, 0, 1, 0.4, 0]);
const target = new Float32Array([0, -3, -3, 0, 3, -3, 0, 0, 3]);
const twiceArea = (b: number[]) =>
  Math.abs((b[3] - b[0]) * (b[7] - b[1]) - (b[4] - b[1]) * (b[6] - b[0]));

it.each(["plane", "finite cutter"] as const)(
  "%s keeps near-plane fragments within the source triangle and conserves area",
  (mode) => {
    const request = {
      kind: "scanEdit" as const,
      action: "split" as const,
      positions,
      ...(mode === "plane"
        ? {
            plane: {
              origin: [0, 0, 0] as [number, number, number],
              normal: [1, 0, 0] as [number, number, number],
            },
          }
        : { target }),
    };
    const options = { tolerance: 0.001 };
    const result =
      mode === "plane"
        ? runScanEdit(request, options)
        : splitGeneralCutter(request, options);
    const segments = result.segments!;
    let area = 0;
    for (const segment of segments) {
      for (let i = 0; i < segment.length; i += 9) {
        const triangle = Array.from(segment.slice(i, i + 9));
        area += twiceArea(triangle);
        for (let j = 0; j < 9; j += 3) {
          expect(triangle[j + 1]).toBeGreaterThanOrEqual(-1e-6);
          expect(triangle[j + 1]).toBeLessThanOrEqual(1 + 1e-6);
        }
      }
    }
    expect(area).toBeCloseTo(twiceArea(Array.from(positions)), 6);
  },
);

it.each([
  ["plane", [-0.0005, 0, 0, 0.002, 0, 0, 0.002, 1, 0]],
  ["finite cutter", [-0.002, 0, 0, 0.0005, 0, 0, 0.002, 1, 0]],
] as const)("%s retains a small nonzero fragment", (mode, source) => {
  const request = {
    kind: "scanEdit" as const,
    action: "split" as const,
    positions: new Float32Array(source),
    ...(mode === "plane"
      ? {
          plane: {
            origin: [0, 0, 0] as [number, number, number],
            normal: [1, 0, 0] as [number, number, number],
          },
        }
      : { target }),
  };
  const options = { tolerance: 0.001 };
  const result =
    mode === "plane"
      ? runScanEdit(request, options)
      : splitGeneralCutter(request, options);
  if (mode === "plane")
    expect(result.segments!.every((segment) => segment.length >= 9)).toBe(true);
  const area = result
    .segments!.flatMap((segment) => {
      const triangles: number[][] = [];
      for (let i = 0; i < segment.length; i += 9)
        triangles.push(Array.from(segment.slice(i, i + 9)));
      return triangles;
    })
    .reduce((sum, triangle) => sum + twiceArea(triangle), 0);
  expect(area).toBeCloseTo(twiceArea(Array.from(request.positions)), 8);
});

it("does not discard nonzero source area solely because a split facet is small", () => {
  const source = new Float32Array([
    -0.002, 0, 0, 0.002, 0, 0, 0.002, 0.0002, 0,
  ]);
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "split",
      positions: source,
      plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
    },
    { tolerance: 0.001 },
  );
  const triangles: number[][] = [];
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      triangles.push(Array.from(segment.slice(i, i + 9)));
  const area = triangles.reduce(
    (sum, triangle) => sum + twiceArea(triangle),
    0,
  );
  expect(area / twiceArea(Array.from(source))).toBeCloseTo(1, 5);
});

it("rejects a triangle that collapses after Float32 conversion", () => {
  const source = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000008, 8, 0,
  ]);
  const before = Array.from(source);
  expect(() =>
    runScanEdit(
      {
        kind: "scanEdit",
        action: "split",
        positions: source,
        plane: { origin: [100000000.1, 0, 0], normal: [1, 0, 0] },
      },
      { tolerance: 1e-6 },
    ),
  ).toThrow(/Float32 precision/);
  expect(Array.from(source)).toEqual(before);
});

it("rejects a Float32 rounding that reverses a split facet", async () => {
  const { appendSplitTriangle } = await import("../src/scan-split-triangle");
  expect(() =>
    appendSplitTriangle(
      [],
      [100000000, 0, 0],
      [100000008, 1, 0],
      [100000004.1, 0.52, 0],
    ),
  ).toThrow(/Float32 precision/);
});

it("preserves an untouched large-coordinate triangle when a cutter touches its edge", () => {
  const source = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, -8, -8, 100000000, 16, -8, 100000000, 0, 16,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 1e-6 },
  );
  expect(result.segments!.flatMap((segment) => Array.from(segment))).toEqual(
    Array.from(source),
  );
});

it("preserves a large-coordinate source when a finite cutter touches part of its edge", () => {
  const source = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, 2, -2, 100000000, 6, -2, 100000000, 4, 2,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 1e-6 },
  );
  let area = 0;
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      area += twiceArea(Array.from(segment.slice(i, i + 9)));
  expect(area).toBeCloseTo(twiceArea(Array.from(source)), 5);
  const edges = new Set<string>();
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + j * 3,
          b = i + ((j + 1) % 3) * 3;
        if (segment[a] === 100000000 && segment[b] === 100000000)
          edges.add(
            [segment[a + 1], segment[b + 1]].sort((x, y) => x - y).join(","),
          );
      }
  for (const edge of ["0,3", "3,5", "5,8"]) expect(edges.has(edge)).toBe(true);
});

it("accepts only a distinct, coplanar, convex ordered Float32 fallback boundary", async () => {
  const { convexSplitBoundaryNormal } =
    await import("../src/scan-split-triangle");
  expect(
    convexSplitBoundaryNormal([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ]),
  ).toBeDefined();
  expect(
    convexSplitBoundaryNormal([
      [0, 0, 0],
      [0.5, 0.1, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]),
  ).toBeUndefined();
  expect(
    convexSplitBoundaryNormal([
      [0, 0, 0],
      [2, 3, 0],
      [4, 0, 0],
      [0, 2, 0],
      [4, 2, 0],
    ]),
  ).toBeUndefined();
  expect(
    convexSplitBoundaryNormal([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0.1],
    ]),
  ).toBeUndefined();
  expect(
    convexSplitBoundaryNormal([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]),
  ).toBeUndefined();
});

it("does not move the source boundary when a finite cut runs just inside an edge", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([
    0.3, 0.0005, -1, 0.7, 0.0005, -1, 0.5, 0.0005, 1,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  let area = 0;
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      area += twiceArea(Array.from(segment.slice(i, i + 9)));
  expect(area).toBeCloseTo(twiceArea(Array.from(source)), 7);
});

it("does not introduce a T-junction at a tolerance-near contact on a shared edge", () => {
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, -0.00025, 0,
  ]);
  const cutter = new Float32Array([
    0.3, 0.0005, -1, 0.7, 0.0005, -1, 0.5, 0.0005, 1,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  const edges = new Map<string, number>();
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + 3 * j,
          b = i + 3 * ((j + 1) % 3);
        if (segment[a + 1] === 0 && segment[b + 1] === 0) {
          const key = [segment[a], segment[b]].sort((x, y) => x - y).join(",");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
  expect([...edges.entries()]).toEqual([["0,1", 2]]);
});

it("preserves shared edge incidence for a cut near one endpoint of a long edge", () => {
  const source = new Float32Array([
    0, 0, 0, 1000, 0, 0, -1, 1, 0, 1000, 0, 0, 0, 0, 0, 1000, -1, 0,
  ]);
  const cutter = new Float32Array([
    0.0005, -2, -1, 0.0005, 2, -1, 0.0005, 2, 1, 0.0005, -2, -1, 0.0005, 2, 1,
    0.0005, -2, 1,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  const edges = new Map<string, number>();
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + 3 * j,
          b = i + 3 * ((j + 1) % 3);
        if (segment[a + 1] === 0 && segment[b + 1] === 0) {
          const key = [segment[a], segment[b]].sort((x, y) => x - y).join(",");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
  expect(edges.size).toBeGreaterThan(0);
  expect([...edges.values()].every((count) => count === 2)).toBe(true);
});

it("keeps shared edge incidence when one adjacent facet lies within the cutter tolerance", () => {
  const source = new Float32Array([
    -0.00075, 0, 0, 0.00075, 0, 0, 1, 1, 0, 0.00075, 0, 0, -0.00075, 0, 0, 0,
    -1, 0,
  ]);
  const cutter = new Float32Array([
    0, -2, -1, 0, 2, -1, 0, 2, 1, 0, -2, -1, 0, 2, 1, 0, -2, 1,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  const edges = new Map<string, number>();
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + 3 * j,
          b = i + 3 * ((j + 1) % 3);
        if (segment[a + 1] === 0 && segment[b + 1] === 0) {
          const key = [segment[a], segment[b]].sort((x, y) => x - y).join(",");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
  expect(edges.size).toBeGreaterThan(0);
  expect([...edges.values()].every((count) => count === 2)).toBe(true);
});

it("does not split a source when a finite cutter lies just outside its boundary", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([
    0.5, 0.5001, -1, 0.5, 0.5021, -1, 0.5, 0.5001, 1,
  ]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  expect(result.segments!.flatMap((segment) => Array.from(segment))).toEqual(
    Array.from(source),
  );
});

it("preserves an on-plane shared edge when only one adjacent face is tolerance-near", () => {
  const source = new Float32Array([
    0, 0, 0, 0, 1, 0, 0.0005, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0,
  ]);
  const cutter = new Float32Array([0, 0.1, -1, 0, 0.9, -1, 0, 0.5, 1]);
  const result = splitGeneralCutter(
    { kind: "scanEdit", action: "split", positions: source, target: cutter },
    { tolerance: 0.001 },
  );
  const edges = new Map<string, number>();
  for (const segment of result.segments!)
    for (let i = 0; i < segment.length; i += 9)
      for (let j = 0; j < 3; j++) {
        const a = i + 3 * j,
          b = i + 3 * ((j + 1) % 3);
        if (segment[a] === 0 && segment[b] === 0) {
          const key = [segment[a + 1], segment[b + 1]]
            .sort((x, y) => x - y)
            .join(",");
          edges.set(key, (edges.get(key) ?? 0) + 1);
        }
      }
  expect(edges.size).toBeGreaterThan(0);
  expect([...edges.values()].every((count) => count === 2)).toBe(true);
});

it.fails(
  "known gap: exactly coplanar neighboring face receives the same shared-edge subdivision",
  () => {
    const source = new Float32Array([
      0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0,
    ]);
    const cutter = new Float32Array([0, 0.1, -1, 0, 0.9, -1, 0, 0.5, 1]);
    const result = splitGeneralCutter(
      { kind: "scanEdit", action: "split", positions: source, target: cutter },
      { tolerance: 0.001 },
    );
    const edges = new Map<string, number>();
    for (const segment of result.segments!)
      for (let i = 0; i < segment.length; i += 9)
        for (let j = 0; j < 3; j++) {
          const a = i + 3 * j,
            b = i + 3 * ((j + 1) % 3);
          if (
            segment[a] === 0 &&
            segment[b] === 0 &&
            segment[a + 2] === 0 &&
            segment[b + 2] === 0
          ) {
            const key = [segment[a + 1], segment[b + 1]]
              .sort((x, y) => x - y)
              .join(",");
            edges.set(key, (edges.get(key) ?? 0) + 1);
          }
        }
    expect(edges.size).toBeGreaterThan(0);
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
  },
);
