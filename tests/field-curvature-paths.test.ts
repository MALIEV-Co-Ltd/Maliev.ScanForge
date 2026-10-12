import { describe, expect, it } from "vitest";
import {
  applyCurvaturePathDirections,
  prepareCurvaturePathTangents,
  type CurvaturePathConstraint,
} from "../src/field-curvature-paths";
import { produceStableCurvatureDirections } from "../src/field-curvature-radius";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import native from "./fixtures/field-native-path-directions.json";

function edgeFixture(degree = 2, mode = 1, missed = false) {
  const paths: CurvaturePathConstraint[] = [
    {
      enabled: true,
      mode,
      points: new Float32Array([0, 0, 0, 1, 0, 0]),
      mappedVertices: new Int32Array(missed ? [-1, -1] : [0, 1]),
      mappedEdges: new Int32Array([missed ? -1 : 0]),
    },
  ];
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 2, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, -1]);
  const associations = {
    vertexDistances: new Float32Array(3),
    vertexSeeds: new Int32Array(3).fill(-1),
    seedPaths: new Int32Array(),
    seedPoints: new Int32Array(),
    faceDistances: new Float32Array([1, 1]),
  };
  const incidence = {
    edgeOffsets: new Uint32Array([0, degree]),
    halfedges: new Uint32Array([0, 3, 1].slice(0, degree)),
  };
  const directions = new Float32Array([0, 1, 0, 0, 1, 0]);
  const flags = new Uint8Array([128, 128]);
  const run = () =>
    applyCurvaturePathDirections(
      paths,
      positions,
      triangles,
      normals,
      associations,
      incidence,
      directions,
      flags,
    );
  return {
    paths,
    positions,
    triangles,
    normals,
    associations,
    incidence,
    directions,
    flags,
    run,
  };
}

