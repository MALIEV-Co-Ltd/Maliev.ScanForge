import { describe, expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { compactComponentGroups } from "../src/scan-component-groups";
import { runIndexedComponentExtract, runScanEdit } from "../src/scan-edit";

describe("compact indexed components", () => {
  it("joins nonzero shared edges of collapsed faces without joining self edges", () => {
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0];
    const triangles = Uint32Array.from([0, 0, 1, 1, 0, 2, 3, 3, 3]);
    const result = compactComponentGroups(vertices, triangles);
    expect(result.count).toBe(2);
    expect(Array.from(result.groups)).toEqual([0, 0, 1]);
  });

  it("does not report coordinate or index preparation as complete", () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
    ]);
    const events: { fraction: number; stage: string }[] = [];
    runScanEdit(
      {
        kind: "scanEdit",
        action: "componentKeep",
        positions,
        sourceIndexed: {
          vertices: positions,
          triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
        },
        indices: [0],
      },
      { onProgress: (fraction, stage) => events.push({ fraction, stage }) },
    );
    const working = events.filter(
      ({ stage }) =>
        stage === "Preparing component coordinates" ||
        stage === "Compacting component indices",
    );
    expect(working.length).toBeGreaterThan(0);
    expect(working.every(({ fraction }) => fraction < 1)).toBe(true);
    expect(events.at(-1)).toEqual({ fraction: 1, stage: "Scan edit complete" });
  });
  it("splits per-corner normals with their original faces", () => {
    const positions = new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
    ]);
    const normals = new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1,
    ]);
    const result = runScanEdit(
      { kind: "scanEdit", action: "componentExtract", positions, indices: [1] },
      { includeComponentRemainder: true, componentCornerNormals: normals },
    );
    expect(result.componentRemainder!.normals).toEqual(normals.slice(0, 9));
    expect(result.segmentNormals![0]).toEqual(normals.slice(9));
  });
  it("retains authored vertex and facet normals on both extraction outputs", () => {
    const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0];
    const normals = new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, -1, 0, 0, 0, -1,
    ]);
    const geometryNormals = new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const facetNormals = new Float32Array([0, 0, 1, 0, 1, 0]);
    const indexed = {
      vertices,
      triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
      normals,
      geometryNormals,
      facetNormals,
    };
    const result = runIndexedComponentExtract(indexed, [1], {
      includeComponentRemainder: true,
    });
    for (const [mesh, offset] of [
      [result.componentRemainder!.indexedMesh!, 0],
      [result.segmentIndexedMeshes![0]!, 9],
    ] as const) {
      expect(Array.from(mesh.normals!)).toEqual(
        Array.from(normals.slice(offset, offset + 9)),
      );
      expect(Array.from(mesh.geometryNormals!)).toEqual(
        Array.from(geometryNormals.slice(offset, offset + 9)),
      );
      expect(Array.from(mesh.facetNormals!)).toEqual(
        Array.from(facetNormals.slice(offset / 3, offset / 3 + 3)),
      );
    }
  });
  it("returns the untouched source faces alongside extracted components", () => {
    const vertices = [
      0, -0, 0, 1.123456789, 0, 0, 0, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0,
    ];
    const indexed = {
      vertices,
      triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const regular = runScanEdit(
      {
        kind: "scanEdit",
        action: "componentExtract",
        positions: vertices,
        sourceIndexed: indexed,
        indices: [1],
      },
      { includeComponentRemainder: true },
    );
    const compact = runIndexedComponentExtract(indexed, [1], {
      includeComponentRemainder: true,
    });
    for (const result of [regular, compact]) {
      expect(Array.from(result.componentRemainder!.positions)).toEqual(
        vertices.slice(0, 9),
      );
      expect(Object.is(result.componentRemainder!.positions[1], -0)).toBe(true);
      expect(
        Array.from(result.componentRemainder!.indexedMesh!.triangles),
      ).toEqual([0, 1, 2]);
      expect(Array.from(result.segments![0])).toEqual(vertices.slice(9));
    }
    const empty = runIndexedComponentExtract(indexed, [0, 1], {
      includeComponentRemainder: true,
    });
    expect(empty.componentRemainder!.positions).toHaveLength(0);
    expect(empty.componentRemainder!.indexedMesh).toBeUndefined();
  });
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

  it("matches edge connectivity on deterministic mixed meshes", () => {
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
      const faces = Array.from({ length: triangles.length / 3 }, (_, face) =>
        Array.from(triangles.subarray(face * 3, face * 3 + 3)),
      );
      const expected = new Uint32Array(faces.length).fill(0xffffffff);
      let group = 0;
      for (let start = 0; start < faces.length; start++) {
        if (expected[start] !== 0xffffffff) continue;
        expected[start] = group;
        const pending = [start];
        for (const face of pending) {
          const currentVertices = new Set(faces[face]);
          for (let next = 0; next < faces.length; next++) {
            if (expected[next] !== 0xffffffff) continue;
            const shared = [...new Set(faces[next])].filter((id) =>
              currentVertices.has(id),
            );
            if (shared.length >= 2) {
              expected[next] = group;
              pending.push(next);
            }
          }
        }
        group++;
      }
      const actual = compactComponentGroups(vertices, triangles);
      expect(actual.groups).toEqual(expected);
      expect(actual.count).toBe(group);
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
