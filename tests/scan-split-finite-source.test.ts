import { expect, it } from "vitest";
import { selectFiniteIndexedSource } from "../src/scan-split-finite-source";
import { refineFiniteCutterFromSource } from "../src/scan-split-finite-pipeline";
import { indexFiniteTriangleSoup } from "../src/scan-split-finite-soup";

const vertices = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0,
]);
const triangles = new Uint32Array([0, 1, 2, 4, 3, 5]);
const positions = Float32Array.from(
  Array.from(triangles).flatMap((id) => [
    ...vertices.slice(id * 3, id * 3 + 3),
  ]),
);

it("retains explicit indexed identities and buffers without welding", () => {
  const result = selectFiniteIndexedSource(positions, { vertices, triangles });
  expect(result?.vertices).toBe(vertices);
  expect(result?.triangles).toBe(triangles);
});

it("retains binary64 indexed source coordinates without Float32 conversion", () => {
  const precise = [100000000, 0, 0, 100000004, 0, 0, 100000004, 4, 0];
  const indices = new Uint32Array([0, 1, 2]);
  const before = precise.slice();
  expect(() =>
    selectFiniteIndexedSource(
      precise,
      { vertices: precise, triangles: indices },
      undefined,
      { preciseCoordinates: true, maxTypedBytes: 71 },
    ),
  ).toThrow(/memory/i);
  const result = selectFiniteIndexedSource(
    precise,
    { vertices: precise, triangles: indices },
    undefined,
    { preciseCoordinates: true, maxTypedBytes: 72 },
  )!;
  expect(result.vertices).toBeInstanceOf(Float64Array);
  expect(result.vertices[3]).toBe(100000004);
  expect(result.triangles).toBe(indices);
  expect(precise).toEqual(before);
});

it("refines the same identities from direct input and an indexed cache", () => {
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const cache = {
    positions,
    topology: { vertices: Float64Array.from(vertices), triangles },
    provenance: "indexed" as const,
  };
  const direct = refineFiniteCutterFromSource(positions, cutter, {
    vertices,
    triangles,
  });
  const reused = refineFiniteCutterFromSource(
    positions,
    cutter,
    undefined,
    cache,
  );
  expect([...reused.triangles]).toEqual([...direct.triangles]);
  expect([...reused.groups]).toEqual([...direct.groups]);
  expect(new Set(reused.groups).size).toBe(2);
  expect(reused.sourceVertices).toEqual(vertices);
  expect(direct.sourceIdentity).toBe("retained-indexed");
  expect(reused.sourceIdentity).toBe("retained-indexed");
  const fallback = refineFiniteCutterFromSource(positions, cutter, undefined, {
    ...cache,
    provenance: "welded",
  });
  expect(fallback.sourceIdentity).toBe("exact-corner-index");
  expect(new Set(fallback.groups).size).toBe(1);
});

it("does not charge borrowed precise cache vertices as a new allocation", () => {
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const preciseVertices = Float64Array.from(vertices);
  const cache = {
    positions,
    topology: { vertices: preciseVertices, triangles },
    provenance: "indexed" as const,
  };
  let allowance = 0;
  for (; allowance < 1024; allowance++) {
    try {
      refineFiniteCutterFromSource(
        positions,
        cutter,
        cache.topology,
        undefined,
        {
          preciseCoordinates: true,
          maxTypedBytes: allowance,
        },
      );
      break;
    } catch (error) {
      expect(String(error)).toMatch(/memory/i);
    }
  }
  expect(allowance).toBeLessThan(1024);
  const reused = refineFiniteCutterFromSource(
    positions,
    cutter,
    undefined,
    cache,
    {
      preciseCoordinates: true,
      maxTypedBytes: allowance,
    },
  );
  expect(reused.sourceVertices).toBe(preciseVertices);
  expect([...reused.triangles]).toEqual([...triangles]);
});

it("refines raw triangle corners while preserving each source coordinate", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = refineFiniteCutterFromSource(source, cutter);
  expect(result.sourceIdentity).toBe("exact-corner-index");
  expect(result.cutIncidence).toHaveLength(1);
  expect(result.cutIncidence[0].kind).toBe("nonseparating");
  expect([...source]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

it("rejects an ambiguous soup edge that merges distinct authored vertices", () => {
  const vertices = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 1, -1, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 4, 5, 1]);
  const source = Float32Array.from(
    Array.from(triangles).flatMap((id) => [
      ...vertices.slice(id * 3, id * 3 + 3),
    ]),
  );
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  expect(() =>
    refineFiniteCutterFromSource(source, cutter, { vertices, triangles }),
  ).not.toThrow();
  expect(() => refineFiniteCutterFromSource(source, cutter)).toThrow(
    /non-manifold edge.*3 incident/i,
  );
});

