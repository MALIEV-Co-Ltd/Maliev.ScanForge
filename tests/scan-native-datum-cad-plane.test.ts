import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-cad-plane-native.json";
import { nativeDatumCadPlaneReference } from "../src/scan-native-datum-cad";
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
  "matches original CAD controller on real native face: $name",
  (sample) => {
    const point = decode(sample.pointBits),
      du = decode(sample.duBits),
      dv = decode(sample.dvBits),
      reference = decode(sample.referenceBits);
    const result = nativeDatumCadPlaneReference(
      point,
      du,
      dv,
      sample.centered ? reference : undefined,
    );
    expect(bits(result.point)).toBe(sample.nativePointBits);
    expect(bits(result.normal)).toBe(sample.nativeNormalBits);
    expect(bits(point)).toBe(sample.pointBits);
    expect(bits(du)).toBe(sample.duBits);
    expect(bits(dv)).toBe(sample.dvBits);
    expect(bits(reference)).toBe(sample.referenceBits);
    if (!sample.centered) expect(sample.nativePointBits).toBe(sample.pointBits);
  },
);
it("retains the geometric normal across reversed CAD face orientation", () => {
  for (let i = 0; i < native.cases.length; i += 4) {
    expect(native.cases[i].reversed).toBe(false);
    expect(native.cases[i + 2].reversed).toBe(true);
    expect(native.cases[i].nativeNormalBits).toBe(
      native.cases[i + 2].nativeNormalBits,
    );
  }
});
