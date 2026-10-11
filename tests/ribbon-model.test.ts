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
  it("offers a new document without requiring an object and disables it during an operation", () => {
    const metadata = getRibbonToolMetadata("newDocument")!;
    const actions = { newDocument: vi.fn() };
    expect(RIBBON_TABS[0].groups[0].tools[0]).toBe(metadata);
    expect(
      ribbonToolAvailability(
        metadata,
        { ...ready, hasSelection: false },
        actions,
      ).available,
    ).toBe(true);
    expect(
      ribbonToolAvailability(metadata, { ...ready, disabled: true }, actions)
        .available,
    ).toBe(false);
  });
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
    expect(unsupported.map((tool) => tool.id)).toContain("wrap");
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
  it("enables implemented reconstruction tools and leaves remaining inventory unavailable", () => {
    for (const [id, action] of Object.entries({
      freeformThicken: "surfaceThicken",
      freeformOffset: "surfaceOffset",
      freeformConvert: "nurbsSurface",
      combine: "boolean",
      cut: "boolean",
      intersect: "boolean",
      scaleBody: "transform",
    }))
      expect(getRibbonToolMetadata(id)?.action, id).toBe(action);
    for (const id of [
      "quadObj",
      "nurbsSurface",
      "loft",
      "sweep",
      "shell",
      "fillet",
      "chamfer",
      "repairMesh",
      "segmentMesh",
      "fineAlign",
      "sketch2d",
      "splitSolid",
      "circularPattern",
      "linearPattern",
      "mirrorBody",
    ]) {
      expect(getRibbonToolMetadata(id)?.action, id).toBe(id);
    }
    for (const id of ["wrap", "pipe", "helix", "trim", "draft"]) {
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
