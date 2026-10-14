import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-controller-native.json";
import { nativeDatumInverseFrame } from "../src/scan-native-datum-apply";
import { nativeDatumTransformPrimitive } from "../src/scan-native-datum-primitive";
import type { Vec3 } from "../src/types";

function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}

it.each(native.cases)(
  "matches geometry from the complete native prepared Apply: $name",
  (sample) => {
    const matrix = nativeDatumInverseFrame(sample.frame);
    const source = structuredClone(sample.sourcePoints);
    const targets = new Set(sample.transformed);
    for (let i = 0; i < source.length; i++) {
      const center = targets.has(i)
        ? nativeDatumTransformPrimitive(
            { kind: "point", center: source[i] as Vec3 },
            matrix,
          ).center
        : source[i];
      expect(bits(center)).toBe(sample.nativePointBits[i]);
    }
    expect(source).toEqual(sample.sourcePoints);
    expect(bits(sample.frame)).toBe(sample.storedFrameBits);
  },
);
