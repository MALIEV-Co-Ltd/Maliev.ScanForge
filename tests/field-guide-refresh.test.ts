import { describe, expect, it } from "vitest";
import { refreshCurvatureGuide } from "../src/field-guide-refresh";
import native from "./fixtures/field-native-guide-refresh.json";

describe("recovered one-time guide refresh gate", () => {
  it.each(native.cases.map((entry, id) => ({ ...entry, id })))(
    "matches complete original refresh gate case $id",
    (entry) => {
      const state = { refreshed: entry.latch };
      const calls: {
        optionWord: number;
        scalar: number;
        optionByte: number;
        latchDuringCall: number;
      }[] = [];
      const observe = (options: {
        optionWord: number;
        scalar: number;
        optionByte: number;
      }) => calls.push({ ...options, latchDuringCall: state.refreshed });
      refreshCurvatureGuide(state, entry.mode, observe);
      expect(state.refreshed).toBe(entry.firstLatch);
      refreshCurvatureGuide(state, entry.mode, observe);
      expect(state.refreshed).toBe(entry.finalLatch);
      expect(calls).toEqual(
        entry.calls.map(
          ({ optionWord, scalar, optionByte, latchDuringCall }) => ({
            optionWord,
            scalar,
            optionByte,
            latchDuringCall,
          }),
        ),
      );
      for (const call of entry.calls) {
        expect(call.targetMatches).toBe(true);
        expect(call.contextMatches).toBe(true);
        expect(call.primary).toEqual([123, 456]);
        expect(call.secondary).toEqual([789, 987]);
      }
    },
  );
  it("consumes the latch even for a mode that does not dispatch", () => {
    const state = { refreshed: 0 };
    let count = 0;
    expect(refreshCurvatureGuide(state, 2, () => count++)).toBe(false);
    expect(refreshCurvatureGuide(state, 0, () => count++)).toBe(false);
    expect(count).toBe(0);
    expect(state.refreshed).toBe(1);
  });
  it("sets the latch before invoking the supplied mapping dependency", () => {
    const state = { refreshed: 0 };
    expect(() =>
      refreshCurvatureGuide(state, 0, () => {
        expect(state.refreshed).toBe(1);
        throw new Error("mapping failed");
      }),
    ).toThrow("mapping failed");
    expect(state.refreshed).toBe(1);
    expect(
      refreshCurvatureGuide(state, 0, () => {
        throw new Error("unexpected retry");
      }),
    ).toBe(false);
  });
  it("maintains per-guide state and preserves nonzero byte values", () => {
    const a = { refreshed: 0 };
    const b = { refreshed: 255 };
    let count = 0;
    expect(refreshCurvatureGuide(a, 0, () => count++)).toBe(true);
    expect(refreshCurvatureGuide(b, 0, () => count++)).toBe(false);
    expect(count).toBe(1);
    expect(b.refreshed).toBe(255);
  });
  it("rejects invalid browser-side state without consuming the latch", () => {
    for (const refreshed of [-1, 256, NaN, 0.5])
      expect(() => refreshCurvatureGuide({ refreshed }, 0, () => {})).toThrow(
        "invalid",
      );
    const state = { refreshed: 0 };
    expect(() => refreshCurvatureGuide(state, 0.5, () => {})).toThrow(
      "invalid",
    );
    expect(state.refreshed).toBe(0);
  });
});
