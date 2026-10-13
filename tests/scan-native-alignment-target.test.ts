import { expect, it } from "vitest";
import native from "./fixtures/alignment-target-builder.json";
import { prepareNativeAlignmentTarget } from "../src/scan-native-alignment-target";
import { queryNoiseOctree } from "../src/scan-noise-octree-query";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";

it.each(
  native.cases.flatMap((sample) => [
    { ...sample, indexed: false },
    { ...sample, indexed: true },
  ]),
)("matches original target builder: $name indexed=$indexed", (sample) => {
  const input = sample.indexed
    ? {
        coordinates: new Float32Array(sample.points.flat(2)),
        indices: Uint32Array.from(
          { length: sample.points.length * 3 },
          (_, id) => id,
        ),
      }
    : sample.points;
  const result = prepareNativeAlignmentTarget(input, {
    minimumExtent: sample.minextent,
    filterExcluded: sample.filterHidden,
    triangleFlags: sample.flags,
    cachedBounds: sample.cachedBounds
      ? [
          sample.cachedBounds[0],
          sample.cachedBounds[1],
          sample.cachedBounds[2],
          sample.cachedBounds[3],
          sample.cachedBounds[4],
          sample.cachedBounds[5],
        ]
      : undefined,
  });
  expect(result?.root).toMatchObject(sample.root);
  for (const query of sample.samples) {
    const hit = queryNoiseOctree(
      result!.root,
      query.point,
      query.radius,
      result!.triangleBounds,
      (id, radius) =>
        noiseTriangleDistance(
          query.point,
          sample.points[id][0],
          sample.points[id][1],
          sample.points[id][2],
          radius,
        ),
    );
    expect(hit?.triangle ?? null).toBe(query.winner);
    expect(hit?.distance ?? null).toBe(query.distance);
  }
});

it("returns no target when every triangle is excluded", () => {
  expect(
    prepareNativeAlignmentTarget(
      [
        [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
      ],
      {
        filterExcluded: true,
        triangleFlags: [2],
      },
    ),
  ).toBeUndefined();
});
