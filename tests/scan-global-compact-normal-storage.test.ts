import fixture from "./fixtures/global-fine-mesh-correspondence-native.json";
import { meshCorrespondenceFixture } from "./helpers/global-mesh-correspondence-fixture";
import { createGlobalQueryWorkerState } from "../src/scan-global-query-worker";
import { expect, it } from "vitest";
import { nativeGlobalFacetNormal } from "../src/scan-native-global-facet-normal";
import {
  nativeGlobalFacetNormals,
  prepareNativeGlobalMeshEvaluator,
  resumeNativeGlobalMeshEvaluator,
} from "../src/scan-native-global-surface";
import { prepareNativeGlobalMeshTarget } from "../src/scan-native-global-mesh-target";
import { nativeGlobalPackedEvaluator } from "../src/scan-native-global-packed-evaluator";

const mesh = () => ({
  vertices: Float32Array.of(
    0,
    0,
    0,
    1.125,
    -0,
    0,
    0,
    1.25,
    0,
    0,
    0,
    0,
    1e-10,
    0,
    0,
    0,
    1e-10,
    0,
  ),
  triangles: Uint32Array.of(0, 1, 2, 3, 4, 5),
  packedNodes: true,
  compactBounds: true,
});
const words = (values: ArrayLike<number>) =>
  Array.from(new Uint32Array(Float64Array.from(values).buffer));

it("opts into an empty normal cache while preserving degenerate masks and exact query payloads", () => {
  const full = mesh(),
    compact = { ...mesh(), compactNormals: true };
  const cached = prepareNativeGlobalMeshEvaluator(full);
  const derived = prepareNativeGlobalMeshEvaluator(compact);
  expect(cached.surface.normals.length).toBe(full.triangles.length);
  expect(derived.surface.normals.length).toBe(0);
  expect(derived.degenerate).toEqual(cached.degenerate);
  expect(Array.from(derived.degenerate)).toEqual([0, 1]);
  const a = prepareNativeGlobalMeshTarget(full),
    b = prepareNativeGlobalMeshTarget(compact);
  for (const point of [
    [0.2, 0.2, 0.1],
    [0, 0, -0.1],
    [1.125, 0, 0],
    [2, 2, 2],
  ]) {
    const expected = a.query(point, 1),
      actual = b.query(point, 1);
    expect(actual.found).toBe(expected.found);
    expect(
      words([
        ...actual.point,
        ...actual.normal,
        actual.signedDistance,
        actual.edgeFlags,
        actual.neighbours,
      ]),
    ).toEqual(
      words([
        ...expected.point,
        ...expected.normal,
        expected.signedDistance,
        expected.edgeFlags,
        expected.neighbours,
      ]),
    );
  }
  expect(full.vertices).toEqual(compact.vertices);
  expect(full.triangles).toEqual(compact.triangles);
});

it("rejects mismatched compact normal resume policy and inconsistent empty/full carriers", () => {
  const input = { ...mesh(), compactNormals: true };
  const evaluator = prepareNativeGlobalMeshEvaluator(input);
  const data = {
    packedIndex: evaluator.packedIndex,
    root: evaluator.root,
    surface: evaluator.surface,
    degenerate: evaluator.degenerate,
    minimumExtent: evaluator.minimumExtent,
  };
  const mismatched = { ...input, compactNormals: false };
  expect(() => resumeNativeGlobalMeshEvaluator(mismatched, data)).toThrow(
    "policy mismatch",
  );
  expect(() =>
    nativeGlobalPackedEvaluator({
      ...evaluator.surface,
      ...{ deriveNormals: false },
    }),
  ).toThrow();
  expect(() =>
    nativeGlobalPackedEvaluator({
      ...evaluator.surface,
      normals: new Float32Array(input.triangles.length),
    }),
  ).toThrow();
  expect(() =>
    prepareNativeGlobalMeshEvaluator({
      ...mesh(),
      compactNormals: "bad",
    } as unknown as typeof input),
  ).toThrow("normal storage policy");
});
it("preserves primitive Float32 output bits for regular, tiny and signed-zero triangles", () => {
  const vertices = mesh().vertices,
    triangles = mesh().triangles;
  const cached = nativeGlobalFacetNormals(vertices, triangles);
  const scratch = new Float32Array(3);
  for (let face = 0; face < triangles.length / 3; face++) {
    expect(nativeGlobalFacetNormal(vertices, triangles, face, scratch)).toBe(
      cached.degenerate[face],
    );
    expect(Array.from(new Uint32Array(scratch.buffer))).toEqual(
      Array.from(new Uint32Array(cached.normals.buffer, face * 12, 3)),
    );
  }
  expect(scratch[2]).toBeGreaterThan(0);
  expect(scratch[2]).toBeLessThan(Number.EPSILON);
});
it.each(fixture.cases)(
  "preserves original native correspondence bits with compact normals: $name $mode",
  (c) => {
    const { scans, job } = meshCorrespondenceFixture(c);
    const compactScans = scans.map((scan) => ({
      ...scan,
      geometry: {
        ...scan.geometry,
        targetMeshes: scan.geometry.targetMeshes?.map((target) => ({
          ...target,
          packedNodes: true,
          compactBounds: true,
          compactNormals: true,
        })),
      },
    }));
    const state = createGlobalQueryWorkerState({ scans: compactScans });
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = state.execute(job);
      expect(result.count).toBe(c.count);
      expect(
        result.pairs.map((pair) => ({
          id: pair.id,
          active: pair.active,
          numericBits: Buffer.from(
            Float64Array.from([...pair.source, ...pair.target, pair.distance])
              .buffer,
          ).toString("hex"),
        })),
      ).toEqual(
        c.results.map((pair) => ({
          id: pair.id,
          active: pair.active,
          numericBits: pair.numericBits,
        })),
      );
    }
  },
);
