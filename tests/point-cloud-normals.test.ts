import { expect, it } from "vitest";
import { preparePointCloudNormals } from "../src/point-cloud-normals";

it("normalizes explicitly provided orientations without changing source arrays", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, -2, 0, 3, 0, 4, 0, 0]);
  const result = preparePointCloudNormals(positions, normals, {
    mode: "provided",
  });
  expect(Array.from(result.normals)).toEqual([0, 0, -1, 0, 1, 0, 1, 0, 0]);
  expect(Array.from(normals)).toEqual([0, 0, -2, 0, 3, 0, 4, 0, 0]);
  expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

it("rejects missing, nonfinite, zero and mismatched provided normals", () => {
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  for (const normals of [
    undefined,
    new Float32Array(9),
    new Float32Array([0, 0, NaN, 0, 0, 1, 0, 0, 1]),
    new Float32Array([0, 0, 1]),
  ])
    expect(() =>
      preparePointCloudNormals(p, normals, { mode: "provided" }),
    ).toThrow();
  expect(() =>
    preparePointCloudNormals(
      new Float32Array([NaN, 0, 0]),
      new Float32Array([0, 0, 1]),
      { mode: "provided" },
    ),
  ).toThrow();
});

it("estimates a translated sphere with independently known outward normals", () => {
  const p = new Float32Array(1500 * 3);
  for (let i = 0; i < 1500; i++) {
    const z = 1 - (2 * (i + 0.5)) / 1500,
      r = Math.sqrt(1 - z * z),
      a = i * Math.PI * (3 - Math.sqrt(5));
    p.set(
      [12 + 3 * r * Math.cos(a), -7 + 3 * r * Math.sin(a), 5 + 3 * z],
      i * 3,
    );
  }
  const before = p.slice();
  const result = preparePointCloudNormals(p, undefined, {
    mode: "estimate-outward",
    neighbors: 24,
  });
  let minimumDot = 1;
  for (let i = 0; i < 1500; i++) {
    const n = result.normals.subarray(i * 3, i * 3 + 3);
    expect(Math.hypot(...n)).toBeCloseTo(1, 6);
    minimumDot = Math.min(
      minimumDot,
      (n[0] * (p[i * 3] - 12) +
        n[1] * (p[i * 3 + 1] + 7) +
        n[2] * (p[i * 3 + 2] - 5)) /
        3,
    );
  }
  expect(minimumDot).toBeGreaterThan(0.995);
  expect(p).toEqual(before);
  expect(result.diagnostics.orientationAssumption).toMatch(/closed surface/);
  expect(
    preparePointCloudNormals(p, undefined, {
      mode: "estimate-outward",
      neighbors: 24,
    }).normals,
  ).toEqual(result.normals);
});

it("orients a planar scan toward an explicit scanner viewpoint", () => {
  const p: number[] = [];
  for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) p.push(x, y, 2);
  const result = preparePointCloudNormals(new Float32Array(p), undefined, {
    mode: "estimate-viewpoint",
    viewpoint: [0, 0, -8],
    neighbors: 12,
  });
  for (let i = 2; i < result.normals.length; i += 3)
    expect(result.normals[i]).toBeCloseTo(-1, 6);
  expect(() =>
    preparePointCloudNormals(new Float32Array(p), undefined, {
      mode: "estimate-viewpoint",
    }),
  ).toThrow();
  expect(() =>
    preparePointCloudNormals(new Float32Array(p), undefined, {
      mode: "estimate-outward",
    }),
  ).toThrow(/orientation/i);
});

it("rejects collinear and duplicate-only PCA neighborhoods", () => {
  const line = new Float32Array(90);
  for (let i = 0; i < 30; i++) line[i * 3] = i;
  for (const p of [line, new Float32Array(90)])
    expect(() =>
      preparePointCloudNormals(p, undefined, { mode: "estimate-outward" }),
    ).toThrow(/degenerate/i);
});

it("preserves inward-facing tube normals through torus concavities", () => {
  const p: number[] = [],
    truth: number[] = [];
  for (let u = 0; u < 96; u++)
    for (let v = 0; v < 32; v++) {
      const a = (u * Math.PI * 2) / 96,
        b = (v * Math.PI * 2) / 32;
      p.push(
        (3 + Math.cos(b)) * Math.cos(a),
        (3 + Math.cos(b)) * Math.sin(a),
        Math.sin(b),
      );
      truth.push(
        Math.cos(b) * Math.cos(a),
        Math.cos(b) * Math.sin(a),
        Math.sin(b),
      );
    }
  const result = preparePointCloudNormals(new Float32Array(p), undefined, {
    mode: "estimate-outward",
  });
  let minimum = 1;
  for (let i = 0; i < p.length; i += 3)
    minimum = Math.min(
      minimum,
      truth[i] * result.normals[i] +
        truth[i + 1] * result.normals[i + 1] +
        truth[i + 2] * result.normals[i + 2],
    );
  expect(minimum).toBeGreaterThan(0.97);
});

it("checks cancellation and reports progress without mutating supplied normals", () => {
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    n = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  expect(() =>
    preparePointCloudNormals(p, n, {
      mode: "provided",
      isCancelled: () => true,
    }),
  ).toThrow(/cancel/i);
  const progress: number[] = [];
  preparePointCloudNormals(p, n, {
    mode: "provided",
    onProgress: (v) => progress.push(v),
  });
  expect(progress[0]).toBe(0);
  expect(progress.at(-1)).toBe(1);
  expect(progress.every((v, i) => i === 0 || v >= progress[i - 1])).toBe(true);
});
it("estimates every point while anchoring component orientation to valid supplied normals", () => {
  const p: number[] = [],
    n: number[] = [];
  for (let x = -3; x <= 3; x++)
    for (let y = -3; y <= 3; y++) {
      p.push(x, y, 2);
      n.push(0, 0, -2);
    }
  n[2] = 0;
  n[5] = NaN;
  const normals = new Float32Array(n),
    copy = normals.slice();
  const result = preparePointCloudNormals(new Float32Array(p), normals, {
    mode: "estimate-provided",
  });
  expect(result.normals.length).toBe(p.length);
  for (let i = 2; i < result.normals.length; i += 3)
    expect(result.normals[i]).toBeCloseTo(-1, 6);
  expect(result.diagnostics).toMatchObject({
    orientationAnchors: 47,
    invalidOrientationAnchors: 2,
  });
  expect(normals).toEqual(copy);
  expect(() =>
    preparePointCloudNormals(new Float32Array(p), new Float32Array(n.length), {
      mode: "estimate-provided",
    }),
  ).toThrow(/anchor|orientation/i);
});