describe("curvature refreshed path direction preparation", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original second-stage case $id",
    (entry) => {
      const paths = entry.paths.map((path) =>
        path
          ? {
              ...path,
              points: new Float32Array(path.points),
              mappedVertices: new Int32Array(path.mappedVertices),
              mappedEdges: new Int32Array(path.mappedEdges),
            }
          : null,
      );
      const result = applyCurvaturePathDirections(
        paths,
        new Float32Array(entry.positions),
        new Uint32Array(entry.triangles),
        new Float32Array(entry.normals),
        {
          vertexDistances: new Float32Array(entry.associations.vertexDistances),
          vertexSeeds: new Int32Array(entry.associations.vertexSeeds),
          seedPaths: new Int32Array(entry.associations.seedPaths),
          seedPoints: new Int32Array(entry.associations.seedPoints),
          faceDistances: new Float32Array(entry.associations.faceDistances),
        },
        {
          edgeOffsets: new Uint32Array(entry.incidence.edgeOffsets),
          halfedges: new Uint32Array(entry.incidence.halfedges),
        },
        new Float32Array(entry.previousDirections),
        new Uint8Array(entry.previousFlags),
      );
      expect(Array.from(result.directions)).toEqual(entry.directions);
      expect(Array.from(result.flags)).toEqual(entry.flags);
      expect(result.tangents.map((tangent) => Array.from(tangent))).toEqual(
        entry.tangents,
      );
    },
  );
  it("uses forward endpoints and centered interior path differences", () => {
    const [tangents] = prepareCurvaturePathTangents([
      {
        enabled: true,
        mode: 0,
        points: new Float32Array([0, 0, 0, 2, 0, 0, 2, 3, 0]),
      },
    ]);
    const length = Math.fround(Math.sqrt(13));
    expect(Array.from(tangents)).toEqual([
      1,
      0,
      0,
      Math.fround(2 / length),
      Math.fround(3 / length),
      0,
      0,
      1,
      0,
    ]);
  });
  it("preserves tiny differences and zero-initializes single points while skipping excluded paths", () => {
    const point = {
      enabled: true,
      mode: 0,
      points: new Float32Array([1, 2, 3]),
    };
    const result = prepareCurvaturePathTangents([
      null,
      { ...point, enabled: false },
      { ...point, mode: 3 },
      point,
      { ...point, points: new Float32Array([0, 0, 0, 1e-25, 0, 0]) },
    ]);
    expect(result.map((v) => v.length)).toEqual([0, 0, 0, 3, 6]);
    expect(Array.from(result[3])).toEqual([0, 0, 0]);
    expect(Array.from(result[4])).toEqual([
      Math.fround(1e-25),
      0,
      0,
      Math.fround(1e-25),
      0,
      0,
    ]);
  });
  it("reuses the projected scratch direction when all later corner distances equal the sentinel", () => {
    const positions = new Float32Array(18);
    const paths = [
      { enabled: true, mode: 0, points: new Float32Array([0, 0, 0, 1, 1, 0]) },
    ];
    const result = applyCurvaturePathDirections(
      paths,
      positions,
      new Uint32Array([0, 1, 2, 3, 4, 5]),
      new Float32Array([0, 0, 1, 1, 0, 0]),
      {
        vertexDistances: new Float32Array([
          0,
          0.1,
          0.2,
          Math.fround(3.4028235e38),
          Math.fround(3.4028235e38),
          Math.fround(3.4028235e38),
        ]),
        vertexSeeds: new Int32Array(6),
        seedPaths: new Int32Array([0]),
        seedPoints: new Int32Array([0]),
        faceDistances: new Float32Array([0.5, 0.5]),
      },
      { edgeOffsets: new Uint32Array([0]), halfedges: new Uint32Array() },
      new Float32Array(6),
      new Uint8Array([128, 128]),
    );
    const component = Math.fround(1 / Math.fround(Math.sqrt(2)));
    expect(Array.from(result.directions)).toEqual([
      component,
      component,
      0,
      0,
      component,
      0,
    ]);
    expect(Array.from(result.flags)).toEqual([5, 5]);
  });
  it("writes one/two incidences for both edge-guide modes and ignores zero/many incidences", () => {
    for (const mode of [1, 2])
      for (const degree of [0, 1, 2, 3]) {
        const result = edgeFixture(degree, mode).run();
        expect(Array.from(result.flags)).toEqual(
          degree === 1 ? [5, 128] : degree === 2 ? [5, 5] : [128, 128],
        );
        expect(Array.from(result.directions)).toEqual(
          degree === 1
            ? [1, 0, 0, 0, 1, 0]
            : degree === 2
              ? [1, 0, 0, 1, 0, 0]
              : [0, 1, 0, 0, 1, 0],
        );
      }
  });
  it("preserves missed mapped segments without dereferencing invalid vertices", () => {
    const fixture = edgeFixture(2, 1, true);
    const result = fixture.run();
    expect(result.directions).toEqual(fixture.directions);
    expect(result.flags).toEqual(fixture.flags);
  });
  it("feeds exact path flags into the constrained numerical worker", () => {
    const fixture = edgeFixture();
    const prepared = fixture.run();
    const radii = [
      {
        averages: new Float64Array(12),
        directions: prepared.directions.slice(),
        middleValues: new Float32Array([1, 1]),
        largestValues: new Float32Array([10, 10]),
        qualified: new Uint8Array([3]),
      },
    ];
    const previous = produceStableCurvatureDirections(radii, {
      backwardSpan: 0,
      forwardSpan: 0,
      ratioMinimum: 0.7,
      skippedFaces: new Uint8Array([3]),
    });
    previous.directions.set(prepared.directions);
    previous.flags.set(prepared.flags);
    const result = produceCurvatureDirections(
      radii,
      fixture.normals,
      new Float32Array([1]),
      {
        backwardSpan: 0,
        forwardSpan: 0,
        ratioMinimum: 0.7,
        normalThresholds: [0.4, 0.5, 0.8],
        previous,
      },
    );
    expect(result.directions).toEqual(prepared.directions);
    expect(Array.from(result.flags)).toEqual([7, 7]);
    expect(Array.from(result.strengths)).toEqual([50000, 50000]);
    expect(Array.from(result.selectedRadius)).toEqual([-1, -1]);
  });
  it("returns independent storage and rejects invalid cache references", () => {
    const fixture = edgeFixture();
    const result = fixture.run();
    result.directions[0] = 42;
    result.flags[0] = 42;
    result.tangents[0][0] = 42;
    expect(fixture.directions[0]).toBe(0);
    expect(fixture.flags[0]).toBe(128);
    expect(fixture.paths[0].points[0]).toBe(0);
    fixture.paths[0].mappedEdges = new Int32Array([1]);
    expect(fixture.run).toThrow("invalid geometry");
    fixture.paths[0].mappedEdges = new Int32Array();
    expect(fixture.run).toThrow("mapping is inconsistent");
    expect(() =>
      prepareCurvaturePathTangents([
        { enabled: true, mode: 0, points: new Float32Array([NaN, 0, 0]) },
      ]),
    ).toThrow("finite");
    expect(() =>
      prepareCurvaturePathTangents([
        {
          enabled: true,
          mode: 0,
          points: new Float32Array([0, 0, 0, 1e30, 0, 0]),
        },
      ]),
    ).toThrow("overflowed");
  });
});
