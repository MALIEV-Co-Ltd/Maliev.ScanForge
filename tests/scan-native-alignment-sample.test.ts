import { expect, it } from "vitest";
import native from "./fixtures/alignment-sample-representative.json";
import { nativeAlignmentSampleRepresentative } from "../src/scan-native-alignment-sample";

it.each(native.samples)(
  "matches original sample-node accumulation: $name",
  (sample) => {
    expect(
      nativeAlignmentSampleRepresentative(
        sample.points.map((point, i) => ({ point, flags: sample.flags[i] })),
        sample.center,
      ),
    ).toEqual({
      nearestIndex: sample.nearestIndex,
      preferredIndex: sample.preferredIndex,
      nearestDistance: sample.nearestDistance,
      preferredDistance: sample.preferredDistance,
    });
  },
);
