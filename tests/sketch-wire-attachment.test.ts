import { describe, expect, it } from "vitest";
import { resolveNativeSketchLineAttachment } from "../src/sketch-wire-attachment";

const stages = [
  "start-point",
  "end-point",
  "edge-range",
  "edge-curve",
] as const;
describe("selected fresh-line attachment normal-return disposition", () => {
  it("continues success without claiming a whole native wire status", () => {
    for (const stage of stages) {
      expect(resolveNativeSketchLineAttachment({ stage, status: 1 })).toEqual({
        stage,
        status: 1,
        continues: true,
      });
    }
  });
  it("also continues edge-range status five", () => {
    expect(
      resolveNativeSketchLineAttachment({ stage: "edge-range", status: 5 }),
    ).toEqual({
      stage: "edge-range",
      status: 5,
      continues: true,
    });
  });
  it("maps point failures including five to wire four", () => {
    for (const stage of ["start-point", "end-point"])
      for (const status of [0, 2, 3, 4, 5, 6, -1, -2147483648, 2147483647])
        expect(resolveNativeSketchLineAttachment({ stage, status })).toEqual({
          stage,
          status,
          continues: false,
          wireStatus: 4,
        });
  });
  it("maps curve-attachment five to wire one and other failures to four", () => {
    expect(
      resolveNativeSketchLineAttachment({ stage: "edge-curve", status: 5 }),
    ).toEqual({
      stage: "edge-curve",
      status: 5,
      continues: false,
      wireStatus: 1,
    });
    for (const stage of ["edge-range", "edge-curve"])
      for (const status of [0, 2, 3, 4, 6, -1, -2147483648, 2147483647])
        expect(
          resolveNativeSketchLineAttachment({ stage, status }),
        ).toMatchObject({
          continues: false,
          wireStatus: 4,
        });
  });
  it("rejects malformed records and unsupported stages", () => {
    for (const input of [
      null,
      [],
      {},
      { stage: "unknown", status: 1 },
      { stage: "start-point" },
      { stage: "start-point", status: 1, accepted: true },
    ])
      expect(() => resolveNativeSketchLineAttachment(input)).toThrow();
  });
  it("requires a signed 32-bit integer status without coercion", () => {
    for (const status of [
      undefined,
      null,
      true,
      "1",
      NaN,
      Infinity,
      1.1,
      2147483648,
      -2147483649,
    ])
      expect(() =>
        resolveNativeSketchLineAttachment({ stage: "edge-range", status }),
      ).toThrow(/status/);
    expect(
      Object.is(
        resolveNativeSketchLineAttachment({ stage: "edge-range", status: -0 })
          .status,
        0,
      ),
    ).toBe(true);
  });
  it("returns detached diagnostics without accepted or builder flags", () => {
    const input = { stage: "edge-range", status: 5 };
    const result = resolveNativeSketchLineAttachment(input);
    input.status = 3;
    expect(result.status).toBe(5);
    expect(result).not.toHaveProperty("nativeAccepted");
    expect(result).not.toHaveProperty("builderSucceeded");
    expect(result).not.toHaveProperty("wireStatus");
  });
});
