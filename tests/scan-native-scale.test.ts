import { expect, it } from "vitest";
import { nativeScaleFactor, scaleScanMesh } from "../src/scan-tools-transforms";
import capture from "./fixtures/scale-input-native.json";
import { runScanTool } from "../src/scan-tools";

it.each(capture.cases)(
  "matches original Scale input instructions for $value, percentage=$percentage",
  ({ value, percentage, nativeFactor, nativeBits }) => {
    const factor = nativeScaleFactor(value, percentage);
    expect(factor).toBe(nativeFactor);
    const bits = new Uint8Array(new Float32Array([factor]).buffer);
    expect(
      Array.from(bits, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ).toBe(nativeBits);
  },
);

it("dispatches the captured Float32 factor without mutating source coordinates", () => {
  const source = new Float32Array([1.3, 0, 0, 2.3, 0, 0, 1.3, 1, 0]);
  const before = source.slice();
  const entry = capture.cases.find(
    (entry) => !entry.percentage && entry.value === 0.000001,
  )!;
  const expected = new Float32Array(
    Array.from(source, (value) => value * entry.nativeFactor),
  );
  const actual = runScanTool({
    kind: "scanTools",
    positions: source,
    operation: { kind: "scaleMesh", factor: entry.value },
  });
  expect(actual.positions).toEqual(expected);
  expect(actual.positions).not.toEqual(
    new Float32Array(Array.from(source, (value) => value * entry.value)),
  );
  expect(source).toEqual(before);
});

it("rejects unusable Float32 factors before publishing geometry and respects cancellation", () => {
  for (const value of [0, -1, NaN, Infinity, 1e40, 1e-46])
    expect(() => nativeScaleFactor(value)).toThrow();
  const controller = new AbortController();
  controller.abort();
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  expect(() =>
    scaleScanMesh(source, { factor: 1.1, signal: controller.signal }),
  ).toThrow("cancelled");
  expect(source).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
});
