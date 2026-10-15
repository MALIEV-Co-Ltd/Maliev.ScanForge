import { expect, it } from "vitest";
import fixture from "./fixtures/global-fine-eigen4-native.json";
import { nativeGlobalEigen4 } from "../src/scan-native-global-eigen";
const bits = (values: readonly number[]) =>
  Buffer.from(Float64Array.from(values).buffer).toString("hex");
it.each(fixture.cases)(
  "matches the complete original 4x4 global eigen kernel: $name",
  (c) => {
    const result = nativeGlobalEigen4(c.matrix);
    expect(result.accepted).toBe(c.accepted);
    expect(bits(result.values)).toBe(c.valuesBits);
    expect(bits(result.vectors)).toBe(c.vectorsBits);
  },
);
