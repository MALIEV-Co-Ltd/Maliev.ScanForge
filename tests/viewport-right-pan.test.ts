import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";

function fixture() {
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    invalidate: vi.fn(),
    brushing: true,
    sketchCurvePoints: [],
    onContext: vi.fn(),
    screenPoint: (x: number, y: number) => [x, y],
    rightPanPointer: { id: 7, x: 10, y: 20, moved: false },
  });
  return view;
}
it("renders right-button pan in mesh edit and suppresses the release context menu", () => {
  const view = fixture();
  view.pointerMove({ pointerId: 7, buttons: 2, clientX: 30, clientY: 40 });
  expect(view.invalidate).toHaveBeenCalledOnce();
  const preventDefault = vi.fn();
  view.contextMenu({ clientX: 30, clientY: 40, preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(view.onContext).not.toHaveBeenCalled();
});
it("keeps a stationary right click available for the context menu", () => {
  const view = fixture();
  view.pointerMove({ pointerId: 7, buttons: 2, clientX: 11, clientY: 21 });
  view.contextMenu({ clientX: 11, clientY: 21, preventDefault() {} });
  expect(view.onContext).toHaveBeenCalledWith(11, 21);
});
