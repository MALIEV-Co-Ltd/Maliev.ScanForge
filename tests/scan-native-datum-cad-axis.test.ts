import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-cad-axis-native.json";
import { nativeDatumCadAxisReference } from "../src/scan-native-datum-cad";

function decode(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  return Array.from({ length: bytes.length / 8 }, (_, i) =>
    bytes.readDoubleLE(i * 8),
  );
}
function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
it.each(native.cases)(
  "matches original CAD axis controller: $name",
  (sample) => {
    const primitive = decode(sample.primitiveBits);
    const bounds = decode(sample.boundsBits);
    const result = nativeDatumCadAxisReference(
      sample.kind as "cylinder" | "cone" | "torus",
      primitive.slice(0, 3),
      primitive.slice(3, 6),
      bounds[2],
      bounds[3],
      primitive[12],
      primitive[13],
    );
    expect(bits(result.point)).toBe(sample.nativePointBits);
    expect(bits(result.direction)).toBe(sample.nativeAxisBits);
    expect(bits([result.length])).toBe(sample.nativeLengthBits);
    expect(bits(primitive)).toBe(sample.primitiveBits);
  },
);
it("retains CAD axis references across reversed face orientation", () => {
  for (let i = 0; i < native.cases.length; i += 2) {
    expect(native.cases[i].reversed).toBe(false);
    expect(native.cases[i + 1].reversed).toBe(true);
    for (const key of [
      "nativePointBits",
      "nativeAxisBits",
      "nativeLengthBits",
    ] as const)
      expect(native.cases[i][key]).toBe(native.cases[i + 1][key]);
  }
});
