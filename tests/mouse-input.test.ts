import { expect, it } from "vitest";
import { middleMouseAction, subtractSelection } from "../src/mouse-input";
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
