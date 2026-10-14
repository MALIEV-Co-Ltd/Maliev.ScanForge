import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-identity-native.json";
import { nativeDatumIsIdentity } from "../src/scan-native-datum-apply";
it.each(native.cases)(
  "matches the original Apply identity gate: $name",
  (sample) => {
    const bytes = Buffer.from(sample.matrixBits, "hex");
    const matrix = Array.from({ length: 12 }, (_, i) =>
      bytes.readDoubleLE(i * 8),
    );
    expect(nativeDatumIsIdentity(matrix, sample.tolerance)).toBe(
      sample.nativeIdentity,
    );
  },
);
