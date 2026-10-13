import { expect, it } from "vitest";
import native from "./fixtures/alignment-adjacency-spatial.json";
import { nativeAlignmentSpatialBucket } from "../src/scan-native-alignment-buckets";

const centers = native.centers.flat();
const children = new Int32Array((centers.length / 3) * 8).fill(-1);
native.childIndices.forEach((octant, node) => {
  children[node * 8 + octant] = node + 1;
});

it.each(native.cases)(
  "matches original spatial bucket lookup: %#",
  (sample) => {
    expect(
      nativeAlignmentSpatialBucket(
        sample.point,
        centers,
        children,
        sample.tolerance,
        sample.seed,
      ),
    ).toBe(sample.bucket);
  },
);
