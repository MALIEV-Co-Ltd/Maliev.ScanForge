import { expect, it } from "vitest";
import {
  getRibbonToolMetadata,
  ribbonToolAvailability,
  type RibbonState,
  type RibbonActions,
} from "../src/ui/ribbon-model";

it.each(["referencePoint", "referenceLine"] as const)(
  "disables sampled-geometry commands for %s while retaining appearance",
  (selectionKind) => {
    const state: RibbonState = {
      disabled: false,
      hasSelection: true,
      canUndo: false,
      canRedo: false,
      selectionKind,
    };
    for (const id of [
      "editScan",
      "align",
      "reducePolygons",
      "reduceNoise",
      "scaleMesh",
      "flipNormals",
      "shrinkwrap",
      "splitMesh",
      "sketchFromSection",
    ]) {
      const tool = getRibbonToolMetadata(id)!;
      const actions = { [tool.action!]: () => {} } as RibbonActions;
      expect(
        ribbonToolAvailability(
          tool,
          { ...state, selectionKind: "mesh" },
          actions,
        ).available,
        id,
      ).toBe(true);
      expect(ribbonToolAvailability(tool, state, actions).available, id).toBe(
        false,
      );
    }
    const color = getRibbonToolMetadata("objectColor")!;
    expect(
      ribbonToolAvailability(color, state, { objectColor: () => {} }).available,
    ).toBe(true);
  },
);
