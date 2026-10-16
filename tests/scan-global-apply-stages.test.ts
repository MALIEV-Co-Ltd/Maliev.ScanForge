import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-apply-stages-native.json";
import {
  transformDatumCoordinateStages,
  transformDatumCoordinates,
} from "../src/datum-transform-kernel";
import { composeCloudPose } from "../src/point-cloud-placement";
const doubles = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Array.from({ length: b.length / 8 }, (_, i) => b.readDoubleLE(i * 8));
};
const floats = (hex: string) => {
  const b = Buffer.from(hex, "hex");
  return Float32Array.from({ length: b.length / 4 }, (_, i) =>
    b.readFloatLE(i * 4),
  );
};
const bits = (v: readonly number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cloudCases)(
  "matches original cloud setter composition for $name",
  (c) => {
    let pose = doubles(c.initialBits);
    const initial = [...pose];
    c.matrices.forEach((m, i) => {
      pose = composeCloudPose(doubles(m), pose);
      expect(bits(pose)).toBe(c.poseBits[i]);
    });
    expect(bits(initial)).toBe(c.initialBits);
    expect(c.sourcePayloadUnchanged).toBe(true);
  },
);
it("preserves the native mesh-versus-cloud rounding distinction", () => {
  const c = fixture.roundingWitness,
    input = floats(c.inputBits),
    matrices = c.matrices.map(doubles);
  expect(
    Buffer.from(
      transformDatumCoordinateStages(input, matrices).buffer,
    ).toString("hex"),
  ).toBe(c.meshBits);
  let pose = doubles(c.cloud.initialBits);
  matrices.forEach((m, i) => {
    pose = composeCloudPose(m, pose);
    expect(bits(pose)).toBe(c.cloud.poseBits[i]);
  });
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const cloud = transformDatumCoordinates(input, pose, false, bounds);
  expect(
    Buffer.from(
      Float32Array.from([...bounds.min, ...bounds.max]).buffer,
    ).toString("hex"),
  ).toBe(c.cloud.worldBoundsBits);
  expect(cloud[0]).toBe(100000008);
  expect(floats(c.meshBits)[0]).toBe(100000000);
});
