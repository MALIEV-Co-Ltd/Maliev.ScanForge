import { describe, expect, it } from "vitest";
import { applyWandRegion } from "../src/wand-selection";
import { growConnectedSelection } from "../src/connected-selection";

describe("wand sensitivity updates", () => {
  it("shrinks a previous region while preserving unrelated selection", () => {
    const positions = [
      0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 0, 0, 0, 0, 0, 0, 0, 10, 50, 0, 0, 60, 0,
      0, 50, 10, 0,
    ];
    const seeds = new Uint8Array([1, 0, 0]);
    const baseline = new Uint8Array([0, 0, 1]);
    const region = (angleDegrees: number) =>
      growConnectedSelection(positions, seeds, {
        tolerance: 0.001,
        angleDegrees,
      });
    expect([...applyWandRegion(baseline, region(90), false)]).toEqual([
      1, 1, 1,
    ]);
    expect([...applyWandRegion(baseline, region(4), false)]).toEqual([1, 0, 1]);
    expect([...baseline]).toEqual([0, 0, 1]);
    expect([...seeds]).toEqual([1, 0, 0]);
  });
  it("restores the baseline as a subtraction region shrinks and never reveals hidden triangles", () => {
    const baseline = new Uint8Array([1, 1, 1, 1]);
    expect([
      ...applyWandRegion(baseline, new Uint8Array([1, 1, 0, 0]), true),
    ]).toEqual([0, 0, 1, 1]);
    expect([
      ...applyWandRegion(baseline, new Uint8Array([1, 0, 0, 0]), true, [2]),
    ]).toEqual([0, 1, 0, 1]);
    expect([
      ...applyWandRegion(baseline, new Uint8Array([1, 1, 1, 0]), false, [2]),
    ]).toEqual([1, 1, 0, 1]);
  });
  it("rejects an obsolete region of a different mesh size", () => {
    expect(() =>
      applyWandRegion(new Uint8Array(3), new Uint8Array(4), false),
    ).toThrow("does not match");
  });
});
