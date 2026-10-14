import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-translation-native.json";
import { nativeDatumTranslation } from "../src/scan-native-datum-translation";
it.each(native.cases)(
  "matches original frame translation bytes: $name",
  (sample) => {
    const input = Array.from({ length: 12 }, (_, i) =>
      Buffer.from(sample.matrixBits, "hex").readDoubleLE(i * 8),
    );
    const before = [...input];
    const output = nativeDatumTranslation(input, sample.offsets);
    const bytes = Buffer.alloc(96);
    output.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
    expect(bytes.toString("hex")).toBe(sample.nativeBits);
    expect(input).toEqual(before);
  },
);
it("rejects invalid offsets and overflow", () => {
  const frame = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  expect(() => nativeDatumTranslation(frame, [0, NaN, 0])).toThrow();
  expect(() => nativeDatumTranslation(frame, [0, 0])).toThrow();
  expect(() =>
    nativeDatumTranslation(
      frame.map(() => Number.MAX_VALUE),
      [2, 2, 2],
    ),
  ).toThrow();
});
