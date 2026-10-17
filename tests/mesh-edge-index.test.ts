import { describe, expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { MeshEdgeIndex } from "../src/mesh-edge-index";

describe("compact topology edge directory", () => {
  const triangles = new Uint32Array([0, 1, 2, 2, 1, 3, 1, 2, 4]);
  const reference = new Map([
    ["0:1", [{ face: 0, from: 0, to: 1 }]],
    [
      "1:2",
      [
        { face: 0, from: 1, to: 2 },
        { face: 1, from: 2, to: 1 },
        { face: 2, from: 1, to: 2 },
      ],
    ],
    ["0:2", [{ face: 0, from: 2, to: 0 }]],
    ["1:3", [{ face: 1, from: 1, to: 3 }]],
    ["2:3", [{ face: 1, from: 3, to: 2 }]],
    ["2:4", [{ face: 2, from: 2, to: 4 }]],
    ["1:4", [{ face: 2, from: 4, to: 1 }]],
  ]);
  it("preserves insertion order, nonmanifold use order and Map lookup/copy semantics", () => {
    const edges = new MeshEdgeIndex(triangles);
    for (let corner = 0; corner < triangles.length; corner++)
      edges.addCorner(corner);
    expect([...edges]).toEqual([...reference]);
    expect([...edges.keys()]).toEqual([...reference.keys()]);
    expect([...edges.values()]).toEqual([...reference.values()]);
    expect(new Map(edges)).toEqual(reference);
    expect(edges.get("1:2")).toEqual(reference.get("1:2"));
    expect(edges.get("2:1")).toBeUndefined();
    expect(edges.size).toBe(7);
    expect(edges.has("0:2")).toBe(true);
    expect(edges.has("7:8")).toBe(false);
  });
  it("supports existing edit consumers through an explicit mutable Map copy", () => {
    const compact = new MeshEdgeIndex(triangles);
    for (let corner = 0; corner < triangles.length; corner++)
      compact.addCorner(corner);
    const edges = new Map(compact);
    edges.set("1:2", [{ face: 9, from: 1, to: 2 }]);
    expect(edges.get("1:2")![0].face).toBe(9);
    expect(edges.delete("0:1")).toBe(true);
    expect(edges.delete("0:1")).toBe(false);
    const visited: string[] = [];
    edges.forEach((_uses, key, map) => {
      expect(map).toBe(edges);
      visited.push(key);
    });
    expect(visited).toEqual([...edges.keys()]);
    edges.clear();
    expect([...edges]).toEqual([]);
    expect(edges.size).toBe(0);
    expect([...compact]).toEqual([...reference]);
  });
  it("keeps complete diagnostics and ordered boundaries identical to the existing-edge path", () => {
    const vertices = new Float64Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, -1,
    ]);
    const compact = analyzeIndexedMesh(vertices, triangles);
    const legacy = analyzeIndexedMesh(vertices, triangles, {}, reference);
    expect(compact.edges).toBeInstanceOf(MeshEdgeIndex);
    expect({ ...compact, edges: [...compact.edges] }).toEqual({
      ...legacy,
      edges: [...legacy.edges],
    });
  });
  it("grows its hash table without changing edge or use numbering", () => {
    const triangles = Uint32Array.from({ length: 15000 }, (_, i) => i);
    const edges = new MeshEdgeIndex(triangles),
      reference = new Map();
    for (let corner = 0; corner < triangles.length; corner++) {
      const from = triangles[corner],
        to = triangles[corner - (corner % 3) + ((corner + 1) % 3)];
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
      reference.set(key, [{ face: Math.floor(corner / 3), from, to }]);
      edges.addCorner(corner);
    }
    expect([...edges]).toEqual([...reference]);
    for (const [key, uses] of reference) expect(edges.get(key)).toEqual(uses);
    for (const key of [
      "",
      "1",
      ":2",
      "01:2",
      "1:2:3",
      "NaN:3",
      "-1:3",
      "1:4294967296",
    ])
      expect(edges.has(key)).toBe(false);
    const visited: string[] = [];
    edges.forEach((_uses, key, map) => {
      expect(map).toBe(edges);
      visited.push(key);
    });
    expect(visited).toEqual([...reference.keys()]);
  });
});
