import { expect, it } from "vitest";
import { menuPosition, nextMenuIndex } from "../src/ui/ContextMenu";

it("keeps context menus inside viewport edges and handles undersized windows", () => {
  expect(
    menuPosition(990, 790, 200, 300, { width: 1000, height: 800 }),
  ).toEqual({ left: 800, top: 500 });
  expect(menuPosition(-20, -10, 200, 300, { width: 100, height: 100 })).toEqual(
    { left: 0, top: 0 },
  );
});
it("wraps keyboard focus across enabled actions and handles missing focus", () => {
  expect(nextMenuIndex(0, -1, [0, 2, 5])).toBe(5);
  expect(nextMenuIndex(5, 1, [0, 2, 5])).toBe(0);
  expect(nextMenuIndex(0, 1, [0, 2, 5])).toBe(2);
  expect(nextMenuIndex(-1, -1, [0, 2, 5])).toBe(5);
  expect(nextMenuIndex(-1, 1, [0, 2, 5])).toBe(0);
  expect(nextMenuIndex(0, 1, [])).toBe(-1);
});
