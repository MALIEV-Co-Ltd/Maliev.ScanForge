import { describe, expect, it } from "vitest";
import {
  localBoundaryRadius,
  shrinkwrapLocalMesh,
} from "../src/scan-shrinkwrap-local";
import { analyzeMesh } from "../src/mesh-processing";

const tri = (a: number[], b: number[], c: number[]) => [...a, ...b, ...c];
it("admits a large boundary without exceeding the engine argument limit", () => {
  const boundary = Array.from(
    { length: 150_000 },
    (_, i): [number, number, number] => [i === 149_999 ? 2 : 1, 0, 0],
  );
  expect(localBoundaryRadius(boundary, [0, 0, 0])).toBe(2);
});
const ring = () => {
  const p: number[] = [];
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      if (x === 1 && y === 1) continue;
      p.push(
        ...tri([x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0]),
        ...tri([x, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]),
      );
    }
  return new Float32Array(p);
};
const base = {
  scope: "selected" as const,
  sampleInterval: 0.5,
  gapFill: 0,
  extraThickness: 0,
  maxDeviation: 0.1,
};
describe("fixed seam local ShrinkWrap", () => {
  it("requires an explicit nonempty matching binary mask", () => {
    const p = ring();
    for (const selection of [
      undefined,
      new Uint8Array(16),
      new Uint8Array(1),
      new Uint8Array(16).fill(2),
    ])
      expect(() => shrinkwrapLocalMesh(p, { ...base, selection })).toThrow(
        /selection|mask|selected/i,
      );
  });
  it("preserves outside facets bitwise, source facets and fixed seam", () => {
    const p = ring(),
      original = p.slice(),
      selection = new Uint8Array(16);
    selection[0] = 1;
    const result = shrinkwrapLocalMesh(p, {
      ...base,
      selection,
      extraThickness: 0,
    });
    expect(result.positions.slice(0, 15 * 9)).toEqual(p.slice(9));
    expect(p).toEqual(original);
    const fixed = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ];
    const generated = Array.from(result.positions.slice(15 * 9));
    for (const point of fixed)
      expect(
        Array.from({ length: generated.length / 3 }, (_, i) =>
          generated.slice(i * 3, i * 3 + 3),
        ),
      ).toContainEqual(point);
    expect(Math.max(...generated.filter((_, i) => i % 3 === 2))).toBe(0);
    expect(result.diagnostics?.wholeResultWatertight).toBe(false);
  });
  it("closes only eligible selected holes and controls generated density", () => {
    const p = ring(),
      selection = new Uint8Array(16).fill(1);
    const no = shrinkwrapLocalMesh(p, { ...base, selection });
    const yes = shrinkwrapLocalMesh(p, { ...base, selection, gapFill: 1.5 });
    const fine = shrinkwrapLocalMesh(p, {
      ...base,
      selection,
      gapFill: 1.5,
      sampleInterval: 0.2,
    });
    expect(analyzeMesh(no.positions).boundaryLoops.length).toBe(2);
    expect(analyzeMesh(yes.positions).boundaryLoops.length).toBe(1);
    expect(fine.positions.length).toBeGreaterThan(yes.positions.length);
    expect(yes.diagnostics?.filledHoles).toBe(1);
    expect(yes.diagnostics?.wholeResultWatertight).toBe(false);
  });
  it("isolated mask never changes hidden facets and reports disconnected regions", () => {
    const p = new Float32Array([
      ...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ...tri([4, 0, 0], [5, 0, 0], [4, 1, 0]),
      ...tri([8, 0, 0], [9, 0, 0], [8, 1, 0]),
    ]);
    const r = shrinkwrapLocalMesh(p, {
      ...base,
      scope: "isolated",
      selection: new Uint8Array([1, 0, 1]),
    });
    expect(r.positions.slice(0, 9)).toEqual(p.slice(9, 18));
    expect(r.diagnostics?.selectedComponents).toBe(2);
  });
  it("keeps thin parallel source sheets separate at zero thickness", () => {
    const p = new Float32Array([
      ...tri([0, 0, 0], [1, 0, 0], [0, 1, 0]),
      ...tri([0, 0, 0.02], [0, 1, 0.02], [1, 0, 0.02]),
    ]);
    const r = shrinkwrapLocalMesh(p, {
      ...base,
      selection: new Uint8Array([1, 1]),
    });
    expect(analyzeMesh(r.positions).components.length).toBe(2);
    expect(r.diagnostics?.achievedMaxDeviation).toBeLessThan(1e-6);
  });
  it("cancels without modifying source", () => {
    const p = ring(),
      copy = p.slice(),
      controller = new AbortController();
    controller.abort();
    expect(() =>
      shrinkwrapLocalMesh(p, {
        ...base,
        selection: new Uint8Array(16).fill(1),
        signal: controller.signal,
      }),
    ).toThrow(/cancel/i);
    expect(p).toEqual(copy);
  });
  it("keeps unrelated parent holes and reports closure as unverified", () => {
    const first = ring(),
      second = ring();
    for (let i = 0; i < second.length; i += 3) second[i] += 10;
    const p = new Float32Array([...first, ...second]);
    const mask = new Uint8Array(32);
    mask.fill(1, 0, 16);
    const r = shrinkwrapLocalMesh(p, {
      ...base,
      selection: mask,
      gapFill: 1.5,
    });
    expect(r.positions.slice(0, second.length)).toEqual(second);
    expect(analyzeMesh(r.positions).boundaryLoops.length).toBe(3);
    expect(r.diagnostics?.wholeResultWatertight).toBe(false);
    expect(r.diagnostics?.generatedHoleTriangles).toBeGreaterThan(0);
    expect(r.diagnostics?.refinedSourceTriangles).toBeGreaterThan(0);
    expect(r.diagnostics?.selectedPatchTopologyVerified).toBe(true);
  });
  it("organic continuation affects generated holes while retaining measured samples", () => {
    const p = ring();
    for (let i = 0; i < p.length; i += 3)
      p[i + 2] = 0.1 * ((p[i] - 1.5) ** 2 + (p[i + 1] - 1.5) ** 2);
    const selection = new Uint8Array(16).fill(1);
    const flat = shrinkwrapLocalMesh(p, { ...base, selection, gapFill: 1.5 });
    const organic = shrinkwrapLocalMesh(p, {
      ...base,
      selection,
      gapFill: 1.5,
      organicShape: true,
    });
    expect(organic.positions).not.toEqual(flat.positions);
    const keys = new Set<string>();
    for (let i = 0; i < organic.positions.length; i += 3)
      keys.add(Array.from(organic.positions.slice(i, i + 3)).join(","));
    for (let i = 0; i < p.length; i += 3)
      expect(keys.has(Array.from(p.slice(i, i + 3)).join(","))).toBe(true);
    expect(organic.diagnostics?.achievedMaxDeviation).toBeLessThan(0.00001);
  });
  it("rejects invalid settings and unrepresentable outside coordinates before changing source", () => {
    const p = ring(),
      selection = new Uint8Array(16).fill(1);
    for (const bad of [
      { sampleInterval: 0 },
      { gapFill: -1 },
      { extraThickness: -1 },
      { maxDeviation: 0 },
      { sampleInterval: Infinity },
    ])
      expect(() =>
        shrinkwrapLocalMesh(p, { ...base, selection, ...bad }),
      ).toThrow();
    const doubles = Array.from(p);
    doubles[doubles.length - 1] = Math.PI;
    selection[15] = 0;
    expect(() => shrinkwrapLocalMesh(doubles, { ...base, selection })).toThrow(
      /Float32/,
    );
    expect(doubles.at(-1)).toBe(Math.PI);
  });
  it("rejects a region too narrow to attain requested thickness", () => {
    const p = ring(),
      selection = new Uint8Array(16);
    selection[0] = 1;
    expect(() =>
      shrinkwrapLocalMesh(p, { ...base, selection, extraThickness: 0.2 }),
    ).toThrow(/grow|accommodate/);
  });
  it("attains full thickness inside a broad region and tapers to its fixed seam", () => {
    const values: number[] = [],
      mask: number[] = [];
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        values.push(
          ...tri([x, y, 0], [x + 1, y, 0], [x + 1, y + 1, 0]),
          ...tri([x, y, 0], [x + 1, y + 1, 0], [x, y + 1, 0]),
        );
        const chosen = x >= 1 && x < 5 && y >= 1 && y < 5 ? 1 : 0;
        mask.push(chosen, chosen);
      }
    const p = new Float32Array(values),
      selection = new Uint8Array(mask);
    const r = shrinkwrapLocalMesh(p, {
      ...base,
      selection,
      extraThickness: 0.2,
    });
    const outside: number[] = [];
    mask.forEach((chosen, i) => {
      if (!chosen) outside.push(...p.slice(i * 9, i * 9 + 9));
    });
    expect(r.positions.slice(0, outside.length)).toEqual(
      new Float32Array(outside),
    );
    const local = r.positions.slice(outside.length),
      heights: number[] = [];
    for (let i = 0; i < local.length; i += 3) {
      heights.push(local[i + 2]);
      if (
        local[i] === 1 ||
        local[i] === 5 ||
        local[i + 1] === 1 ||
        local[i + 1] === 5
      )
        expect(local[i + 2]).toBe(0);
    }
    expect(Math.max(...heights)).toBeCloseTo(0.2, 6);
    expect(r.diagnostics?.maximumAppliedOffset).toBe(0.2);
  });
});
