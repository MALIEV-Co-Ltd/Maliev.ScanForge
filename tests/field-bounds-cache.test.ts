import { describe, expect, it } from "vitest";
import {
  clearGuideBoundsCache,
  initializeGuideBoundsCache,
  type GuideBoundsCache,
} from "../src/field-bounds-cache";
import { accessGuideBoundsContext } from "../src/field-bounds-context";
import { guideQueryCacheValid } from "../src/field-query-cache";
import { collectGuideTriangles } from "../src/field-triangle-collector";
import { buildGuideQueryTree } from "../src/field-query-tree";
import { buildTriangleNormalCache } from "../src/field-triangle-normals";
import { queryGuideSurface } from "../src/field-surface-query";
import native from "./fixtures/field-native-bounds-cache.json";

describe("recovered concrete geometry bounds cache", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete native clear and initializer case $id",
    (entry) => {
      const owner =
        entry.positions === null ? null : new Float32Array(entry.positions);
      const cache: GuideBoundsCache = {
        flags: entry.flags,
        bounds: new Float32Array(entry.initial),
        elapsed: entry.initialElapsed,
        owner,
      };
      clearGuideBoundsCache(cache);
      expect({
        flags: cache.flags,
        bounds: [...cache.bounds],
        elapsed: cache.elapsed,
      }).toEqual(entry.cleared);
      cache.flags = entry.flags;
      cache.bounds.set(entry.initial);
      const clockFlags: number[] = [];
      initializeGuideBoundsCache(cache, () => {
        clockFlags.push(cache.flags);
        return entry.times[clockFlags.length - 1];
      });
      expect({
        flags: cache.flags,
        bounds: [...cache.bounds],
        elapsed: cache.elapsed,
      }).toEqual(entry.initialized);
      expect(clockFlags).toEqual(entry.clockFlags);
      expect(cache.owner).toBe(owner);
    },
  );

  it("acquires root bounds lazily for a geometry-derived spatial query", () => {
    const positions = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, -8, -8, -8]);
    const triangles = new Uint32Array([0, 1, 2]);
    const cache: GuideBoundsCache = {
      flags: 2,
      owner: positions,
      elapsed: 0,
      bounds: new Float32Array(6),
    };
    const holder = { context: cache };
    let clockCalls = 0;
    const acquire = () =>
      accessGuideBoundsContext(
        holder,
        true,
        (context) => guideQueryCacheValid(context.flags),
        (context) => initializeGuideBoundsCache(context, () => clockCalls++),
      );
    const context = acquire();
    expect(acquire()).toBe(context);
    expect(clockCalls).toBe(2);
    expect([...context.bounds]).toEqual([-8, -8, -8, 2, 2, 0]);
    const collected = collectGuideTriangles(positions, triangles);
    const tree = buildGuideQueryTree(
      collected.faceBounds,
      collected.faces,
      context.bounds,
    );
    const { normals } = buildTriangleNormalCache(positions, triangles);
    const result = queryGuideSurface(
      { positions, triangles, normals, bounds: context.bounds, ...tree },
      new Float32Array([0.5, 0.5, 0.01]),
      -1,
    );
    expect(result.face).toBe(0);
    expect([...result.point]).toEqual([0.5, 0.5, 0]);
    clearGuideBoundsCache(cache);
    acquire();
    expect(clockCalls).toBe(4);
  });

  it("guards malformed browser cache state and geometry", () => {
    const cache: GuideBoundsCache = {
      flags: -1,
      bounds: new Float32Array(6),
      owner: null,
      elapsed: 0,
    };
    expect(() => clearGuideBoundsCache(cache)).toThrow(/flags/);
    cache.flags = 0;
    cache.bounds = new Float32Array(5);
    expect(() => clearGuideBoundsCache(cache)).toThrow(/coordinates/);
    cache.bounds = new Float32Array(6);
    cache.owner = new Float32Array(2);
    expect(() => initializeGuideBoundsCache(cache, () => 0)).toThrow(
      /geometry/,
    );
    cache.owner = null;
    expect(() => initializeGuideBoundsCache(cache, () => NaN)).toThrow(/clock/);
  });
});
