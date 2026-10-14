import { expect, it } from "vitest";
import native from "./fixtures/alignment-reference-options-native.json";
import { nativeDatumReferenceOptions } from "../src/scan-native-datum-reference-options";

function decode(hex: string) {
  const bytes = Buffer.from(hex, "hex");
  const vector = (offset: number, length = 3) =>
    Array.from({ length }, (_, i) => bytes.readDoubleLE(offset + i * 8));
  return {
    matrix: vector(0, 12),
    flags: bytes.readUInt32LE(0x60),
    stage: bytes.readInt32LE(0x64),
    anchor: vector(0x68),
    linePoint: vector(0x80),
    planePoint: vector(0x98),
    lineDirection: vector(0xb0),
    planeNormal: vector(0xc8),
    primaryAxis: bytes.readInt32LE(0xe0),
    secondaryAxis: bytes.readInt32LE(0xe4),
  };
}
it.each(native.cases.map((sample, index) => ({ sample, index })))(
  "matches original axis resolver capture $index",
  ({ sample }) => {
    const state = decode(native.states[sample.stateIndex]);
    const before = structuredClone(state);
    const result = nativeDatumReferenceOptions(
      state,
      sample.stage as 0 | 1 | 2,
      sample.kind as "plane" | "direction" | "point" | "unsupported",
      sample.point,
      sample.direction,
      sample.flip,
    );
    expect(result.recognized).toBe(!!sample.nativeResult);
    expect(result.enabled).toEqual(sample.enabled);
    expect(result.visible).toEqual(sample.visible);
    expect(result.selectionCode).toBe(sample.selectionCode);
    expect(state).toEqual(before);
    expect(sample.stateAfter).toBe(native.states[sample.stateIndex]);
  },
);
