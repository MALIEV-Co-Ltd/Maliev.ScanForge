import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-cad-transform-native.json";
import { nativeDatumCadTransform } from "../src/scan-native-datum-cad-transform";
it.each(native.cases)(
  "matches original exact-CAD placement matrix bytes: $name",
  (sample) => {
    const buffer = Buffer.from(sample.matrixBits, "hex");
    const input = Array.from({ length: 12 }, (_, i) =>
      buffer.readDoubleLE(i * 8),
    );
    const before = [...input],
      matrix = nativeDatumCadTransform(input),
      output = Buffer.alloc(96);
    matrix.forEach((value, i) => output.writeDoubleLE(value, i * 8));
    expect(output.toString("hex")).toBe(sample.nativeMatrixBits);
    expect(input).toEqual(before);
  },
);
