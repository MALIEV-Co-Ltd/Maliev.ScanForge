import { expect, it, vi } from "vitest";
import {
  getRibbonToolMetadata,
  ribbonCommandAvailability,
  ribbonToolAvailability,
  type RibbonState,
} from "../src/ui/ribbon-model";
const ready: RibbonState = {
  disabled: false,
  hasSelection: true,
  hasSketchSurfaceSource: true,
  canUndo: true,
  canRedo: true,
};
it("keeps agent ribbon launch availability equal to the visible tool's verification and busy gates", () => {
  for (const id of [
    "fitSurface",
    "trimSurfaces",
    "newFreeform",
    "fillet",
    "loft",
    "surface2dSketch",
  ]) {
    const actions = { [id]: vi.fn() };
    const tool = getRibbonToolMetadata(id)!;
    for (const state of [
      ready,
      { ...ready, disabled: true },
      { ...ready, hasSelection: false },
      { ...ready, hasSketchSurfaceSource: false },
    ])
      expect(ribbonCommandAvailability(id, state, actions)).toEqual(
        ribbonToolAvailability(tool, state, actions),
      );
  }
});
it("discovers the saved sketch surface command without an object and rejects an empty sketch", () => {
  const actions = { surface2dSketch: vi.fn() };
  expect(
    ribbonCommandAvailability(
      "surface2dSketch",
      { ...ready, hasSelection: false },
      actions,
    ).available,
  ).toBe(true);
  expect(
    ribbonCommandAvailability(
      "surface2dSketch",
      { ...ready, hasSketchSurfaceSource: false },
      actions,
    ).available,
  ).toBe(false);
});
it("does not invent a supported ribbon command for an unknown action", () => {
  expect(
    ribbonCommandAvailability("unregistered", ready, {
      unregistered: vi.fn(),
    } as any).available,
  ).toBe(false);
});
