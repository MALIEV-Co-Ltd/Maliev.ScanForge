import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-feature-native.json";
import {
  nativeDatumAxisGeometry,
  nativeDatumPointGeometry,
  type NativeDatumAxisPlacement,
} from "../src/scan-native-datum-feature";

function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
it.each(native.axes)(
  "matches original feature axis conversion: $name",
  (sample) => {
    expect(sample.accepted).toBe(true);
    const placements: NativeDatumAxisPlacement[] = [
      "segmentMidpoint",
      "extrusionMidpoint",
      "origin",
    ];
    const origin = [...sample.origin],
      direction = [...sample.direction];
    const result = nativeDatumAxisGeometry(
      origin,
      direction,
      sample.length,
      placements[sample.mode],
    );
    expect(bits(result.point)).toBe(sample.nativePointBits);
    expect(bits(result.direction)).toBe(sample.nativeDirectionBits);
    expect(origin).toEqual(sample.origin);
    expect(direction).toEqual(sample.direction);
  },
);
it.each(native.points)(
  "matches original feature point conversion: $name",
  (sample) => {
    expect(sample.accepted).toBe(true);
    const origin = [...sample.origin];
    expect(bits(nativeDatumPointGeometry(origin))).toBe(sample.nativePointBits);
    expect(origin).toEqual(sample.origin);
  },
);
