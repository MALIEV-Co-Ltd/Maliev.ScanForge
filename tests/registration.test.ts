import { describe, expect, it } from "vitest";
import {
  applyRigidTransform,
  identityTransform,
  registerIcp,
  registerGlobal,
  registerPairedPoints,
  transformPoint,
  type RigidTransform,
} from "../src/registration";
import type { Vec3 } from "../src/types";

const source = [0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 4, 1, 2, 3, -2, 0, 1];
const pose: RigidTransform = {
  rotation: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  translation: [7, -3, 2],
};
function transformed(input: number[], transform: RigidTransform): number[] {
  const output: number[] = [];
  for (let i = 0; i < input.length; i += 3)
    output.push(...transformPoint(input.slice(i, i + 3) as Vec3, transform));
  return output;
}

describe("rigid scan registration", () => {
  it("recovers a rotation and translation from paired 3D landmarks", () => {
    const target = transformed(source, pose);
    const result = registerPairedPoints(source, target);
    expect(result.rms).toBeLessThan(1e-10);
    expect(result.maxError).toBeLessThan(1e-10);
    result.transform.rotation.forEach((value, i) =>
      expect(value).toBeCloseTo(pose.rotation[i], 10),
    );
    result.transform.translation.forEach((value, i) =>
      expect(value).toBeCloseTo(pose.translation[i], 10),
    );
    expect(result.pairs).toBe(6);
    expect(result.converged).toBe(true);
    const output = applyRigidTransform(
      new Float32Array(source),
      result.transform,
    );
    output.forEach((value, i) => expect(value).toBeCloseTo(target[i], 5));
  });
  it("supports noncollinear planar landmarks and reports noisy-fit residual", () => {
    const plane = [0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 2, 0];
    const target = transformed(plane, pose);
    expect(registerPairedPoints(plane, target).rms).toBeLessThan(1e-10);
    const noisy = [...target];
    noisy[0] += 0.1;
    const result = registerPairedPoints(plane, noisy);
    expect(result.rms).toBeGreaterThan(0);
    expect(result.rms).toBeLessThan(0.1);
  });
  it("handles large world offsets without losing paired-point precision", () => {
    const shifted = source.map((value, i) => value + [1e8, -2e8, 3e8][i % 3]);
    const target = transformed(shifted, pose);
    expect(registerPairedPoints(shifted, target).rms).toBeLessThan(1e-6);
  });
  it("ICP converges for an approximately aligned asymmetric cloud and leaves inputs intact", () => {
    const slight: RigidTransform = {
      rotation: [
        Math.cos(0.02),
        -Math.sin(0.02),
        0,
        Math.sin(0.02),
        Math.cos(0.02),
        0,
        0,
        0,
        1,
      ],
      translation: [0.05, -0.04, 0.03],
    };
    const target = transformed(source, slight);
    const result = registerIcp(source, target, {
      trimFraction: 1,
      tolerance: 1e-8,
      sampleSize: 100,
      targetSampleSize: 100,
    });
    expect(result.converged).toBe(true);
    expect(result.rms).toBeLessThan(1e-8);
    expect(result.pairs).toBe(6);
    expect(source[0]).toBe(0);
  });
  it("ICP honors initial pose, bounded iterations, and correspondence rejection", () => {
    const target = transformed(source, pose);
    const result = registerIcp(source, target, {
      initial: pose,
      maxIterations: 1,
      trimFraction: 1,
      tolerance: 1e-8,
    });
    expect(result.iterations).toBe(1);
    expect(result.rms).toBeLessThan(1e-8);
    expect(() => registerIcp(source, target, { maxDistance: 0.001 })).toThrow(
      /correspondences/,
    );
  });
  it("rejects collinear, mismatched, nonfinite and invalid rigid transforms", () => {
    expect(() =>
      registerPairedPoints(
        [0, 0, 0, 1, 0, 0, 2, 0, 0],
        [0, 0, 0, 1, 0, 0, 2, 0, 0],
      ),
    ).toThrow(/Collinear/);
    expect(() => registerPairedPoints(source, source.slice(0, 9))).toThrow(
      /counts/,
    );
    expect(() =>
      registerPairedPoints([...source.slice(0, -1), Infinity], source),
    ).toThrow(/finite/);
    expect(() => registerIcp(source, source, { sampleSize: 2 })).toThrow(
      /Invalid/,
    );
    expect(() =>
      registerIcp(source, source, {
        initial: {
          rotation: [-1, 0, 0, 0, 1, 0, 0, 0, 1],
          translation: [0, 0, 0],
        },
      }),
    ).toThrow(/proper rotation/);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      registerIcp(source, source, { signal: controller.signal }),
    ).toThrow(/cancelled/);
    expect(identityTransform().translation).toEqual([0, 0, 0]);
  });
});

