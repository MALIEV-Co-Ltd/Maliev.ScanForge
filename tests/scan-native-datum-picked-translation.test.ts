import { expect, it } from "vitest";
import native from "./fixtures/alignment-picked-translation-native.json";
import { nativeDatumTranslationFromPoint } from "../src/scan-native-datum-picked-translation";
it.each(native.cases.map((sample, index) => ({ sample, index })))(
  "matches original picked translation capture $index",
  ({ sample }) => {
    const input = Buffer.from(sample.pointBits, "hex");
    const point = Array.from({ length: 3 }, (_, i) =>
      input.readDoubleLE(i * 8),
    );
    if (!sample.updated) {
      expect(() =>
        nativeDatumTranslationFromPoint(
          sample.valid ? sample.frame : undefined,
          point,
        ),
      ).toThrow("sentinel");
      return;
    }
    const result = nativeDatumTranslationFromPoint(
      sample.valid ? sample.frame : undefined,
      point,
    );
    const bytes = Buffer.alloc(24);
    result.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
    expect(bytes.toString("hex")).toBe(sample.nativeBits);
  },
);
