import { expect, it } from "vitest";
import original from "./fixtures/global-fine-rigid-native.json";
import fixture from "./fixtures/global-fine-rigid-trace-native.json";
import { nativeGlobalEigen4 } from "../src/scan-native-global-eigen";
const bits = (v: readonly number[]) =>
  Buffer.from(Float64Array.from(v).buffer).toString("hex");
it.each(fixture.cases)(
  "matches the original rigid-fit eigen call without perturbing its result: $name",
  (c) => {
    const baseline = original.cases.find((b) => b.name === c.name)!;
    expect(c.matrixBits).toBe(baseline.matrixBits);
    expect(c.meanDistanceBits).toBe(baseline.meanDistanceBits);
    for (const trace of c.eigen) {
      const eigen = nativeGlobalEigen4(trace.matrix);
      expect(bits(eigen.values)).toBe(bits(trace.values));
      expect(bits(eigen.vectors)).toBe(bits(trace.vectors));
    }
  },
);
