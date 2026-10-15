import { expect, it } from "vitest";
import native from "./fixtures/interactive-mirror-point-selection-native.json";
import { nativeInteractiveMirrorPoints } from "../src/interactive-mirror-selection";
it.each(native.cases.map((sample, index) => ({ ...sample, index })))(
  "matches original mirror point draw branch $index",
  (sample) => {
    const result = nativeInteractiveMirrorPoints({
      normals: Float32Array.from(native.normals.slice(0, sample.count).flat()),
      flags: Uint32Array.from(native.flags.slice(0, sample.count)),
      direction: sample.direction,
      stride: sample.stride,
      onlySelected: sample.onlySelected,
      backfaces: sample.backfaces,
      baseColor: [0.8, 0.8, 0],
      selectedColor: [0.3, 0.4, 0.5],
      allowanceMilliseconds: sample.allowanceMilliseconds,
      elapsedMilliseconds: sample.elapsedMilliseconds,
    });
    expect(Array.from(result.indices)).toEqual(sample.indices);
    expect(
      Buffer.from(
        result.colors.buffer,
        result.colors.byteOffset,
        result.colors.byteLength,
      ),
    ).toEqual(Buffer.from(new Float32Array(sample.colors.flat()).buffer));
    expect(result.complete).toBe(sample.complete);
    expect(sample.primitives).toEqual([0]);
  },
);
it("treats the allowance as elapsed time rather than a point-count limit", () => {
  const input = {
    normals: new Float32Array(300),
    flags: new Uint32Array(100),
    direction: [0, 0, 0],
    stride: 1,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    elapsedMilliseconds: 12,
  };
  expect(
    nativeInteractiveMirrorPoints({ ...input, allowanceMilliseconds: 0 })
      .indices.length,
  ).toBe(100);
  expect(
    nativeInteractiveMirrorPoints({ ...input, allowanceMilliseconds: 1000000 })
      .indices.length,
  ).toBe(100);
});

it("rejects malformed source metadata before exposing a partial point list", () => {
  const input = {
    normals: new Float32Array([0, 0, 1]),
    flags: new Uint32Array([0]),
    direction: [0, 0, 1],
    stride: 1,
    baseColor: [0.8, 0.8, 0],
    selectedColor: [1, 0, 0],
    allowanceMilliseconds: 1000000,
    elapsedMilliseconds: 1,
  };
  expect(() =>
    nativeInteractiveMirrorPoints({ ...input, stride: -1 }),
  ).toThrow();
  expect(() =>
    nativeInteractiveMirrorPoints({ ...input, normals: new Float32Array(0) }),
  ).toThrow();
  expect(() =>
    nativeInteractiveMirrorPoints({ ...input, flags: [1.5] }),
  ).toThrow();
  expect(() =>
    nativeInteractiveMirrorPoints({ ...input, direction: [0, 0, Infinity] }),
  ).toThrow();
});
