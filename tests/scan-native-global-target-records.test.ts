import { expect, it } from "vitest";
import fixture from "../docs/evidence/global-fine-target-preparation-native.json";
import { nativeGlobalRawTargetIds } from "../src/scan-native-global-target-records";
import { prepareNativeGlobalQueryGeometry } from "../src/scan-native-global-query";

it.each(fixture.cases)(
  "matches original per-child raw point insertion: $name",
  (c) => {
    const actual: number[][] = [];
    c.children.forEach((child, index) => {
      const spec = child as {
        count: number;
        flags?: number[];
        feature?: boolean;
        payload?: boolean;
        evaluator?: boolean;
      };
      // The fixture also captures evaluator routing. This test covers only the raw
      // child point loop, not evaluator creation/readiness or original admission.
      if (
        spec.feature === false ||
        spec.payload === false ||
        (c.useEvaluators && spec.evaluator)
      )
        return;
      const ids = nativeGlobalRawTargetIds(
        spec.count,
        spec.flags && Uint32Array.from(spec.flags),
        c.stride,
      );
      for (const id of ids) actual.push([index, id]);
    });
    expect(actual).toEqual(
      c.events
        .filter((event) => Array.isArray(event) && event[0] === "insert")
        .map((event) => (event as (string | number)[]).slice(1)),
    );
  },
);
it("preserves target identity/order and only excludes hidden-bit points", () => {
  const points = Float32Array.from([
    0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0,
  ]);
  const geometry = {
    points,
    normals: new Float32Array(15),
    flags: Uint32Array.from([0, 1, 2, 3, 0x80000000]),
  };
  const first = prepareNativeGlobalQueryGeometry(geometry);
  expect(first.ids).toEqual(Uint32Array.of(0, 2, 4));
  expect(first.tree.points).toEqual(Float32Array.of(0, 0, 0, 2, 0, 0, 4, 0, 0));
  expect(prepareNativeGlobalQueryGeometry(geometry)).toBe(first);
  expect(points).toHaveLength(15);
});
it("uses a compact identity map when every point is admitted", () => {
  const points = new Float32Array(150);
  const result = prepareNativeGlobalQueryGeometry({ points, normals: points });
  expect(result.tree.points).toBe(points);
  expect(result.ids).toEqual(Uint32Array.from({ length: 50 }, (_, i) => i));
});
it("rejects malformed counts, flags and unsafe strides before allocating", () => {
  for (const count of [-1, 1.5, NaN, 0x100000000])
    expect(() => nativeGlobalRawTargetIds(count)).toThrow();
  for (const stride of [0, -1, 1.5, NaN, 0x100000000])
    expect(() => nativeGlobalRawTargetIds(2, undefined, stride)).toThrow();
  expect(() => nativeGlobalRawTargetIds(2, Uint32Array.of(0))).toThrow();
});
