import { describe, expect, it } from "vitest";
import {
  queryGuideSurface,
  type GuideQuerySurface,
} from "../src/field-surface-query";
import { mapCurvatureGuidePoints } from "../src/field-guide-mapping";
import native from "./fixtures/field-native-surface-query.json";

function surface(): GuideQuerySurface {
  const bounds = new Float32Array([0, 0, 0, 2, 2, 0]);
  return {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    triangles: new Uint32Array([0, 1, 2, 0, 1, 2]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1]),
    bounds,
    faces: new Uint32Array([0, 1]),
    nodes: [{ bounds, range: [0, 2] }],
    root: 0,
  };
}

describe("recovered triangle-storage query traversal", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original query case $id",
    (entry) => {
      const geometry: GuideQuerySurface = {
        positions: new Float32Array(entry.positions),
        triangles: new Uint32Array(entry.triangles),
        normals: new Float32Array(entry.normals),
        bounds: new Float32Array(entry.bounds),
        faces: new Uint32Array(entry.faces),
        root: entry.root,
        nodes: entry.nodes.map((node) => ({
          bounds: new Float32Array(node.bounds),
          ...("range" in node && node.range
            ? { range: [node.range[0], node.range[1]] as const }
            : {}),
          ...("children" in node && node.children
            ? { children: [node.children[0], node.children[1]] as const }
            : {}),
        })),
      };
      const initial = new Float32Array([11, 22, 33]);
      const result = queryGuideSurface(
        geometry,
        new Float32Array(entry.point),
        entry.threshold,
        initial,
      );
      expect(result.face).toBe(entry.face);
      expect(result.secondaryFace).toBe(entry.secondaryFace);
      expect(result.distance).toBe(entry.distance);
      expect([...result.point]).toEqual(entry.projected);
      expect([...initial]).toEqual([11, 22, 33]);
    },
  );
  it("maps source guides through bounds, traversal and actual triangle projection", () => {
    const geometry = surface();
    const source = new Float32Array([0.5, 0.5, 0.01, 0.75, 0.5, 0.01]);
    const mapped = mapCurvatureGuidePoints(
      source,
      new Int32Array([10, 20]),
      geometry.positions,
      geometry.triangles,
      (point) => queryGuideSurface(geometry, point, -1),
    );
    expect([...mapped.points]).toEqual([0.5, 0.5, 0, 0.75, 0.5, 0]);
    expect([...mapped.surfaceFaces]).toEqual([0, 0]);
    expect([...mapped.metadata]).toEqual([10, 20]);
  });
  it("retains the first visited equal-distance face", () => {
    const result = queryGuideSurface(
      surface(),
      new Float32Array([0.5, 0.5, 1]),
      2,
    );
    expect(result.face).toBe(0);
    expect(result.secondaryFace).toBe(0);
    expect(result.distance).toBe(1);
    expect([...result.point]).toEqual([0.5, 0.5, 0]);
  });
  it("visits the second child first", () => {
    const geometry = surface();
    geometry.nodes = [
      { bounds: geometry.bounds, children: [1, 2] },
      { bounds: geometry.bounds, range: [0, 1] },
      { bounds: geometry.bounds, range: [1, 2] },
    ];
    expect(
      queryGuideSurface(geometry, new Float32Array([0.5, 0.5, 1]), 2).face,
    ).toBe(1);
  });
  it("requires strict improvement and preserves caller output on a miss", () => {
    const initial = new Float32Array([11, 22, 33]);
    const result = queryGuideSurface(
      surface(),
      new Float32Array([0.5, 0.5, 1]),
      1,
      initial,
    );
    expect(result.face).toBe(-1);
    expect(result.distance).toBe(1);
    expect([...result.point]).toEqual([...initial]);
    result.point[0] = 99;
    expect(initial[0]).toBe(11);
  });
  it("uses the bounds fraction for negative thresholds and handles no root", () => {
    const geometry = surface();
    geometry.root = null;
    const result = queryGuideSurface(geometry, new Float32Array(3), -1);
    expect(result.face).toBe(-1);
    expect(result.distance).toBe(
      Math.fround(Math.fround(Math.sqrt(8)) * Math.fround(0.025)),
    );
  });
  it("rejects cyclic supplied trees", () => {
    const geometry = surface();
    geometry.nodes = [{ bounds: geometry.bounds, children: [0, 0] }];
    expect(() => queryGuideSurface(geometry, new Float32Array(3), 2)).toThrow(
      "cyclic",
    );
  });
});