it("charges raw source indexing and downstream refinement to the same typed allowance", () => {
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const indexed = indexFiniteTriangleSoup(positions);
  let minimum = 0;
  for (; minimum < 1024; minimum++) {
    try {
      refineFiniteCutterFromSource(
        positions,
        cutter,
        { vertices: indexed.vertices, triangles: indexed.triangles },
        undefined,
        { maxTypedBytes: minimum },
      );
      break;
    } catch (error) {
      expect(String(error)).toMatch(/memory/i);
    }
  }
  expect(minimum).toBeLessThan(1024);
  expect(() =>
    refineFiniteCutterFromSource(positions, cutter, undefined, undefined, {
      maxTypedBytes: minimum + indexed.peakTypedBytes - 1,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    refineFiniteCutterFromSource(positions, cutter, undefined, undefined, {
      maxTypedBytes: minimum + indexed.peakTypedBytes,
    }),
  ).not.toThrow();
});

it("accounts for a retained cached vertex conversion in the refinement budget", () => {
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  const cache = {
    positions,
    topology: { vertices: Float64Array.from(vertices), triangles },
    provenance: "indexed" as const,
  };
  let minimum = 0;
  for (; minimum < 1024; minimum++) {
    try {
      refineFiniteCutterFromSource(
        positions,
        cutter,
        { vertices, triangles },
        undefined,
        { maxTypedBytes: minimum },
      );
      break;
    } catch (error) {
      expect(String(error)).toMatch(/memory/i);
    }
  }
  expect(minimum).toBeLessThan(1024);
  expect(() =>
    refineFiniteCutterFromSource(positions, cutter, undefined, cache, {
      maxTypedBytes: minimum,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    refineFiniteCutterFromSource(positions, cutter, undefined, cache, {
      maxTypedBytes: minimum + vertices.byteLength,
    }),
  ).not.toThrow();
});

it("applies the work budget before scanning a large indexed source", () => {
  const largeVertices = new Float32Array(6000);
  largeVertices[3] = 1;
  largeVertices[7] = 1;
  largeVertices[5999] = NaN;
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([3, 3, 1, 4, 3, 1, 3, 4, 1]);
  expect(() =>
    refineFiniteCutterFromSource(
      positions,
      cutter,
      { vertices: largeVertices, triangles },
      undefined,
      { maxWork: 1 },
    ),
  ).toThrow(/work budget/i);
});

it("reuses only an explicitly indexed cache for the identical source object", () => {
  const topology = { vertices: Float64Array.from(vertices), triangles };
  const cache = { positions, topology, provenance: "indexed" as const };
  const result = selectFiniteIndexedSource(positions, undefined, cache);
  expect(result?.vertices).toEqual(vertices);
  expect(result?.triangles).toBe(triangles);
  expect(
    selectFiniteIndexedSource(positions.slice(), undefined, cache),
  ).toBeUndefined();
  expect(
    selectFiniteIndexedSource(positions, undefined, {
      ...cache,
      provenance: "welded",
    }),
  ).toBeUndefined();
});

it("rejects inconsistent cached or explicit coordinates and invalid indices", () => {
  const altered = vertices.slice();
  altered[3] += 0.125;
  expect(() =>
    selectFiniteIndexedSource(positions, { vertices: altered, triangles }),
  ).toThrow(/match/i);
  const cache = {
    positions,
    topology: { vertices: Float64Array.from(altered), triangles },
    provenance: "indexed" as const,
  };
  expect(() => selectFiniteIndexedSource(positions, undefined, cache)).toThrow(
    /match/i,
  );
  expect(() =>
    selectFiniteIndexedSource(positions, {
      vertices,
      triangles: new Uint32Array([0, 1, 999, 4, 3, 5]),
    }),
  ).toThrow(/match/i);
});

it("honors cancellation and the additional typed memory budget", () => {
  const cache = {
    positions,
    topology: { vertices: Float64Array.from(vertices), triangles },
    provenance: "indexed" as const,
  };
  expect(() =>
    selectFiniteIndexedSource(positions, undefined, cache, {
      maxTypedBytes: vertices.byteLength - 1,
    }),
  ).toThrow(/memory/i);
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    selectFiniteIndexedSource(positions, { vertices, triangles }, undefined, {
      signal: controller.signal,
    }),
  ).toThrow(/abort/i);
  let checks = 0;
  expect(() =>
    selectFiniteIndexedSource(positions, undefined, cache, {
      check: () => {
        if (++checks === 5) throw new DOMException("Aborted", "AbortError");
      },
    }),
  ).toThrow(/abort/i);
});
