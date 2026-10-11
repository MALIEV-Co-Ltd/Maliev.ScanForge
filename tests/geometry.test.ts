import { describe, expect, it } from "vitest";
import {
  cleanupMesh,
  deviations,
  fitCylinder,
  fitPlane,
  fitSphere,
  meshStats,
  sectionMesh,
  transformPositions,
} from "../src/geometry";

describe("independent analytical geometry", () => {
  it("measures a triangle and computes an exact section", () => {
    const triangle = [0, 0, 0, 4, 0, 0, 0, 3, 0];
    const stats = meshStats(triangle);
    expect(stats.area).toBe(6);
    expect(stats.triangles).toBe(1);
    expect(stats.size).toEqual([4, 3, 0]);
    const section = sectionMesh(triangle, "x", 2);
    expect(section.length).toBeCloseTo(1.5);
    expect(section.segments).toHaveLength(6);
    expect(section.segments[0]).toBe(2);
    expect(section.segments[3]).toBe(2);
    expect(sectionMesh(triangle, "x", 5).segments).toEqual([]);
    expect(sectionMesh(triangle, "z", 0).segments).toEqual([]);
  });

  it("deduplicates a section along a shared edge and rejects tangencies", () => {
    const mesh = [0, 0, 0, 0, 2, 0, 1, 1, 1, 0, 2, 0, 0, 0, 0, -1, 1, 1];
    expect(sectionMesh(mesh, "x", 0).length).toBeCloseTo(2);
    expect(sectionMesh(mesh, "z", 1).segments).toEqual([]);
  });

  it("computes translation-invariant closed tetrahedron volume", () => {
    const tetrahedron = [
      0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
      1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
    ];
    expect(meshStats(tetrahedron).volume).toBeCloseTo(1 / 6);
    const translated = transformPositions(
      tetrahedron,
      [1e6, -1e6, 1e6],
      [0, 0, 0],
      1,
    );
    expect(meshStats(translated).volume).toBeCloseTo(1 / 6);
  });

  it("fits an oblique plane through translated points using PCA", () => {
    const positions: number[] = [];
    for (let x = -3; x <= 3; x++)
      for (let y = -2; y <= 2; y++)
        positions.push(x + 100, y - 50, 2 * x - 3 * y + 10);
    const fit = fitPlane(positions);
    expect(fit.rms).toBeLessThan(1e-10);
    const expected = [2, -3, -1].map((n) => n / Math.sqrt(14));
    const alignment = fit.axis.reduce((sum, n, i) => sum + n * expected[i]!, 0);
    expect(Math.abs(alignment)).toBeCloseTo(1, 10);
    expect(Math.abs(deviations([100, -50, 11], fit)[0]!)).toBeCloseTo(
      1 / Math.sqrt(14),
    );
  });

  it("recovers sphere center and radius, and signed radial deviations", () => {
    const positions: number[] = [];
    for (let lat = 1; lat < 10; lat++)
      for (let lon = 0; lon < 16; lon++) {
        const theta = (lat * Math.PI) / 10,
          phi = (lon * Math.PI) / 8;
        positions.push(
          11 + 7 * Math.sin(theta) * Math.cos(phi),
          -3 + 7 * Math.sin(theta) * Math.sin(phi),
          5 + 7 * Math.cos(theta),
        );
      }
    const fit = fitSphere(positions);
    expect(fit.center[0]).toBeCloseTo(11, 10);
    expect(fit.center[1]).toBeCloseTo(-3, 10);
    expect(fit.center[2]).toBeCloseTo(5, 10);
    expect(fit.radius).toBeCloseTo(7, 10);
    expect(fit.rms).toBeLessThan(1e-10);
    expect(deviations([11, -3, 5, 20, -3, 5], fit)).toEqual(
      expect.arrayContaining([expect.closeTo(-7), expect.closeTo(2)]),
    );
  });

  it.each([2, 20])("fits a rotated cylinder with height %s", (height) => {
    const positions: number[] = [];
    for (const z of [-height / 2, 0, height / 2])
      for (let i = 0; i < 40; i++)
        positions.push(
          4 * Math.cos((i * Math.PI) / 20),
          4 * Math.sin((i * Math.PI) / 20),
          z,
        );
    const transformed = transformPositions(
      positions,
      [50, -20, 3],
      [25, 35, 15],
      1,
    );
    const fit = fitCylinder(transformed);
    expect(fit.rms).toBeLessThan(1e-9);
    expect(fit.radius).toBeCloseTo(4, 9);
    expect(fit.height).toBeCloseTo(height, 9);
    fit.center.forEach((n, i) => expect(n).toBeCloseTo([50, -20, 3][i]!, 9));
  });

  it("applies scale then XYZ rotations then translation without mutating input", () => {
    const input = [1, 0, 0];
    const result = transformPositions(input, [10, 20, 30], [0, 0, 90], 2);
    expect(result[0]).toBeCloseTo(10);
    expect(result[1]).toBeCloseTo(22);
    expect(result[2]).toBeCloseTo(30);
    expect(input).toEqual([1, 0, 0]);
    expect(
      transformPositions([0, 1, 0], [0, 0, 0], [90, 90, 0], 1)[0],
    ).toBeCloseTo(1);
  });

  it("removes collapsed and collinear triangles while retaining valid small geometry", () => {
    const valid = [0, 0, 0, 1e-8, 0, 0, 0, 1e-8, 0];
    expect(
      cleanupMesh([...valid, 0, 0, 0, 1, 1, 1, 2, 2, 2, ...Array(9).fill(0)]),
    ).toEqual(valid);
  });

  it("rejects malformed, non-finite and underdetermined fits", () => {
    for (const fit of [fitPlane, fitSphere, fitCylinder]) {
      expect(() => fit([])).toThrow();
      expect(() => fit([0, 0, NaN])).toThrow();
      expect(() => fit([0, 0, 0, 1, 1, 1, 2, 2, 2])).toThrow();
    }
    const planar = [1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0];
    expect(() => fitSphere(planar)).toThrow();
    expect(() => fitCylinder(planar)).toThrow();
    expect(() => meshStats([0, 0, 0])).toThrow();
    expect(() => sectionMesh(Array(9).fill(0), "z", Infinity)).toThrow();
    expect(() =>
      transformPositions([0, 0, 0], [0, 0, 0], [0, 0, 0], 0),
    ).toThrow();
  });
});
