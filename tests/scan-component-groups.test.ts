import { describe, expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { compactComponentGroups } from "../src/scan-component-groups";

describe("compact indexed components", () => {
  it.each([
    ["shared edge", [0, 1, 2, 1, 0, 3]],
    ["point-only contact", [0, 1, 2, 0, 3, 4]],
    ["nonmanifold edge", [0, 1, 2, 1, 0, 3, 0, 1, 4]],
    ["duplicate facets", [0, 1, 2, 0, 1, 2]],
    ["degenerate facet", [0, 1, 2, 0, 0, 1]],
    ["coincident indexed faces", [0, 1, 2, 5, 6, 7]],
  ])("matches full topology for %s", (_name, values) => {
    const vertices = new Float64Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    const triangles = Uint32Array.from(values as number[]);
    const full = analyzeIndexedMesh(vertices, triangles);
    const actual = compactComponentGroups(vertices, triangles);
    const expected = new Uint32Array(triangles.length / 3);
    full.components.forEach((faces, group) =>
      faces.forEach((face) => {
        expected[face] = group;
      }),
    );
    expect(actual.groups).toEqual(expected);
    expect(actual.count).toBe(full.components.length);
  });

  it("honors cancellation before allocation", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      compactComponentGroups(new Float64Array(), new Uint32Array(), {
        signal: controller.signal,
      }),
    ).toThrow(/cancel/i);
  });

  it("matches full topology on deterministic mixed meshes", () => {
    const vertices = new Float64Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1,
      1e-9, 0, 0,
    ]);
    let seed = 17;
    for (let sample = 0; sample < 30; sample++) {
      const triangles = new Uint32Array(90);
      for (let i = 0; i < triangles.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        triangles[i] = seed % 9;
      }
      const full = analyzeIndexedMesh(vertices, triangles);
      const expected = new Uint32Array(triangles.length / 3);
      full.components.forEach((faces, group) =>
        faces.forEach((face) => {
          expected[face] = group;
        }),
      );
      const actual = compactComponentGroups(vertices, triangles);
      expect(actual.groups).toEqual(expected);
      expect(actual.count).toBe(full.components.length);
    }
  });

});
