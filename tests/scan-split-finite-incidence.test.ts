import { expect, it } from "vitest";
import { analyzeFiniteCutIncidence } from "../src/scan-split-finite-incidence";

it("distinguishes separating, nonseparating and boundary cut edges", () => {
  const triangles = new Uint32Array([
    0, 1, 2, 1, 0, 3, 4, 5, 6, 5, 4, 7, 8, 9, 10,
  ]);
  const groups = new Uint32Array([0, 1, 2, 2, 4]);
  const cuts = new Uint32Array([0, 1, 4, 5, 8, 9]);
  expect(analyzeFiniteCutIncidence(triangles, cuts, groups)).toEqual([
    { edge: [0, 1], faces: [0, 1], groups: [0, 1], kind: "separating" },
    { edge: [4, 5], faces: [2, 3], groups: [2, 2], kind: "nonseparating" },
    { edge: [8, 9], faces: [4], groups: [4], kind: "boundary" },
  ]);
});

it("deduplicates a shared cut edge regardless of direction", () => {
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const result = analyzeFiniteCutIncidence(
    triangles,
    new Uint32Array([0, 1, 1, 0]),
    new Uint32Array([0, 1]),
  );
  expect(result).toEqual([
    { edge: [0, 1], faces: [0, 1], groups: [0, 1], kind: "separating" },
  ]);
});

it("rejects missing and nonmanifold cut incidence", () => {
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]);
  expect(() =>
    analyzeFiniteCutIncidence(
      triangles,
      new Uint32Array([0, 1]),
      new Uint32Array([0, 1, 2]),
    ),
  ).toThrow(/non.manifold/i);
  expect(() =>
    analyzeFiniteCutIncidence(
      triangles.slice(0, 6),
      new Uint32Array([0, 7]),
      new Uint32Array([0, 1]),
    ),
  ).toThrow(/missing/i);
});

it("honors abort and the work limit", () => {
  const triangles = new Uint32Array([0, 1, 2]);
  const cuts = new Uint32Array([0, 1]);
  const groups = new Uint32Array([0]);
  expect(() =>
    analyzeFiniteCutIncidence(triangles, cuts, groups, { maxWork: 1 }),
  ).toThrow(/budget/i);
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    analyzeFiniteCutIncidence(triangles, cuts, groups, {
      signal: abort.signal,
    }),
  ).toThrow(/abort/i);
});
