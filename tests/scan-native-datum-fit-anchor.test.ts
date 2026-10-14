import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-fit-anchor-native.json";
import {
  nativeDatumFitFeature,
  nativeDatumPickedFeature,
} from "../src/scan-native-datum-feature";
import type { FitResult } from "../src/types";
function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
it.each(native.cases)(
  "maps authored fit anchors through original converter: $name",
  (sample) => {
    const fit = structuredClone(sample.fit) as FitResult;
    const feature = nativeDatumFitFeature(
      fit,
      fit.kind === "cone" ? sample.origin : undefined,
    );
    expect(bits(feature.origin)).toBe(bits(sample.origin));
    const result = nativeDatumPickedFeature(
      feature,
      sample.reference as "plane" | "direction" | "point",
      sample.referencePoint ?? undefined,
    );
    expect(Boolean(result)).toBe(sample.accepted);
    if (result) {
      expect(bits(result.point)).toBe(sample.nativePointBits);
      expect(bits(result.direction ?? [0, 0, 0])).toBe(
        sample.nativeDirectionBits,
      );
    }
    expect(fit).toEqual(sample.fit);
  },
);
it("rejects incomplete cylinder height and invalid reference axes", () => {
  const fit: FitResult = {
    kind: "cylinder",
    center: [1, 2, 3],
    axis: [0, 0, 1],
    rms: 0,
    maxError: 0,
  };
  expect(() => nativeDatumFitFeature(fit)).toThrow("height");
  expect(() => nativeDatumFitFeature({ ...fit, height: NaN })).toThrow(
    "height",
  );
  expect(() => nativeDatumFitFeature({ ...fit, height: -1 })).toThrow("height");
  expect(() =>
    nativeDatumFitFeature({ ...fit, height: 1, axis: [0, 0, 0] }),
  ).toThrow("zero reference axis");
  expect(() =>
    nativeDatumFitFeature({ ...fit, kind: "cone", height: 1 }),
  ).toThrow("verified native origin metadata");
});

it("keeps an explicit native cone origin separate from the application base center", () => {
  const sample = native.cases.find(
    (value) => value.kind === "cone" && value.reference === "point",
  )!;
  const fit = { ...sample.fit, center: [100, 200, 300] } as FitResult;
  const feature = nativeDatumFitFeature(fit, sample.origin);
  const result = nativeDatumPickedFeature(feature, "point")!;
  expect(bits(result.point)).toBe(sample.nativePointBits);
  expect(fit.center).toEqual([100, 200, 300]);
});
