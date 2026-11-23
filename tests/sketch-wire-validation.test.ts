import { describe, expect, it } from "vitest";
import { resolveNativeSketchWireValidation } from "../src/sketch-wire-validation";

describe("native wire post-construction validation disposition", () => {
  it("retains both ordinary and nonzero retained status after passed checks", () => {
    for (const initialStatus of [0, 6])
      expect(
        resolveNativeSketchWireValidation({
          initialStatus,
          generalStatus: 1,
          boundsPassed: true,
        }),
      ).toEqual({ status: initialStatus, retainCandidate: true });
  });
  it("retires after bounds failure regardless of retained status", () => {
    for (const initialStatus of [0, 6])
      expect(
        resolveNativeSketchWireValidation({
          initialStatus,
          generalStatus: 1,
          boundsPassed: false,
        }),
      ).toEqual({ status: 4, retainCandidate: false });
  });
  it("maps general checker 5/6 to 5 and overlap 13 to 7", () => {
    for (const initialStatus of [0, 6])
      for (const promoteRetainedStatus of [false, true])
        for (const [generalStatus, status] of [
          [5, 5],
          [6, 5],
          [13, 7],
        ])
          expect(
            resolveNativeSketchWireValidation({
              initialStatus,
              generalStatus,
              promoteRetainedStatus,
            }),
          ).toEqual({ status, retainCandidate: false });
  });
  it("maps other failures to 4 from ordinary initial status", () => {
    for (const generalStatus of [
      0, 2, 3, 4, 7, 12, 14, -1, -2147483648, 2147483647,
    ])
      for (const promoteRetainedStatus of [false, true])
        expect(
          resolveNativeSketchWireValidation({
            initialStatus: 0,
            generalStatus,
            promoteRetainedStatus,
          }),
        ).toEqual({ status: 4, retainCandidate: false });
  });
  it("preserves or promotes initial status 6 according to the explicit version result", () => {
    for (const generalStatus of [0, 2, 3, 4, 7, 12, 14]) {
      expect(
        resolveNativeSketchWireValidation({
          initialStatus: 6,
          generalStatus,
          promoteRetainedStatus: false,
        }),
      ).toEqual({ status: 6, retainCandidate: true });
      expect(
        resolveNativeSketchWireValidation({
          initialStatus: 6,
          generalStatus,
          promoteRetainedStatus: true,
        }),
      ).toEqual({ status: 4, retainCandidate: false });
    }
  });
  it("requires exactly the input for the executed check branch", () => {
    const base = { initialStatus: 0, generalStatus: 1, boundsPassed: true };
    for (const input of [
      null,
      [],
      {},
      { ...base, initialStatus: 1 },
      { ...base, initialStatus: "0" },
      { ...base, generalStatus: NaN },
      { ...base, generalStatus: 1.1 },
      { ...base, generalStatus: 2147483648 },
      { ...base, generalStatus: -2147483649 },
      { ...base, boundsPassed: 1 },
      { ...base, promoteRetainedStatus: false },
      { initialStatus: 0, generalStatus: 1 },
      { initialStatus: 6, generalStatus: 2 },
      { initialStatus: 6, generalStatus: 2, promoteRetainedStatus: 0 },
      {
        initialStatus: 6,
        generalStatus: 2,
        promoteRetainedStatus: false,
        boundsPassed: true,
      },
      { ...base, extra: 0 },
    ])
      expect(() => resolveNativeSketchWireValidation(input)).toThrow(
        /wire validation/i,
      );
  });
  it("returns detached results without changing supplied statuses", () => {
    const input = {
      initialStatus: 6,
      generalStatus: 2,
      promoteRetainedStatus: false,
    };
    const result = resolveNativeSketchWireValidation(Object.freeze(input));
    result.status = 4;
    expect(input.initialStatus).toBe(6);
    expect(resolveNativeSketchWireValidation(input)).toEqual({
      status: 6,
      retainCandidate: true,
    });
  });
});
