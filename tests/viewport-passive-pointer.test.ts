import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";
it("does not submit a multi-million-facet scene for passive mouse movement", () => {
  const v = Object.create(Viewport.prototype) as any;
  Object.assign(v, {
    invalidate: vi.fn(),
    brushing: false,
    originPicking: false,
    sketchCurvePoints: [],
    holdMenu: { move: vi.fn() },
  });
  v.pointerMove({ pointerType: "mouse", buttons: 0, clientX: 10, clientY: 20 });
  expect(v.navigationCursor).toEqual({ clientX: 10, clientY: 20 });
  expect(v.invalidate).not.toHaveBeenCalled();
  v.pointerMove({ pointerType: "mouse", buttons: 1, clientX: 20, clientY: 20 });
  expect(v.invalidate).toHaveBeenCalledOnce();
});
