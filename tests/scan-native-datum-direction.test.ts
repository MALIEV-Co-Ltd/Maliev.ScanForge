import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-direction-native.json";
import {
  createNativeDatumPlaneState,
  nativeDatumPlaneReference,
  nativeDatumPointReference,
  nativeDatumDirectionReference,
  type NativeDatumPlaneState,
} from "../src/scan-native-datum-plane";

function bits(state: NativeDatumPlaneState) {
  const bytes = Buffer.alloc(0xe8);
  const vector = (values: number[], offset: number) =>
    values.forEach((value, i) => bytes.writeDoubleLE(value, offset + i * 8));
  vector(state.matrix, 0);
  bytes.writeUInt32LE(state.flags, 0x60);
  bytes.writeInt32LE(state.stage, 0x64);
  vector(state.anchor, 0x68);
  vector(state.linePoint, 0x80);
  vector(state.planePoint, 0x98);
  vector(state.lineDirection, 0xb0);
  vector(state.planeNormal, 0xc8);
  bytes.writeInt32LE(state.primaryAxis, 0xe0);
  bytes.writeInt32LE(state.secondaryAxis, 0xe4);
  return bytes.toString("hex");
}

function decode(hex: string): NativeDatumPlaneState {
  const bytes = Buffer.from(hex, "hex");
  const vector = (offset: number, count = 3) =>
    Array.from({ length: count }, (_, i) => bytes.readDoubleLE(offset + i * 8));
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

it.each(native.cases)(
  "matches native direction construction: $name",
  (sample) => {
    // Setup is native execution, independent of the application's other constructors.
    const state = decode(sample.beforeBits);
    expect(bits(state)).toBe(sample.beforeBits);
    const result = nativeDatumDirectionReference(
      state,
      sample.stage as 0 | 1 | 2,
      sample.point,
      sample.normal,
      sample.axis as 0 | 1 | 2,
    );
    expect(result.accepted).toBe(sample.accepted);
    expect(bits(state)).toBe(sample.beforeBits);
    expect(bits(result.state)).toBe(sample.nativeBits);
  },
);

it.each(native.cases)("replays mixed native setup: $name", (sample) => {
  let state = createNativeDatumPlaneState();
  for (const step of sample.setup) {
    const stage = step.stage as 0 | 1 | 2,
      axis = step.axis as 0 | 1 | 2;
    const result =
      step.kind === "point"
        ? nativeDatumPointReference(state, stage, step.point)
        : step.kind === "plane"
          ? nativeDatumPlaneReference(
              state,
              stage,
              step.point,
              step.normal,
              axis,
            )
          : nativeDatumDirectionReference(
              state,
              stage,
              step.point,
              step.normal,
              axis,
            );
    expect(result.accepted).toBe(step.accepted);
    expect(bits(result.state)).toBe(step.nativeBits);
    state = result.state;
  }
  expect(bits(state)).toBe(sample.beforeBits);
  const result = nativeDatumDirectionReference(
    state,
    sample.stage as 0 | 1 | 2,
    sample.point,
    sample.normal,
    sample.axis as 0 | 1 | 2,
  );
  expect(result.accepted).toBe(sample.accepted);
  expect(bits(result.state)).toBe(sample.nativeBits);
});
