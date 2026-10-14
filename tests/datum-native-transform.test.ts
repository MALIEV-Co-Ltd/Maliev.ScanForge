import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-mesh-transform-native.json";
import { transformDatumCoordinates } from "../src/datum-alignment";
function floats(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) =>
    bytes.readFloatLE(i * 4),
  );
}
it.each(native.cases)(
  "matches original vertex and face-normal workers: $name",
  (sample) => {
    const matrixBytes = Buffer.from(sample.matrixBits, "hex");
    const matrix = Array.from({ length: 12 }, (_, i) =>
      matrixBytes.readDoubleLE(i * 8),
    );
    const positions = transformDatumCoordinates(
      floats(sample.positionsBits),
      matrix,
    );
    const normals = transformDatumCoordinates(
      floats(sample.normalsBits),
      matrix,
      true,
    );
    expect(Buffer.from(positions.buffer).toString("hex")).toBe(
      sample.nativePositionsBits,
    );
    expect(Buffer.from(normals.buffer).toString("hex")).toBe(
      sample.nativeNormalsBits,
    );
    expect(Buffer.from(normals.buffer).toString("hex")).toBe(
      sample.nativeFaceNormalsBits,
    );
  },
);
