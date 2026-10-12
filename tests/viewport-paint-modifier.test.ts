import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";

function fixture(tool = "brush") {
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    selectionTool: tool,
    subtract: false,
    paintAltHeld: false,
    paintCursor: { setAttribute: vi.fn() },
    paintTrail: { setAttribute: vi.fn() },
  });
  return view;
}

it("changes the cursor and filled stroke to grey for Alt, restoring red on release", () => {
  const view = fixture();
  view.updatePaintModifier(true);
  expect(view.paintCursor.setAttribute).toHaveBeenLastCalledWith(
    "fill",
    "#a7adb5",
  );
  expect(view.paintTrail.setAttribute).toHaveBeenCalledWith(
    "stroke",
    "#a7adb5",
  );
  expect(view.paintTrail.setAttribute).toHaveBeenLastCalledWith(
    "fill",
    "#a7adb5",
  );
  view.updatePaintModifier(false);
  expect(view.paintCursor.setAttribute).toHaveBeenLastCalledWith(
    "fill",
    "#c83244",
  );
  expect(view.paintTrail.setAttribute).toHaveBeenLastCalledWith(
    "fill",
    "#c83244",
  );
});

it("keeps unfilled strokes unfilled and explicit subtraction grey after Alt release", () => {
  const view = fixture("freehand");
  view.subtract = true;
  view.updatePaintModifier(false);
  expect(view.paintCursor.setAttribute).toHaveBeenLastCalledWith(
    "fill",
    "#a7adb5",
  );
  expect(view.paintTrail.setAttribute).toHaveBeenLastCalledWith("fill", "none");
});
