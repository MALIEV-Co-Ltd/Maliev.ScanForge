import { expect, it } from "vitest";
import native from "./fixtures/alignment-datum-cone-native.json";
import {
  nativeDatumConeGeometry,
  nativeDatumConeHandles,
} from "../src/scan-native-datum-cone";
import type { FitResult, Vec3 } from "../src/types";
function bits(values: readonly number[]) {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, i) => bytes.writeDoubleLE(value, i * 8));
  return bytes.toString("hex");
}
it.each(native.cases)(
  "matches native cone handles and surface convention: $name",
  (sample) => {
    const fit = structuredClone(sample.fit) as FitResult;
    // JSON module transforms can erase negative zero; restore the original input carrier.
    const inputAxis = Buffer.from(sample.fitAxisBits, "hex");
    fit.axis = [0, 1, 2].map((i) => inputAxis.readDoubleLE(i * 8)) as Vec3;
    const before = structuredClone(fit);
    const cone = nativeDatumConeGeometry(fit);
    expect(bits(cone.origin)).toBe(bits(sample.origin));
    expect(bits(cone.direction)).toBe(sample.nativeDirectionBits.slice(0, 48));
    expect(bits(nativeDatumConeHandles(cone))).toBe(sample.nativeEndpointBits);
    const originalHandles = Buffer.from(sample.nativeEndpointBits, "hex");
    for (let axis = 0; axis < 3; axis++) {
      const smallEnd = originalHandles.readDoubleLE(axis * 8);
      const largeEnd = originalHandles.readDoubleLE((axis + 3) * 8);
      expect(Math.abs(largeEnd - fit.center[axis])).toBeLessThan(1e-12);
      expect(
        Math.abs(
          smallEnd - (fit.center[axis] - cone.direction[axis] * fit.height!),
        ),
      ).toBeLessThan(1e-12);
    }
    expect(
      bits([...cone.direction, ...cone.direction, ...cone.direction]),
    ).toBe(sample.nativeDirectionBits);
    expect(Math.abs(cone.opening - sample.opening)).toBeLessThan(1e-15);
    expect(bits([cone.start])).toBe(bits([sample.start]));
    // Original-code oracle validates authored frusta, not native fitting parity.
    for (const point of sample.samples)
      expect(Math.abs(point.nativeDistance)).toBeLessThan(1e-12);
    expect(fit).toEqual(before);
  },
);
it("rejects cylindrical or inverted frusta instead of inventing an apex", () => {
  const fit: FitResult = {
    kind: "cone",
    center: [0, 0, 0],
    axis: [0, 0, 1],
    radius: 2,
    topRadius: 2,
    height: 5,
    rms: 0,
    maxError: 0,
  };
  expect(() => nativeDatumConeGeometry(fit)).toThrow("base radius");
  expect(() => nativeDatumConeGeometry({ ...fit, topRadius: 3 })).toThrow(
    "base radius",
  );
  expect(() =>
    nativeDatumConeGeometry({ ...fit, topRadius: 1, height: 0 }),
  ).toThrow("height");
});

it("keeps raw equal/inverted helper inputs rejected while application recipes can canonicalize separately", () => {
  // Reuse the original probe's input diagnostics; these are geometry inputs,
  // not a new native fit, residual observation or native controller conversion.
  const raw = {
    ...structuredClone(native.cases[0].fit),
    center: [10, 20, 26] as Vec3,
    axis: [0, 0, 2] as Vec3,
    radius: 4,
    topRadius: 4,
    height: 8,
  } as FitResult;
  expect(() => nativeDatumConeGeometry(raw)).toThrow("base radius");
  expect(() => nativeDatumConeGeometry({ ...raw, topRadius: 6 })).toThrow(
    "base radius",
  );
  // Explicit application recipe normalization supplies a genuinely positive
  // canonical cone. No change to nativeDatumConeGeometry's input contract.
  const canonical = nativeDatumConeGeometry({
    ...raw,
    center: [10, 20, 34],
    axis: [0, 0, -2],
    radius: 6,
    topRadius: 4,
  });
  expect(nativeDatumConeHandles(canonical).slice(0, 6)).toEqual([
    10, 20, 26, 10, 20, 34,
  ]);
});
