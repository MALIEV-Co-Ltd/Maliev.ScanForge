import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  averageScanMesh,
  flipScanNormals,
  mirrorScanMesh,
  scaleScanMesh,
  unrollScanMesh,
} from "../src/scan-tools-transforms";
import type { Vec3 } from "../src/types";

const triangle = [0, 0, 0, 2, 0, 0, 0, 2, 0];
const normal = (p: ArrayLike<number>) =>
  new Vector3()
    .crossVectors(
      new Vector3(p[3] - p[0], p[4] - p[1], p[5] - p[2]),
      new Vector3(p[6] - p[0], p[7] - p[1], p[8] - p[2]),
    )
    .normalize();
describe("Scan Data geometric transforms", () => {
  it("scales about the origin or a chosen center without mutating source", () => {
    expect(
      Array.from(scaleScanMesh(triangle, { factor: 2 }).positions),
    ).toEqual([0, 0, 0, 4, 0, 0, 0, 4, 0]);
    expect(
      Array.from(
        scaleScanMesh(triangle, { factor: 2, center: [1, 1, 1] }).positions,
      ),
    ).toEqual([-1, -1, -1, 3, -1, -1, -1, 3, -1]);
    expect(triangle).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  });
  it("flips winding and normals, and restores after two flips", () => {
    const out = flipScanNormals(triangle).positions;
    expect(normal(out).z).toBe(-1);
    expect(Array.from(flipScanNormals(out).positions)).toEqual(triangle);
  });
  it("reflects across a nonorigin tilted plane and preserves outward winding", () => {
    const out = mirrorScanMesh(triangle, {
      center: [1, 0, 0],
      normal: [1, 1, 0],
    }).positions;
    [1, 1, 0, -1, 1, 0, 1, -1, 0].forEach((expected, index) =>
      expect(out[index]).toBeCloseTo(expected, 6),
    );
    expect(normal(out).z).toBe(1);
  });
  it("averages closest surface interiors rather than target vertices", () => {
    const source = [1, 1, 2, 2, 1, 2, 1, 2, 2];
    const target = [-100, -100, 0, 100, -100, 0, 0, 100, 0];
    const out = averageScanMesh(source, { targets: [target] }).positions;
    expect(Array.from(out)).toEqual([1, 1, 1, 2, 1, 1, 1, 2, 1]);
    expect(source[2]).toBe(2);
  });
  it("averages each matched reference equally and preserves unmatched vertices", () => {
    const a = triangle.map((v, i) => (i % 3 === 2 ? 2 : v)),
      b = triangle.map((v, i) => (i % 3 === 2 ? 4 : v));
    expect(
      averageScanMesh(triangle, { targets: [a, b], tolerance: 5 }).positions[2],
    ).toBe(2);
    expect(
      Array.from(
        averageScanMesh(triangle, { targets: [a], tolerance: 1 }).positions,
      ),
    ).toEqual(triangle);
  });
  it("unrolls arc length, axial distance and radial residual", () => {
    const p = [2, 0, 3, 0, 2, 3, 2, 0, 5];
    const out = unrollScanMesh(p, {
      center: [0, 0, 1],
      axis: [0, 0, 2],
      radius: 1,
    }).positions;
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBe(2);
    expect(out[2]).toBe(1);
    expect(out[3]).toBeCloseTo(Math.PI / 2);
    expect(out[7]).toBe(4);
  });
  it("handles a tilted cylinder with deterministic radial frame and nonorigin center", () => {
    const center = new Vector3(3, 4, 5),
      axis = new Vector3(1, 1, 1).normalize();
    const u = new Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize(),
      v = new Vector3().crossVectors(axis, u);
    const points = [
      [0, 2],
      [0.5, 2],
      [0, 4],
    ].flatMap(([a, z]) =>
      center
        .clone()
        .addScaledVector(axis, z)
        .addScaledVector(u, 2 * Math.cos(a))
        .addScaledVector(v, 2 * Math.sin(a))
        .toArray(),
    );
    const out = unrollScanMesh(points, {
      center: center.toArray() as Vec3,
      axis: axis.toArray() as Vec3,
      radius: 2,
    }).positions;
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo(1);
    expect(out[7]).toBeCloseTo(4);
  });
  it("splits triangles crossing the seam instead of producing circumference-spanning faces", () => {
    const r = 10,
      points = [
        [-0.1, 0],
        [0.1, 0],
        [0.1, 2],
      ].flatMap(([a, z]) => [r * Math.cos(a), r * Math.sin(a), z]);
    const out = unrollScanMesh(points, {
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: r,
    }).positions;
    expect(out.length).toBeGreaterThan(9);
    for (let i = 0; i < out.length; i += 9) {
      const xs = [out[i], out[i + 3], out[i + 6]];
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2.01);
    }
    const offset = unrollScanMesh(points, {
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: r,
      offsetDegrees: 180,
    }).positions;
    expect(offset.length).toBe(9);
  });
  it("rejects invalid, overflowing and ambiguous geometry", () => {
    expect(() => scaleScanMesh(triangle, { factor: 0 })).toThrow();
    expect(() => scaleScanMesh(triangle, { factor: 1e40 })).toThrow(/Float32/);
    expect(() => flipScanNormals([NaN, ...triangle.slice(1)])).toThrow();
    expect(() =>
      mirrorScanMesh(triangle, { center: [0, 0, 0], normal: [0, 0, 0] }),
    ).toThrow();
    expect(() => averageScanMesh(triangle, { targets: [] })).toThrow();
    expect(() =>
      unrollScanMesh(triangle, {
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 1,
      }),
    ).toThrow(/axis/);
    expect(() =>
      unrollScanMesh([1, 0, 0, -1, 0, 0, 0, 1, 1], {
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 1,
      }),
    ).toThrow(/180/);
  });
  it("honors cancellation and reports finite progress", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      flipScanNormals(triangle, { signal: controller.signal }),
    ).toThrow(/cancelled/);
    const progress: number[] = [];
    scaleScanMesh(triangle, { factor: 1, onProgress: (f) => progress.push(f) });
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
  it("rejects cap-only and mixed sidewall/cap meshes instead of dropping faces", () => {
    const cap = [
      1,
      0,
      0,
      Math.cos(0.5),
      Math.sin(0.5),
      0,
      Math.cos(1),
      Math.sin(1),
      0,
    ];
    const sidewall = [1, 0, 0, Math.cos(0.5), Math.sin(0.5), 0, 1, 0, 2];
    const options = {
      center: [0, 0, 0] as Vec3,
      axis: [0, 0, 1] as Vec3,
      radius: 1,
    };
    expect(() => unrollScanMesh(cap, options)).toThrow(/cap or collapsed/);
    expect(() => unrollScanMesh([...sidewall, ...cap], options)).toThrow(
      /cap or collapsed/,
    );
    expect(cap.length).toBe(9);
  });
  it("rejects final triangle collapse from an extremely small cylinder radius", () => {
    expect(() =>
      unrollScanMesh([1, 0, 0, 0, 1, 0, 1, 0, 2], {
        center: [0, 0, 0],
        axis: [0, 0, 1],
        radius: 1e-50,
      }),
    ).toThrow(/Float32 precision/);
  });
  it("rejects scale underflow and mirror precision collapse", () => {
    expect(() => scaleScanMesh(triangle, { factor: 1e-46 })).toThrow(
      /Float32 precision/,
    );
    expect(() =>
      mirrorScanMesh(triangle, { center: [1e10, 0, 0], normal: [1, 0, 0] }),
    ).toThrow(/Float32 precision/);
  });
});
