import { expect, it } from "vitest";
import { registerFineAlignment } from "../src/fine-registration";
import { transformPoint } from "../src/registration";
import type { Positions, Vec3 } from "../src/types";

const plane = (z: number) => {
  const points: number[] = [];
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 20; x++) points.push(x, y, z);
  return points;
};
it("bounds exact nearest-point work for unmatched regions without dropping their error", () => {
  const source = [...plane(0)];
  for (let i = 0; i < 100; i++) source.push(1e6 + i, 1e6 + i, 1e6);
  const result = registerFineAlignment(source, plane(0), {
    overlapPercent: 50,
    sampleSize: 50,
    maxDistance: 2,
  });
  expect(result.targetReached).toBe(true);
  expect(result.evaluatedPoints).toBe(500);
  expect(result.wholeCloudRms).toBeGreaterThan(100000);
  expect(result.distanceTests).toBeGreaterThan(0);
  expect(result.distanceTests).toBeLessThan(30000);
});
it("matches the full target and evaluates every source point independently of fitting samples", () => {
  const result = registerFineAlignment(plane(0), plane(0.1), {
    sampleSize: 30,
    targetSampleSize: 3,
    targetRms: 0.02,
    maxDistance: 2,
  });
  expect(result.rms).toBeLessThan(1e-8);
  expect(result.pairs).toBe(400);
  expect(result.evaluatedPoints).toBe(400);
  expect(result.targetPoints).toBe(400);
  expect(result.terminationReason).toBe("targetReached");
  expect(result.targetReached).toBe(true);
});
it("reports a plateau above the target without claiming target accuracy", () => {
  const source = plane(0);
  for (let i = 2; i < source.length; i += 3) source[i] = i % 2 ? 1 : -1;
  const result = registerFineAlignment(source, plane(0), {
    sampleSize: 400,
    trimFraction: 1,
    targetRms: 0.02,
    maxIterations: 20,
  });
  expect(result.rms).toBeGreaterThan(0.9);
  expect(result.terminationReason).toBe("stoppedImproving");
  expect(result.targetReached).toBe(false);
  expect(result.converged).toBe(true);
});
it("uses overlap accuracy while retaining untrimmed whole-cloud RMS", () => {
  const source = [...plane(0), 1000, 1000, 1000];
  const result = registerFineAlignment(source, plane(0), {
    sampleSize: 400,
    targetRms: 0.5,
    maxDistance: 2,
    trimFraction: 0.85,
  });
  expect(result.rms).toBeGreaterThan(50);
  expect(result.inlierRms).toBeLessThan(0.01);
  expect(result.rejectedPoints).toBe(1);
  expect(result.overlapFraction).toBeCloseTo(400 / 401);
  expect(result.targetReached).toBe(true);
  expect(result.overlapRms).toBe(result.inlierRms);
  expect(result.wholeCloudRms).toBe(result.rms);
  expect(result.targetRmsBasis).toBe("overlap");
});

it("exposes independent overlap percentage and actual fitting sample count", () => {
  const result = registerFineAlignment(plane(0), plane(0.1), {
    overlapPercent: 60,
    sampleSize: 37,
  });
  expect(result.overlapPercent).toBe(60);
  expect(result.sampleSize).toBe(37);
  expect(result.fittingSamples).toBe(37);
  expect(result.overlapPoints).toBe(240);
  expect(result.requiredOverlapPoints).toBe(240);
  expect(result.overlapSatisfied).toBe(true);
});

it("requires the requested source overlap instead of accepting a tiny gated subset", () => {
  const source = [...plane(0), ...plane(100)];
  const partial = registerFineAlignment(source, plane(0), {
    overlapPercent: 50,
    maxDistance: 2,
    sampleSize: 800,
    targetRms: 0.02,
  });
  expect(partial.overlapRms).toBe(0);
  expect(partial.wholeCloudRms).toBeGreaterThan(50);
  expect(partial.targetReached).toBe(true);
  const full = registerFineAlignment(source, plane(0), {
    overlapPercent: 100,
    maxDistance: 2,
    sampleSize: 800,
    targetRms: 0.02,
  });
  expect(full.overlapRms).toBe(0);
  expect(full.overlapSatisfied).toBe(false);
  expect(full.requiredOverlapPoints).toBe(800);
  expect(full.overlapPoints).toBe(400);
  expect(full.targetReached).toBe(false);
});

it("validates overlap and fitting limits and rejects ambiguous legacy settings", () => {
  for (const overlapPercent of [0, -1, 101, Infinity, NaN])
    expect(() =>
      registerFineAlignment(plane(0), plane(0), { overlapPercent }),
    ).toThrow(/overlap/i);
  for (const sampleSize of [2, 3.5, 100001])
    expect(() =>
      registerFineAlignment(plane(0), plane(0), { sampleSize }),
    ).toThrow();
  expect(() =>
    registerFineAlignment(plane(0), plane(0), {
      overlapPercent: 60,
      trimFraction: 0.85,
    }),
  ).toThrow(/overlapPercent.*trimFraction/);
});

