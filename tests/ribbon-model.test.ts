import { describe, expect, it, vi } from "vitest";
import {
  RIBBON_TABS,
  RIBBON_ACTION_IDS,
  getRibbonToolMetadata,
  ribbonToolAvailability,
  type RibbonState,
} from "../src/ui/ribbon-model";

const ready: RibbonState = {
  disabled: false,
  hasSelection: true,
  canUndo: true,
  canRedo: true,
};
describe("ribbon command inventory", () => {
  it("exposes the requested workflow tabs in order and unique commands in each tab", () => {
    expect(RIBBON_TABS.map((tab) => tab.label)).toEqual([
      "Main",
      "Edit / View",
      "Scan Data",
      "Construct",
      "Freeform",
      "Surfacing",
      "CAD",
      "Analysis",
      "Settings",
      "Help",
    ]);
    for (const tab of RIBBON_TABS) {
      const ids = tab.groups.flatMap((group) =>
        group.tools.map((tool) => tool.id),
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it("never enables an unimplemented operation even if a caller injects a same-name callback", () => {
    const allTools = RIBBON_TABS.flatMap((tab) =>
      tab.groups.flatMap((group) => group.tools),
    );
    const supplied = Object.fromEntries(
      allTools.map((tool) => [tool.id, vi.fn()]),
    );
    const unsupported = allTools.filter((tool) => !tool.action);
    expect(unsupported.length).toBeGreaterThan(40);
    for (const tool of unsupported) {
      expect(ribbonToolAvailability(tool, ready, supplied)).toEqual({
        available: false,
        reason: "Not implemented yet",
      });
    }
  });
  it("requires a real registered action and honors selection, busy, and history state", () => {
    const fit = getRibbonToolMetadata("fitPlane")!;
    expect(ribbonToolAvailability(fit, ready, {})).toMatchObject({
      available: false,
    });
    expect(
      ribbonToolAvailability(fit, ready, { fitPlane: vi.fn() }).available,
    ).toBe(true);
    expect(
      ribbonToolAvailability(
        fit,
        { ...ready, hasSelection: false },
        { fitPlane: vi.fn() },
      ).reason,
    ).toBe("Select an object first");
    expect(
      ribbonToolAvailability(
        fit,
        { ...ready, disabled: true },
        { fitPlane: vi.fn() },
      ).available,
    ).toBe(false);
    expect(
      ribbonToolAvailability(
        getRibbonToolMetadata("undo")!,
        { ...ready, canUndo: false },
        { undo: vi.fn() },
      ).reason,
    ).toBe("Nothing to undo");
    expect(
      ribbonToolAvailability(
        getRibbonToolMetadata("redo")!,
        { ...ready, canRedo: false },
        { redo: vi.fn() },
      ).reason,
    ).toBe("Nothing to redo");
  });
  it("contains freeform, surfacing and solid modelling feature inventory without inventing implementations", () => {
    for (const id of [
      "wrap",
      "quadObj",
      "freeformThicken",
      "freeformOffset",
      "nurbsSurface",
      "loft",
      "sweep",
      "pipe",
      "helix",
      "trim",
      "combine",
      "cut",
      "intersect",
      "shell",
      "draft",
      "circularPattern",
      "linearPattern",
      "fillet",
      "chamfer",
    ]) {
      const metadata = getRibbonToolMetadata(id);
      expect(metadata, id).toBeDefined();
      expect(metadata?.action, id).toBeUndefined();
    }
    for (const tab of RIBBON_TABS)
      for (const group of tab.groups)
        for (const tool of group.tools) {
          if (tool.action) expect(RIBBON_ACTION_IDS).toContain(tool.action);
        }
  });
});
