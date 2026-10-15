import { expect, it, vi } from "vitest";
import fixture from "./fixtures/global-fine-rigid-native.json";
import traceFixture from "./fixtures/global-fine-rigid-trace-native.json";
import { nativeGlobalEigen4 } from "../src/scan-native-global-eigen";
import { nativeGlobalRigidFit } from "../src/scan-native-global-rigid-fit";
vi.mock("../src/scan-native-global-eigen", async (load) => {
  const original =
    await load<typeof import("../src/scan-native-global-eigen")>();
  return {
    ...original,
    nativeGlobalEigen4: vi.fn(original.nativeGlobalEigen4),
  };
});
const bits = (values: readonly number[]) =>
  Buffer.from(Float64Array.from(values).buffer).toString("hex");
it.each(fixture.cases)(
  "matches complete original global rigid fit: $name",
  (c) => {
    vi.mocked(nativeGlobalEigen4).mockClear();
    const result = nativeGlobalRigidFit(c.source, c.target);
    const trace = traceFixture.cases.find((t) => t.name === c.name)!.eigen[0];
    if (trace)
      expect(bits(vi.mocked(nativeGlobalEigen4).mock.calls[0][0])).toBe(
        bits(trace.matrix),
      );
    expect(result.accepted).toBe(c.accepted);
    expect(bits(result.matrix)).toBe(c.matrixBits);
    expect(bits([result.meanDistance])).toBe(c.meanDistanceBits);
  },
);
it("rejects malformed paired records before numerical work", () => {
  expect(() => nativeGlobalRigidFit([[0, 0, 0]], [])).toThrow(/paired/);
  expect(() => nativeGlobalRigidFit([[0, 0, Infinity]], [[0, 0, 0]])).toThrow(
    /finite/,
  );
});
