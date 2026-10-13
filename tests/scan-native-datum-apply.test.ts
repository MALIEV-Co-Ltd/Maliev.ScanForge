import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-apply-native.json";
import {
  nativeDatumPlaneGeometry,
  nativeDatumInverseFrame,
} from "../src/scan-native-datum-apply";

function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
function decode(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  return Array.from({ length: bytes.length / 8 }, (_, i) =>
    bytes.readDoubleLE(i * 8),
  );
}
it.each(native.planes)(
  "matches native picked plane conversion: $name",
  (sample) => {
    expect(sample.accepted).toBe(true);
    const center = [...sample.center],
      normal = [...sample.normal],
      reference = [...sample.reference];
    const result = nativeDatumPlaneGeometry(
      center,
      normal,
      sample.offset,
      sample.centered ? reference : undefined,
    );
    expect(bits(result.point)).toBe(sample.nativePointBits);
    expect(bits(result.normal)).toBe(sample.nativeNormalBits);
    expect(center).toEqual(sample.center);
    expect(normal).toEqual(sample.normal);
    expect(reference).toEqual(sample.reference);
  },
);
it.each(native.inverses)(
  "matches native Apply frame inversion: $name",
  (sample) => {
    const matrix = decode(sample.matrixBits);
    expect(bits(nativeDatumInverseFrame(matrix))).toBe(sample.nativeBits);
    expect(bits(matrix)).toBe(sample.matrixBits);
  },
);
