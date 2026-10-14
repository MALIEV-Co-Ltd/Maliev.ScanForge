import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-scan-controller-native.json";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";

function coordinates(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  return Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}

function bits(values: Float32Array) {
  return Buffer.from(
    values.buffer,
    values.byteOffset,
    values.byteLength,
  ).toString("hex");
}

it.each(native.cases)(
  "matches native primary scan Apply with native scheduling: $name",
  (sample) => {
    const matrix = nativeDatumInverseFrame(sample.frame);
    expect(
      bits(
        transformDatumCoordinates(
          coordinates(sample.sourcePositionsBits),
          matrix,
        ),
      ),
    ).toBe(sample.nativePositionsBits);
    expect(
      bits(
        transformDatumCoordinates(
          coordinates(sample.sourceNormalsBits),
          matrix,
          true,
        ),
      ),
    ).toBe(sample.nativeNormalsBits);
    expect(
      bits(
        transformDatumCoordinates(
          coordinates(sample.sourceFaceNormalsBits),
          matrix,
          true,
        ),
      ),
    ).toBe(sample.nativeFaceNormalsBits);
  },
);
