import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-evaluator-preparation-native.json";
import { nativeGlobalEvaluatorExtent } from "../src/scan-native-global-evaluator-policy";

it.each(fixture.cases)(
  "matches original evaluator build policy: $name",
  (c) => {
    const bounds = Float32Array.from(c.bounds);
    const before = Buffer.from(bounds.buffer).toString("hex");
    const extent = nativeGlobalEvaluatorExtent(bounds);
    expect(Buffer.from(Float32Array.of(extent).buffer).toString("hex")).toBe(
      c.extentBits,
    );
    expect(Buffer.from(bounds.buffer).toString("hex")).toBe(before);
  },
);
