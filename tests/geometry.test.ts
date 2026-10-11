import { describe, expect, it } from "vitest";
import {
  alignPrincipalAxes,
  cleanupMesh,
  deviations,
  fitCone,
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
  it("keeps typed scan buffers compact across statistics, sectioning and transforms", () => {
    const array = [0, 0, 0, 4, 0, 0, 0, 3, 0];
    const typed = new Float32Array(array);
    expect(meshStats(typed)).toEqual(meshStats(array));
    expect(sectionMesh(typed, "x", 2)).toEqual(sectionMesh(array, "x", 2));
    const fit = fitPlane(array);
    const typedDeviation = deviations(typed, fit);
    expect(typedDeviation).toBeInstanceOf(Float32Array);
    typedDeviation.forEach((value, i) =>
      expect(value).toBeCloseTo(deviations(array, fit)[i]!, 5),
    );
    const transformed = transformPositions(typed, [10, 20, 30], [0, 0, 90], 2);
    expect(transformed).toBeInstanceOf(Float32Array);
    const expected = transformPositions(array, [10, 20, 30], [0, 0, 90], 2);
    transformed.forEach((value, i) =>
      expect(value).toBeCloseTo(expected[i]!, 5),
    );
    expect(Array.from(typed)).toEqual(array);
    const cleaned = cleanupMesh(
      new Float32Array([...array, ...Array(9).fill(0)]),
    );
    expect(cleaned).toBeInstanceOf(Float32Array);
    expect(Array.from(cleaned)).toEqual(array);
  });

  it("fits typed coordinate samples with equivalent analytical results", () => {
    const sphere = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
    expect(fitSphere(new Float32Array(sphere))).toEqual(fitSphere(sphere));
    const cylinder: number[] = [];
    for (const z of [-2, 2])
      for (const [x, y] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        cylinder.push(x!, y!, z);
    expect(fitCylinder(new Float32Array(cylinder))).toEqual(
      fitCylinder(cylinder),
    );
  });

  it("rejects non-finite typed scan buffers before computing geometry", () => {
    const invalid = new Float32Array([0, 0, 0, 4, 0, 0, 0, Infinity, 0]);
    expect(() => meshStats(invalid)).toThrow("finite triangle coordinates");
    expect(() => cleanupMesh(invalid)).toThrow("finite triangle coordinates");
    expect(() => sectionMesh(invalid, "x", 2)).toThrow(
      "finite triangle coordinates",
    );
    expect(() => transformPositions(invalid, [0, 0, 0], [0, 0, 0], 1)).toThrow(
      "finite XYZ coordinates",
    );
  });
  it("aligns a rotated elongated scan into a centered right-handed principal frame", () => {
    const corners: number[] = [];
    for (const x of [-4, 4])
      for (const y of [-2, 2]) for (const z of [-1, 1]) corners.push(x, y, z);
    const rotated = transformPositions(corners, [17, -12, 5], [23, 31, 47], 1);
    const aligned = alignPrincipalAxes(rotated);
    aligned.center.forEach((value, i) =>
      expect(value).toBeCloseTo([17, -12, 5][i]!, 10),
    );
    for (let i = 0; i < aligned.positions.length; i += 3) {
      expect(Math.abs(aligned.positions[i]!)).toBeCloseTo(4, 9);
      expect(Math.abs(aligned.positions[i + 1]!)).toBeCloseTo(2, 9);
      expect(Math.abs(aligned.positions[i + 2]!)).toBeCloseTo(1, 9);
    }
    const [x, y, z] = aligned.axes;
    const determinant =
      x[0] * (y[1] * z[2] - y[2] * z[1]) -
      x[1] * (y[0] * z[2] - y[2] * z[0]) +
      x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(determinant).toBeCloseTo(1, 10);
    expect(
      alignPrincipalAxes(new Float32Array(rotated)).positions,
    ).toBeInstanceOf(Float32Array);
    expect(rotated).toEqual(
      transformPositions(corners, [17, -12, 5], [23, 31, 47], 1),
    );
    expect(() => alignPrincipalAxes([0, 0, 0, 1, 1, 1, 2, 2, 2])).toThrow(
      "Collinear",
    );
  });
  it.each([360, 220])(
    "recovers a rotated cone from a %s degree sampled side",
    (arc) => {
      const points: number[] = [];
      for (let layer = 0; layer <= 8; layer++) {
        const z = layer * 1.5,
          radius = 5 - z / 3;
        for (let angle = 0; angle < 32; angle++) {
          const theta = (angle * arc * Math.PI) / (32 * 180);
          points.push(radius * Math.cos(theta), radius * Math.sin(theta), z);
        }
      }
      const transformed = transformPositions(
        points,
        [20, -10, 7],
        [17, 32, 11],
        1,
      );
      const fit = fitCone(transformed);
      expect(fit.kind).toBe("cone");
      expect(fit.radius).toBeCloseTo(5, 4);
      expect(fit.topRadius).toBeCloseTo(1, 4);
      expect(fit.height).toBeCloseTo(12, 4);
      expect(fit.rms).toBeLessThan(1e-5);
      fit.center.forEach((value, i) =>
        expect(value).toBeCloseTo([20, -10, 7][i]!, 4),
      );
      const typed = fitCone(new Float32Array(transformed));
      expect(typed.radius).toBeCloseTo(5, 4);
      expect(typed.rms).toBeLessThan(1e-5);
    },
  );

  it("recovers a cone whose sampled top converges to an apex", () => {
    const side: number[] = [];
    for (let layer = 0; layer <= 6; layer++)
      for (let angle = 0; angle < 24; angle++) {
        const radius = 6 - layer,
          theta = (angle * Math.PI) / 12;
        side.push(
          radius * Math.cos(theta),
          radius * Math.sin(theta),
          layer * 2,
        );
      }
    const fit = fitCone(side);
    expect(fit.radius).toBeCloseTo(6, 6);
    expect(fit.topRadius).toBeCloseTo(0, 6);
    expect(fit.height).toBeCloseTo(12, 6);
    expect(fit.rms).toBeLessThan(1e-7);
  });

  it("reports cone signed orthogonal distance and rejects invalid cone dimensions", () => {
    const cone = {
      kind: "cone" as const,
      center: [0, 0, 0] as [number, number, number],
      axis: [0, 0, 1] as [number, number, number],
      radius: 5,
      topRadius: 1,
      height: 12,
      rms: 0,
      maxError: 0,
    };
    expect(deviations([5, 0, 0, 4, 0, 6, 2, 0, 6], cone)).toEqual([
      0,
      expect.closeTo(3 / Math.sqrt(10)),
      expect.closeTo(-3 / Math.sqrt(10)),
    ]);
    expect(() => deviations([0, 0, 0], { ...cone, height: 0 })).toThrow(
      "cone dimensions",
    );
    expect(() => deviations([0, 0, 0], { ...cone, topRadius: -1 })).toThrow(
      "cone dimensions",
    );
  });

  it("rejects a cylinder, flat circle and collinear points as tapered cones", () => {
    const cylinder: number[] = [],
      circle: number[] = [];
    for (let i = 0; i < 32; i++) {
      const x = 3 * Math.cos((i * Math.PI) / 16),
        y = 3 * Math.sin((i * Math.PI) / 16);
      circle.push(x, y, 0);
      for (const z of [0, 2, 4, 6]) cylinder.push(x, y, z);
    }
    expect(() => fitCone(cylinder)).toThrow();
    expect(() => fitCone(circle)).toThrow();
    expect(() => fitCone([0, 0, 0, 1, 1, 1, 2, 2, 2])).toThrow();
  });
});
