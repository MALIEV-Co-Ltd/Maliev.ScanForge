import { expect, it } from "vitest";
import { evaluateCadAlignmentReference } from "../src/cad/alignment-reference";
import axes from "./fixtures/alignment-datum-cad-axis-native.json";
import planes from "./fixtures/alignment-datum-cad-plane-native.json";
import type { Vec3 } from "../src/types";
const identity = { faceIndex: 3, firstTriangle: 45, triangleCount: 17 };
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
it.each(axes.cases)("transports native CAD axis inputs: $name", (sample) => {
  const primitive = decode(sample.primitiveBits),
    bounds = decode(sample.boundsBits);
  const input = {
    ...identity,
    kind: sample.kind as "cylinder" | "cone" | "torus",
    location: primitive.slice(0, 3) as Vec3,
    axis: primitive.slice(3, 6) as Vec3,
    firstV: bounds[2],
    lastV: bounds[3],
    radius: primitive[12],
    semiAngle: primitive[13],
  };
  const before = structuredClone(input);
  const result = evaluateCadAlignmentReference(input);
  if (!("direction" in result)) throw new Error("Missing axis result");
  expect(bits(result.point)).toBe(sample.nativePointBits);
  expect(bits(result.direction)).toBe(sample.nativeAxisBits);
  expect(bits([result.length])).toBe(sample.nativeLengthBits);
  expect(result).toMatchObject(identity);
  if (input.kind === "cylinder")
    expect(result).toHaveProperty("radiusMm", input.radius);
  else expect(result).not.toHaveProperty("radiusMm");
  expect(input).toEqual(before);
});
it.each(planes.cases)("transports native CAD plane inputs: $name", (sample) => {
  const input = {
    ...identity,
    kind: "plane" as const,
    evaluatedPoint: decode(sample.pointBits) as Vec3,
    derivativeU: decode(sample.duBits) as Vec3,
    derivativeV: decode(sample.dvBits) as Vec3,
  };
  const before = structuredClone(input);
  const result = evaluateCadAlignmentReference(
    input,
    sample.centered ? (decode(sample.referenceBits) as Vec3) : undefined,
  );
  if (!("normal" in result)) throw new Error("Missing plane result");
  expect(bits(result.point)).toBe(sample.nativePointBits);
  expect(bits(result.normal)).toBe(sample.nativeNormalBits);
  expect(result).toMatchObject(identity);
  expect(input).toEqual(before);
});
it("preserves unsupported faces without inventing a plane or axis", () => {
  expect(
    evaluateCadAlignmentReference({
      ...identity,
      kind: "unsupported",
      surfaceType: 6,
    }),
  ).toEqual({ ...identity, kind: "unsupported", surfaceType: 6 });
});
