import { describe, expect, it } from "vitest";
import { verifyMeshSelfIntersections } from "../src/scan-self-intersections";
import { trianglesIntersectBeyondSharedTopology } from "../src/scan-self-intersection-predicate";
const soup = (...faces: number[][]) => new Float32Array(faces.flat());
const a = [0, 0, 0, 2, 0, 0, 0, 2, 0];
const crossing = [0.5, 0.5, -1, 0.5, 0.5, 1, 1.5, 0.5, 0];
describe("exhaustive mesh intersection verification", () => {
  it("finds a crossing with original face identities and bounded examples", () => {
    const p = soup([20, 0, 0, 21, 0, 0, 20, 1, 0], a, crossing);
    const result = verifyMeshSelfIntersections(p);
    expect(result.selfIntersectionsChecked).toBe(true);
    expect(result.selfIntersectionPairs).toBe(1);
    expect(result.selfIntersectionExamples).toEqual([[1, 2]]);
  });
  it("counts every intersecting pair while bounding the report", () => {
    const p = soup(...Array.from({ length: 20 }, () => a));
    const before = new Float32Array(p);
    const r = verifyMeshSelfIntersections(p);
    expect(r.selfIntersectionPairs).toBe(190);
    expect(r.selfIntersectionExamples).toHaveLength(16);
    expect(p).toEqual(before);
  });
  it("permits ordinary coplanar adjacent facets", () => {
    expect(
      verifyMeshSelfIntersections(soup(a, [2, 0, 0, 2, 2, 0, 0, 2, 0]))
        .selfIntersectionPairs,
    ).toBe(0);
  });
  it("matches brute force across disjoint, crossing, coplanar and shared pairs", () => {
    const faces = [
      a,
      crossing,
      [2, 0, 0, 2, 2, 0, 0, 2, 0],
      [0.2, 0.2, 0, 1.5, 0.2, 0, 0.2, 1.5, 0],
      ...Array.from({ length: 24 }, (_, i) => [
        i * 3,
        0,
        4,
        i * 3 + 1,
        0,
        4,
        i * 3,
        1,
        4,
      ]),
    ];
    const p = soup(...faces);
    let count = 0;
    for (let i = 0; i < faces.length; i++)
      for (let j = i + 1; j < faces.length; j++)
        if (trianglesIntersectBeyondSharedTopology(p, i, j)) count++;
    expect(verifyMeshSelfIntersections(p).selfIntersectionPairs).toBe(count);
  });
  it("matches brute force for seeded three-dimensional geometry across many BVH leaves", () => {
    let seed = 19;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const p = soup(
      ...Array.from({ length: 64 }, () =>
        Array.from({ length: 9 }, () => next() * 4 - 2),
      ),
    );
    let count = 0;
    for (let i = 0; i < 64; i++)
      for (let j = i + 1; j < 64; j++)
        if (trianglesIntersectBeyondSharedTopology(p, i, j)) count++;
    expect(verifyMeshSelfIntersections(p).selfIntersectionPairs).toBe(count);
  });
  it("checks changed faces against outside geometry without auditing outside-only pairs", () => {
    const p = soup(a, crossing, [20, 0, 0, 21, 0, 0, 20, 1, 0]);
    expect(
      verifyMeshSelfIntersections(p, { firstChangedFace: 2 })
        .selfIntersectionPairs,
    ).toBe(0);
    expect(
      verifyMeshSelfIntersections(p, { firstChangedFace: 1 })
        .selfIntersectionPairs,
    ).toBe(1);
  });
  it("does not mutate source positions or silently finish after cancellation", () => {
    const p = soup(a, crossing),
      before = new Float32Array(p),
      c = new AbortController();
    c.abort();
    expect(() => verifyMeshSelfIntersections(p, { signal: c.signal })).toThrow(
      /cancel|abort/i,
    );
    expect(p).toEqual(before);
  });
  it("returns from the BVH traversal before throwing an abort so subsequent audits still work", () => {
    const c = new AbortController();
    const p = soup(a, crossing);
    let calls = 0;
    expect(() =>
      verifyMeshSelfIntersections(p, {
        signal: c.signal,
        onProgress: (_, stage) => {
          if (stage.includes("pairs") && ++calls > 1) c.abort();
        },
      }),
    ).toThrow(/cancel|abort/i);
    expect(verifyMeshSelfIntersections(p).selfIntersectionPairs).toBe(1);
  });
  it("unwinds a traversal limit before another audit", () => {
    const p = soup(a, crossing, [0.2, 0.2, 0, 1.5, 0.2, 0, 0.2, 1.5, 0]);
    expect(() =>
      verifyMeshSelfIntersections(p, { maxCandidatePairs: 1 }),
    ).toThrow(/limit/i);
    expect(
      verifyMeshSelfIntersections(p).selfIntersectionPairs,
    ).toBeGreaterThan(0);
  });
  it("refuses a truncated packed BVH leaf rather than a false zero", () => {
    const p = new Float32Array(65_536 * 9);
    for (let f = 0; f < 65_536; f++) p.set(a, f * 9);
    expect(() => verifyMeshSelfIntersections(p)).toThrow(
      /coverage|leaf|limit/i,
    );
  });
  it("refuses an overflowed BVH bound instead of certifying a false zero", () => {
    const m = 3.4028234663852886e38;
    const faces = Array.from({ length: 20 }, (_, i) => [
      m,
      i * 3,
      0,
      m,
      i * 3 + 1,
      0,
      m,
      i * 3,
      1,
    ]);
    faces[1] = faces[0];
    expect(() => verifyMeshSelfIntersections(soup(...faces))).toThrow(
      /bounds|finite|range/i,
    );
  });
  it("does not report a partial zero when a callback throws a falsy value", () => {
    let calls = 0,
      threw = false;
    const p = soup(a, crossing);
    try {
      verifyMeshSelfIntersections(p, {
        onProgress: (_, stage) => {
          if (stage.includes("pairs") && ++calls > 1) throw undefined;
        },
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(verifyMeshSelfIntersections(p).selfIntersectionPairs).toBe(1);
  });
  it("fails closed on resource bounds and malformed geometry", () => {
    expect(() =>
      verifyMeshSelfIntersections(soup(a, crossing), { maxCandidatePairs: 0 }),
    ).toThrow(/limit|bound/i);
    expect(() => verifyMeshSelfIntersections(new Float32Array([0]))).toThrow(
      /triangles/i,
    );
    expect(() =>
      verifyMeshSelfIntersections(soup(a, [NaN, 0, 0, 0, 1, 0, 1, 0, 0])),
    ).toThrow(/finite/i);
  });
});
