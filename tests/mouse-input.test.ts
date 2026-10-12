import { expect, it } from "vitest";
import { MOUSE } from "three";
import {
  cameraMouseButtons,
  middleMouseAction,
  subtractSelection,
} from "../src/mouse-input";
it("enables object-mode camera drag but reserves mesh-edit left drag for selection", () => {
  for (const shiftKey of [false, true]) {
    for (const ctrlKey of [false, true]) {
      const modifiers = { shiftKey, ctrlKey };
      const inspection = cameraMouseButtons(false, modifiers);
      const editing = cameraMouseButtons(true, modifiers);
      expect(inspection.LEFT).toBe(
        shiftKey ? MOUSE.DOLLY : ctrlKey ? MOUSE.PAN : MOUSE.ROTATE,
      );
      expect(editing.LEFT).toBeNull();
      expect(editing.MIDDLE).toBe(inspection.LEFT);
      expect(inspection.RIGHT).toBeNull();
      expect(editing.RIGHT).toBeNull();
    }
  }
});
it("routes the default CAD middle-button modifiers and gives zoom precedence", () => {
  expect(middleMouseAction({ ctrlKey: false, shiftKey: false })).toBe("rotate");
  expect(middleMouseAction({ ctrlKey: true, shiftKey: false })).toBe("pan");
  expect(middleMouseAction({ ctrlKey: false, shiftKey: true })).toBe("zoom");
  expect(middleMouseAction({ ctrlKey: true, shiftKey: true })).toBe("zoom");
  expect(
    middleMouseAction({ ctrlKey: false, shiftKey: false, metaKey: true }),
  ).toBe("pan");
});
it("Alt temporarily subtracts while preserving the explicit subtraction setting", () => {
  expect(subtractSelection(false, false)).toBe(false);
  expect(subtractSelection(false, true)).toBe(true);
  expect(subtractSelection(true, false)).toBe(true);
});
