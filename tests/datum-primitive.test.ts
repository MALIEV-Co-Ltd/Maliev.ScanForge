import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-primitive-native.json";
import {
  nativeDatumTransformPrimitive,
  type DatumPrimitive,
} from "../src/scan-native-datum-primitive";
import { transformDatumCoordinates } from "../src/datum-transform-kernel";
const bits = (values: readonly number[]) => {
  const b = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => b.writeDoubleLE(value, i * 8));
  return b.toString("hex");
};
it.each(native.cases)("replays original $kind parameters: $name", (sample) => {
  const bytes = Buffer.from(sample.matrixBits, "hex"),
    matrix = Array.from({ length: 12 }, (_, i) => bytes.readDoubleLE(i * 8));
  const input: DatumPrimitive = {
    kind: sample.kind as DatumPrimitive["kind"],
    center: [3, 4, 5],
    direction: ["line", "plane", "cylinder", "cone"].includes(sample.kind)
      ? [0, 0, 1]
      : undefined,
    tangent: sample.kind === "plane" ? [1, 0, 0] : undefined,
    radius: sample.kind === "sphere" ? 2.25 : undefined,
    dimensions: ["cylinder", "cone"].includes(sample.kind)
      ? [2.25, 7.5]
      : undefined,
  };
  const before = structuredClone(input),
    result = nativeDatumTransformPrimitive(input, matrix);
  const output: Record<string, string> = { center: bits(result.center) };
  if (result.direction) output.direction = bits(result.direction);
  if (result.tangent) output.tangent = bits(result.tangent);
  if (result.planeD !== undefined) output.planeD = bits([result.planeD]);
  if (result.radius !== undefined) output.radius = bits([result.radius]);
  if (result.dimensions) output.dimensions = bits(result.dimensions);
  expect(output).toEqual(sample.outputBits);
  expect(input).toEqual(before);
  expect(bits(matrix)).toBe(sample.matrixBits);
  if (sample.displayBits) {
    const vertices = transformDatumCoordinates(
      new Float32Array([3, 4, 5, -2, 7, 1, 0, -0, 2]),
      matrix,
    );
    expect(Buffer.from(vertices.buffer).toString("hex")).toBe(
      sample.displayBits,
    );
    expect(sample.cacheDirty).toBe(true);
  }
});
