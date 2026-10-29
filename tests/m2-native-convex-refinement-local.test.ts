import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { refineFiniteCutterFromSource } from "../src/scan-split-finite-pipeline";

it("observes refined facets before seam materialization", () => {
  const dir = new URL(
    "./fixtures/m2-native-convex-split-20261029/",
    import.meta.url,
  );
  const load = (file: string) => {
    const b = readFileSync(new URL(file, dir));
    return parseMesh(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      "stl",
    );
  };
  const source = load("square-source.stl"),
    cutter = load("convex-cutter.stl"),
    native = load("native-convex-result-20261029.stl");
  const r = refineFiniteCutterFromSource(source, cutter, undefined, undefined, {
    preciseCoordinates: true,
  });
  const vertices = [...r.sourceVertices, ...r.addedVertices];
  const refined = Array.from(r.triangles, (v) =>
    vertices.slice(v * 3, v * 3 + 3),
  ).flat();
  const keys = (p: ArrayLike<number>) => {
    const result: string[] = [];
    for (let i = 0; i < p.length; i += 9)
      result.push(
        [0, 3, 6]
          .map((d) => [0, 1, 2].map((a) => Math.fround(p[i + d + a])).join(","))
          .sort()
          .join("|"),
      );
    return result.sort();
  };
  const a = keys(refined),
    b = keys(native);
  expect({
    refinedFacets: a.length,
    nativeFacets: b.length,
    constraints: r.constraints.length / 2,
    exactFacetMatches: a.filter((x) => b.includes(x)).length,
  }).toEqual({
    refinedFacets: 18,
    nativeFacets: 18,
    constraints: 8,
    exactFacetMatches: 12,
  });
});
