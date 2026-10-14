import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-class-native.json";
import {
  nativeDatumPickedFeature,
  type NativeDatumFeatureGeometry,
} from "../src/scan-native-datum-feature";
function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
it.each(native.cases)("matches native fitted scene class: $name", (sample) => {
  const feature: NativeDatumFeatureGeometry = {
    kind: sample.kind as NativeDatumFeatureGeometry["kind"],
    origin: [...sample.origin],
    direction: [...sample.direction],
    length: sample.length,
  };
  const before = structuredClone(feature);
  const result = nativeDatumPickedFeature(
    feature,
    sample.reference as "plane" | "direction" | "point",
  );
  expect(Boolean(result)).toBe(sample.accepted);
  if (result) {
    expect(bits(result.point)).toBe(sample.nativePointBits);
    expect(bits(result.direction ?? [0, 0, 0])).toBe(
      sample.nativeDirectionBits,
    );
  }
  expect(feature).toEqual(before);
});
