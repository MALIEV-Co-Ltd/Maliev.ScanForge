import { expect, it } from "vitest";
import normals from "./fixtures/global-fine-facet-normals-native.json";
import construction from "./fixtures/alignment-target-builder.json";
import {
  nativeGlobalFacetNormals,
  prepareNativeGlobalMeshEvaluator,
} from "../src/scan-native-global-surface";

it.each(normals.cases)("matches original facet normal cache: $label", (c) => {
  const result = nativeGlobalFacetNormals(
    Float32Array.from(c.vertices),
    Uint32Array.from(c.triangles),
  );
  expect(Buffer.from(result.normals.buffer).toString("hex")).toBe(
    c.facetNormalBits,
  );
  expect([...result.degenerate]).toEqual(c.degenerate);
});
const canonical = (node: any): any =>
  node && {
    bounds: [...node.bounds],
    center: [...node.center],
    inverse: [...node.inverse],
    depth: node.depth,
    triangles: [...node.triangles],
    children: Object.fromEntries(
      Object.entries(node.children).map(([id, c]) => [id, canonical(c)]),
    ),
  };
it.each(
  construction.cases.flatMap((c) =>
    [false, true].map((compactBounds) => ({ ...c, compactBounds })),
  ),
)("builds the original evaluator index: $name, compact=$compactBounds", (c) => {
  const vertices = Float32Array.from(c.points.flat(2));
  const input = {
    vertices,
    triangles: Uint32Array.from({ length: c.points.length * 3 }, (_, i) => i),
    flags: Uint8Array.from(c.flags),
    cachedBounds: c.cachedBounds ?? undefined,
    minimumExtent: c.minextent,
    maximumDepth: c.maxdepth,
    filterHidden: c.filterHidden,
    compactBounds: c.compactBounds,
  };
  const result = prepareNativeGlobalMeshEvaluator(input);
  expect(canonical(result.root)).toEqual(c.root);
  expect(result.surface.vertices).toBe(vertices);
  expect(result.surface.triangles).toBe(input.triangles);
  if (c.compactBounds) expect(result.surface.bounds.byteLength).toBe(0);
  expect(prepareNativeGlobalMeshEvaluator(input)).toBe(result);
});
it("queries a generated surface and preserves outputs on an empty index", () => {
  const input = {
    vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    triangles: Uint32Array.of(0, 1, 2),
  };
  const result = prepareNativeGlobalMeshEvaluator(input);
  const distance = Float64Array.of(1),
    point = new Float64Array(3),
    flags = new Uint8Array(1);
  const scratch = {
    stack: [],
    projection: new Float64Array(3),
    edgeFlags: new Uint8Array(1),
  };
  expect(result.query([0.25, 0.25, 0.1], distance, point, flags, scratch)).toBe(
    0,
  );
  expect(distance[0]).toBe(0.1);
  expect([...point]).toEqual([0.25, 0.25, 0]);
  const empty = prepareNativeGlobalMeshEvaluator({
    ...input,
    flags: Uint8Array.of(2),
    filterHidden: true,
  });
  distance[0] = 1;
  point.set([11, 12, 13]);
  flags[0] = 255;
  expect(
    empty.query([0.25, 0.25, 0.1], distance, point, flags, scratch),
  ).toBeUndefined();
  expect(distance[0]).toBe(1);
  expect([...point]).toEqual([11, 12, 13]);
  expect(flags[0]).toBe(255);
});
it("honors cancellation before cached retrieval and does not retain failed preparation", () => {
  const input = {
    vertices: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
    triangles: Uint32Array.of(0, 1, 2),
  };
  const control = new AbortController();
  control.abort();
  expect(() =>
    prepareNativeGlobalMeshEvaluator(input, { signal: control.signal }),
  ).toThrow();
  const result = prepareNativeGlobalMeshEvaluator(input);
  expect(() =>
    prepareNativeGlobalMeshEvaluator(input, { signal: control.signal }),
  ).toThrow();
  expect(prepareNativeGlobalMeshEvaluator(input)).toBe(result);
});
