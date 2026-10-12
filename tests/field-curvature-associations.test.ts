import { describe, expect, it } from "vitest";
import {
  deriveCurvaturePathAssociations,
  type CurvatureAssociationSource,
} from "../src/field-curvature-associations";
import { applyCurvaturePathDirections } from "../src/field-curvature-paths";
import { produceStableCurvatureDirections } from "../src/field-curvature-radius";
import { produceCurvatureDirections } from "../src/field-curvature-directions";
import native from "./fixtures/field-native-associations.json";

const maximum = Math.fround(3.4028235e38);
function fixture(radius = 2) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 2, 3]);
  const adjacency = {
    edgeVertices: new Int32Array([0, 1, 1, 2, 2, 3]),
    vertexEdgeOffsets: new Uint32Array([0, 1, 3, 5, 6]),
    vertexEdges: new Uint32Array([0, 0, 1, 1, 2, 2]),
  };
  const paths: (CurvatureAssociationSource | null)[] = [
    {
      enabled: true,
      mode: 1,
      radius,
      points: new Float32Array([0, 0, 0]),
      mappedKinds: new Int32Array([1]),
      mappedVertices: new Int32Array([0]),
    },
  ];
  return {
    positions,
    triangles,
    adjacency,
    paths,
    run: () =>
      deriveCurvaturePathAssociations(paths, positions, triangles, adjacency),
  };
}

describe("refreshed guide association stage", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original first-stage case $id",
    (entry) => {
      const paths = entry.paths.map((path) =>
        path
          ? {
              ...path,
              points: new Float32Array(path.points),
              surfaceFaces: new Int32Array(path.surfaceFaces),
              mappedKinds: new Int32Array(path.mappedKinds),
              mappedVertices: new Int32Array(path.mappedVertices),
            }
          : null,
      );
      const result = deriveCurvaturePathAssociations(
        paths,
        new Float32Array(entry.positions),
        new Uint32Array(entry.triangles),
        {
          edgeVertices: new Int32Array(entry.adjacency.edgeVertices),
          vertexEdgeOffsets: new Uint32Array(entry.adjacency.vertexEdgeOffsets),
          vertexEdges: new Uint32Array(entry.adjacency.vertexEdges),
        },
      );
      for (const key of [
        "vertexDistances",
        "vertexSeeds",
        "seedPaths",
        "seedPoints",
        "faceDistances",
      ] as const)
        expect(Array.from(result[key])).toEqual(entry.output[key]);
    },
  );
  it("uses the strict twice-radius gate and preserves unassociated face sentinels", () => {
    const limited = fixture(1).run();
    expect(Array.from(limited.vertexDistances)).toEqual([
      0,
      1,
      maximum,
      maximum,
    ]);
    expect(Array.from(limited.vertexSeeds)).toEqual([0, 0, -1, -1]);
    expect(Array.from(limited.faceDistances)).toEqual([maximum, maximum]);
    const full = fixture().run();
    expect(Array.from(full.vertexDistances)).toEqual([0, 1, 2, 3]);
    expect(Array.from(full.faceDistances)).toEqual([0.5, 1]);
  });
  it("preserves first source priority for repeated seeds and FIFO competition", () => {
    const data = fixture();
    data.paths.push({
      ...data.paths[0]!,
      points: new Float32Array([3, 0, 0]),
      mappedVertices: new Int32Array([3]),
    });
    const result = data.run();
    expect(Array.from(result.vertexDistances)).toEqual([0, 1, 1, 0]);
    expect(Array.from(result.vertexSeeds)).toEqual([0, 0, 1, 1]);
    expect(Array.from(result.seedPaths)).toEqual([0, 1]);
    data.paths.push({ ...data.paths[0]!, radius: 100 });
    expect(data.run()).toEqual(result);
  });
  it("enforces the float monotonic distance increment over a detour", () => {
    const data = fixture(10);
    data.positions.set([2, 0, 0], 3);
    data.positions.set([1, 0, 0], 6);
    expect(data.run().vertexDistances[2]).toBe(
      Math.fround(2 * Math.fround(1.005)),
    );
  });
  it("uses mapped mesh points when refreshed world points are empty", () => {
    const data = fixture();
    data.paths[0]!.points = new Float32Array();
    data.paths[0]!.mappedVertices = new Int32Array([3]);
    expect(Array.from(data.run().vertexDistances)).toEqual([3, 2, 1, 0]);
  });
  it("excludes disabled, null and mode-three sources", () => {
    const data = fixture();
    data.paths[0]!.enabled = false;
    data.paths.push(null, { ...data.paths[0]!, enabled: true, mode: 3 });
    const result = data.run();
    expect(Array.from(result.vertexSeeds)).toEqual([-1, -1, -1, -1]);
    expect(result.seedPaths.length).toBe(0);
    expect(Array.from(result.faceDistances)).toEqual([maximum, maximum]);
  });
  it("feeds recovered surface associations through path constraints into numerical directions", () => {
    const data = fixture();
    data.paths[0] = {
      enabled: true,
      mode: 0,
      radius: 2,
      points: new Float32Array([0, 0, 0, 3, 0, 0]),
      surfaceFaces: new Int32Array([0, 1]),
    };
    const associations = data.run();
    expect(Array.from(associations.seedPoints)).toEqual([0, 0, 0, 1]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1]);
    const prepared = applyCurvaturePathDirections(
      data.paths,
      data.positions,
      data.triangles,
      normals,
      associations,
      { edgeOffsets: new Uint32Array([0]), halfedges: new Uint32Array() },
      new Float32Array(6),
      new Uint8Array(2),
    );
    expect(Array.from(prepared.directions)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.from(prepared.flags)).toEqual([5, 5]);
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
      normals,
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
  it("owns returned state and rejects malformed caches, guides and overflowing distances", () => {
    const data = fixture();
    const first = data.run();
    first.vertexDistances[0] = 42;
    expect(data.run().vertexDistances[0]).toBe(0);
    data.adjacency.vertexEdges[0] = 99;
    expect(data.run).toThrow("inconsistent");
    data.adjacency.vertexEdges[0] = 0;
    data.paths[0]!.radius = 0;
    expect(data.run).toThrow("invalid");
    data.paths[0]!.radius = 2;
    data.paths[0]!.mappedVertices![0] = 99;
    expect(data.run).toThrow("invalid vertex");
    data.paths[0]!.mappedVertices![0] = 0;
    data.positions[3] = 3e38;
    expect(data.run).toThrow("overflowed");
  });
});
