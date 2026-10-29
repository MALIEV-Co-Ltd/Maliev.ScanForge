import { describe, expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { compactComponentGroups } from "../src/scan-component-groups";
import { runIndexedComponentExtract, runScanEdit } from "../src/scan-edit";

describe("compact indexed components", () => {
  it("extracts exact indexed coordinates without expanded source storage", () => {
    const vertices = [
      0, -0, 0, 1.123456789, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
    ];
    const triangles = new Uint32Array([0, 1, 2, 3, 4, 5]);
    const positions = Array.from(triangles).flatMap((id) =>
      vertices.slice(id * 3, id * 3 + 3),
    );
    const indexed = { vertices, triangles };
    const expected = runScanEdit({
      kind: "scanEdit",
      action: "componentExtract",
      positions,
      sourceIndexed: indexed,
      indices: [0],
    });
    const actual = runIndexedComponentExtract(indexed, [0]);
    expect(Array.from(actual.segments![0])).toEqual(
      Array.from(expected.segments![0]),
    );
    expect(Object.is(actual.segments![0][1], -0)).toBe(true);
    expect(Array.from(actual.segmentIndexedMeshes![0]!.vertices)).toEqual(
      Array.from(expected.segmentIndexedMeshes![0]!.vertices),
    );
    expect(actual.segmentIndexedMeshes![0]!.triangles).toEqual(
      expected.segmentIndexedMeshes![0]!.triangles,
    );
    expect(actual.diagnostics).toEqual(expected.diagnostics);
    const reverse = runIndexedComponentExtract(indexed, [1, 0, 1]);
    expect(reverse.segments!.map((part) => Array.from(part))).toEqual([
      vertices.slice(9),
      vertices.slice(0, 9),
    ]);
    expect(() => runIndexedComponentExtract(indexed, [2])).toThrow(/outside/);
  });
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

  it("retains grouping through edge-table growth and honors a mid-build cancellation", () => {
    const side = 36;
    const vertices = new Float64Array((side + 1) * (side + 1) * 3);
    for (let y = 0; y <= side; y++)
      for (let x = 0; x <= side; x++) {
        const offset = (y * (side + 1) + x) * 3;
        vertices[offset] = x;
        vertices[offset + 1] = y;
      }
    const triangles = new Uint32Array(side * side * 6);
    let offset = 0;
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const a = y * (side + 1) + x,
          b = a + 1,
          c = a + side + 1,
          d = c + 1;
        triangles.set([a, b, c, b, d, c], offset);
        offset += 6;
      }
    const before = triangles.slice();
    const full = analyzeIndexedMesh(vertices, triangles);
    const actual = compactComponentGroups(vertices, triangles);
    expect(actual.count).toBe(full.components.length);
    expect(actual.count).toBe(1);
    expect(actual.groups.every((group) => group === 0)).toBe(true);
    expect(triangles).toEqual(before);
    let checks = 0;
    expect(() =>
      compactComponentGroups(vertices, triangles, {
        check: () => {
          if (++checks === 2) throw new Error("cancelled by owner");
        },
      }),
    ).toThrow(/cancelled by owner/);
  });

  it("uses compact indexed grouping for large component edits", () => {
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0];
    const faces = 65536;
    const triangles = new Uint32Array(faces * 3);
    const positions = new Float32Array(faces * 9);
    for (let f = 0; f < faces; f++) {
      const base = (f % 2) * 3;
      triangles.set([base, base + 1, base + 2], f * 3);
      positions.set(vertices.slice(base * 3, base * 3 + 9), f * 9);
    }
    const stages: string[] = [];
    const result = runScanEdit(
      {
        kind: "scanEdit",
        action: "componentKeep",
        positions,
        sourceIndexed: { vertices, triangles },
        indices: [1],
      },
      { onProgress: (_fraction, stage) => stages.push(stage) },
    );
    expect(stages).toContain("Grouping indexed components");
    expect(result.positions).toHaveLength((faces * 9) / 2);
    expect(Array.from(result.positions!.slice(0, 9))).toEqual(
      vertices.slice(9),
    );
  });
});