it("retains better overlap fits above the accuracy target when more iterations run", () => {
  let state = 397;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const target = Array.from({ length: 300 }, () => random() * 10);
  const source = target.map(
    (v, i) => v + (i % 3 === 0 ? 2 : 0) + (random() - 0.5) * 3,
  );
  const options = {
    sampleSize: 12,
    overlapPercent: 50,
    targetRms: 0.00001,
    tolerance: 1e-12,
  };
  const short = registerFineAlignment(source, target, {
    ...options,
    maxIterations: 2,
  });
  const long = registerFineAlignment(source, target, {
    ...options,
    maxIterations: 6,
  });
  expect(long.overlapRms).toBeLessThanOrEqual(short.overlapRms + 1e-12);
});
it("reports iteration exhaustion and validates target RMS", () => {
  const source = plane(0);
  for (let i = 2; i < source.length; i += 3) source[i] = i % 2 ? 1 : -1;
  expect(
    registerFineAlignment(source, plane(0), {
      maxIterations: 1,
      targetRms: 0.02,
      trimFraction: 1,
    }).terminationReason,
  ).toBe("iterationLimit");
  for (const targetRms of [0, -1, NaN, Infinity])
    expect(() =>
      registerFineAlignment(source, plane(0), { targetRms }),
    ).toThrow(/target RMS/i);
});
it("honors selected regions, cancellation, and insufficient overlap", () => {
  const a = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const result = registerFineAlignment(
    [...a, 100, 100, 100, 101, 100, 100, 100, 101, 100],
    a,
    {
      sourceTriangleMask: new Uint8Array([1, 0]),
      targetRms: 0.02,
    },
  );
  expect(result.evaluatedPoints).toBe(3);
  expect(result.rms).toBe(0);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    registerFineAlignment(a, a, { signal: controller.signal }),
  ).toThrow();
  expect(() =>
    registerFineAlignment(plane(10), plane(0), { maxDistance: 1 }),
  ).toThrow(/correspondences/i);
});

it("agrees with independent brute-force final distances, including unsampled points", () => {
  const target = Array.from({ length: 60 }, (_, i) => [
    10 * Math.sin(i * 1.7),
    10 * Math.cos(i * 2.1),
    i * 0.3,
  ]).flat();
  const source = target.map((v, i) => v + 0.1 * Math.sin(i * 1.1));
  const result = registerFineAlignment(source, target, {
    sampleSize: 15,
    maxIterations: 5,
    targetRms: 0.0001,
  });
  const distances: number[] = [];
  for (let i = 0; i < source.length; i += 3) {
    const p = transformPoint(
      source.slice(i, i + 3) as Vec3,
      result.transform,
    ).map(Math.fround);
    let nearest = Infinity;
    for (let j = 0; j < target.length; j += 3)
      nearest = Math.min(
        nearest,
        (p[0] - target[j]) ** 2 +
          (p[1] - target[j + 1]) ** 2 +
          (p[2] - target[j + 2]) ** 2,
      );
    distances.push(nearest);
  }
  expect(result.rms).toBeCloseTo(
    Math.sqrt(distances.reduce((s, d) => s + d, 0) / 60),
    12,
  );
  expect(result.maxError).toBeCloseTo(Math.sqrt(Math.max(...distances)), 12);
  expect(result.evaluatedPoints).toBe(60);
});

it("does not claim accuracy lost when committed coordinates round to Float32", () => {
  const source = new Float32Array(plane(0).map((v) => v + 1e6));
  const target = source.slice();
  for (let i = 2; i < target.length; i += 3)
    if (((Math.floor(i / 3) % 20) + Math.floor(i / 60)) % 4 === 0)
      target[i] += 0.0625;
  const result = registerFineAlignment(source, target, {
    targetRms: 0.03,
    trimFraction: 1,
    sampleSize: 400,
  });
  expect(result.rms).toBeCloseTo(0.03125, 8);
  expect(result.targetReached).toBe(false);
});

it("does not worsen stored RMS when a repeated native cloud fit crosses a rounding boundary", () => {
  const source = new Float32Array(plane(0).map((v) => v + 1e6));
  const target = source.slice();
  for (let i = 2; i < target.length; i += 3)
    if (((Math.floor(i / 3) % 20) + Math.floor(i / 60)) % 4 === 0)
      target[i] += 0.0625;
  const result = registerFineAlignment(source, target, {
    targetRms: 0.03,
    trimFraction: 1,
    outputPlacement: {
      sourcePositions: source,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0.015625005355104804],
    },
  });
  expect(result.rms).toBeLessThanOrEqual(0.03125);
  expect(result.targetReached).toBe(false);
});

it("rejects oversized workspace before reading coordinates or allocating the index", () => {
  const oversized = { length: 300_000_000 } as unknown as Positions;
  expect(() => registerFineAlignment(oversized, plane(0))).toThrow(/256 MiB/);
});

it("cancels during work and reports monotonically increasing progress", () => {
  const controller = new AbortController();
  let ticks = 0;
  expect(() =>
    registerFineAlignment(plane(0), plane(0), {
      signal: controller.signal,
      onProgress: () => {
        if (++ticks === 3) controller.abort();
      },
    }),
  ).toThrow();
  let previous = 0;
  registerFineAlignment(plane(0), plane(0.1), {
    onProgress: (fraction) => {
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    },
  });
  expect(previous).toBe(1);
});