describe("global principal-axis initialization", () => {
  it("recovers a large arbitrary 3D rotation and translation without paired ordering", () => {
    const axis = [1 / Math.sqrt(14), 2 / Math.sqrt(14), 3 / Math.sqrt(14)];
    const angle = 2.13,
      c = Math.cos(angle),
      s = Math.sin(angle),
      v = 1 - c;
    const [x, y, z] = axis;
    const rotated: RigidTransform = {
      rotation: [
        c + x * x * v,
        x * y * v - z * s,
        x * z * v + y * s,
        y * x * v + z * s,
        c + y * y * v,
        y * z * v - x * s,
        z * x * v - y * s,
        z * y * v + x * s,
        c + z * z * v,
      ],
      translation: [80, -40, 27],
    };
    const cloud = [...source, 5, 1, 2, -1, 4, -2, 2, -3, 1];
    const raw = transformed(cloud, rotated);
    const target: number[] = [];
    for (let i = raw.length - 3; i >= 0; i -= 3)
      target.push(...raw.slice(i, i + 3));
    const result = registerGlobal(cloud, target, {
      trimFraction: 1,
      tolerance: 1e-8,
      maxDistance: 10,
    });
    expect(result.globalCandidates).toBe(24);
    expect(result.converged).toBe(true);
    expect(result.rms).toBeLessThan(1e-8);
    expect(result.coarseRms).toBeLessThan(1e-8);
    result.transform.rotation.forEach((value, i) =>
      expect(value).toBeCloseTo(rotated.rotation[i], 7),
    );
    result.transform.translation.forEach((value, i) =>
      expect(value).toBeCloseTo(rotated.translation[i], 7),
    );
    expect(cloud.slice(0, 3)).toEqual([0, 0, 0]);
  });
  it("reports ambiguous principal axes on symmetric planar scans", () => {
    const plane = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
    const target = transformed(plane, pose);
    const result = registerGlobal(plane, target, {
      trimFraction: 1,
      maxDistance: 10,
    });
    expect(result.principalAxesAmbiguous).toBe(true);
    expect(result.rms).toBeLessThan(1e-8);
  });
  it("rejects degenerate clouds and invalid bounded-search options", () => {
    expect(() => registerGlobal([0, 0, 0, 1, 0, 0, 2, 0, 0], source)).toThrow(
      /Collinear/,
    );
    expect(() => registerGlobal([0, 0, 0, 0, 0, 0, 0, 0, 0], source)).toThrow(
      /spread/,
    );
    expect(() =>
      registerGlobal(source, source, { coarseSampleSize: 2 }),
    ).toThrow(/coarse samples/);
    expect(() =>
      registerGlobal(source, source, { refinementCandidates: 25 }),
    ).toThrow(/24/);
    expect(() =>
      registerGlobal(source, source, { targetSampleSize: 2 }),
    ).toThrow(/sampling/);
    expect(() => registerGlobal(source, [...source.slice(0, -1), NaN])).toThrow(
      /finite/,
    );
  });
  it("stops global candidate search when cancelled from progress", () => {
    const controller = new AbortController();
    expect(() =>
      registerGlobal(source, transformed(source, pose), {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).toThrow(/cancelled/);
  });
});
