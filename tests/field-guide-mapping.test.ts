import { describe, expect, it } from "vitest";
import {
  mapCurvatureGuidePoints,
  type GuideMappingCache,
} from "../src/field-guide-mapping";
import { refreshCurvatureGuide } from "../src/field-guide-refresh";
import { deriveCurvaturePathAssociations } from "../src/field-curvature-associations";
import native from "./fixtures/field-native-guide-mapping.json";

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangles = new Uint32Array([0, 1, 2]);
const cache = (value: {
  points: number[];
  surfaceFaces: number[];
  mappedKinds: number[];
  mappedVertices: number[];
  metadata: number[];
}): GuideMappingCache => ({
  points: new Float32Array(value.points),
  surfaceFaces: new Int32Array(value.surfaceFaces),
  mappedKinds: new Int32Array(value.mappedKinds),
  mappedVertices: new Int32Array(value.mappedVertices),
  metadata: new Int32Array(value.metadata),
});

describe("recovered triangle guide mapping storage", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original mapping storage case $id",
    (entry) => {
      const queries: number[][] = [];
      const result = mapCurvatureGuidePoints(
        new Float32Array(entry.sourcePoints),
        new Int32Array(entry.sourceMetadata),
        new Float32Array(entry.positions),
        new Uint32Array(entry.triangles),
        (point, index) => {
          queries.push(Array.from(point));
          const hit = entry.hits[index];
          return { face: hit.face, point: new Float32Array(hit.point) };
        },
        entry.options,
        cache(entry.previous),
      );
      for (const key of [
        "points",
        "surfaceFaces",
        "mappedKinds",
        "mappedVertices",
        "metadata",
      ] as const)
        expect(Array.from(result[key])).toEqual(entry.output[key]);
      expect(queries).toEqual(entry.queries);
    },
  );
  it("filters missed points and their count-matched metadata", () => {
    const result = mapCurvatureGuidePoints(
      new Float32Array([0, 0, 1, 1, 0, 1, 2, 0, 1]),
      new Int32Array([10, 11, 12]),
      positions,
      triangles,
      (_, index) => ({
        face: index === 1 ? -1 : 0,
        point: new Float32Array([index, 0, 0]),
      }),
    );
    expect(Array.from(result.points)).toEqual([0, 0, 0, 2, 0, 0]);
    expect(Array.from(result.metadata)).toEqual([10, 12]);
    expect(Array.from(result.mappedKinds)).toEqual([4, 4]);
  });
  it("snaps inclusive squared-distance ties to the first face corner", () => {
    const result = mapCurvatureGuidePoints(
      new Float32Array([5, 0, 0, 6, 0, 0]),
      new Int32Array(),
      positions,
      new Uint32Array([2, 1, 0]),
      () => ({ face: 0, point: new Float32Array([0.5, 0.5, 0]) }),
      { snapToVertices: true, squaredSnapDistance: 0.5 },
    );
    expect(Array.from(result.points)).toEqual([0, 1, 0, 0, 1, 0]);
    expect(Array.from(result.mappedKinds)).toEqual([1, 1]);
    expect(Array.from(result.mappedVertices)).toEqual([2, 2]);
  });
  it("retains original coordinates when projection is disabled", () => {
    const source = new Float32Array([5, 0, 0, 6, 0, 0]);
    const result = mapCurvatureGuidePoints(
      source,
      new Int32Array([10]),
      positions,
      triangles,
      () => ({ face: 0, point: new Float32Array([0, 0, 0]) }),
      { project: false },
    );
    expect(result.points).toEqual(source);
    expect(result.metadata.length).toBe(0);
  });
  it("closes from the first stored record, including earlier output and single-point input", () => {
    const previous = cache({
      points: [9, 9, 9],
      surfaceFaces: [0],
      mappedKinds: [4],
      mappedVertices: [0],
      metadata: [77],
    });
    const result = mapCurvatureGuidePoints(
      new Float32Array([0, 0, 0]),
      new Int32Array([10]),
      positions,
      triangles,
      () => {
        throw new Error("single-point closure must not query");
      },
      {},
      previous,
    );
    expect(Array.from(result.points)).toEqual([9, 9, 9, 9, 9, 9]);
    expect(Array.from(result.metadata)).toEqual([77, 77]);
    expect(previous.points.length).toBe(3);
  });
  it("feeds mode-zero refresh output into recovered surface associations", () => {
    let refreshed: GuideMappingCache | undefined;
    const state = { refreshed: 0 };
    refreshCurvatureGuide(state, 0, (options) => {
      refreshed = mapCurvatureGuidePoints(
        new Float32Array([0, 0, 1, 1, 0, 1]),
        new Int32Array(),
        positions,
        triangles,
        (_, index) => ({ face: 0, point: new Float32Array([index, 0, 0]) }),
        {
          project: options.optionWord === 1,
          snapToVertices: false,
          squaredSnapDistance: options.scalar,
        },
      );
    });
    const result = deriveCurvaturePathAssociations(
      [
        {
          enabled: true,
          mode: 0,
          radius: 1,
          points: refreshed!.points,
          surfaceFaces: refreshed!.surfaceFaces,
          mappedKinds: refreshed!.mappedKinds,
          mappedVertices: refreshed!.mappedVertices,
        },
      ],
      positions,
      triangles,
    );
    expect(Array.from(result.vertexDistances)).toEqual([0, 0, 0]);
    expect(Array.from(result.seedPoints)).toEqual([0, 0, 0]);
    expect(result.faceDistances[0]).toBe(0);
  });
  it("owns input/output storage and rejects malformed query data or overflowing snap distances", () => {
    const source = new Float32Array([5, 0, 0, 6, 0, 0]);
    const query = () => ({ face: 0, point: new Float32Array([0, 0, 0]) });
    const result = mapCurvatureGuidePoints(
      source,
      new Int32Array(),
      positions,
      triangles,
      (point) => {
        point[0] = 99;
        return query();
      },
    );
    result.points[0] = 42;
    expect(source[0]).toBe(5);
    expect(positions[0]).toBe(0);
    expect(() =>
      mapCurvatureGuidePoints(
        source,
        new Int32Array(),
        positions,
        triangles,
        () => ({ face: 99, point: new Float32Array(3) }),
      ),
    ).toThrow("invalid data");
    expect(() =>
      mapCurvatureGuidePoints(
        new Float32Array([NaN, 0, 0]),
        new Int32Array(),
        positions,
        triangles,
        query,
      ),
    ).toThrow("finite");
    expect(() =>
      mapCurvatureGuidePoints(
        source,
        new Int32Array(),
        positions,
        triangles,
        () => ({ face: 0, point: new Float32Array([3e38, 0, 0]) }),
        { snapToVertices: true },
      ),
    ).toThrow("overflowed");
  });
});
