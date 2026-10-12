import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";

function fixture() {
  const view = Object.create(Viewport.prototype) as any;
  const apply = vi.fn();
  const trail = { setAttribute: vi.fn() };
  Object.assign(view, {
    brushing: true,
    selectionTool: "brush",
    brushPixels: 20,
    brushPath: [],
    controls: { mouseButtons: {} },
    beginSketchDrag: () => false,
    cancelSketchDrag: vi.fn(),
    sketchCurvePoints: [],
    renderer: {
      domElement: {
        setPointerCapture: vi.fn(),
        hasPointerCapture: () => true,
        releasePointerCapture: vi.fn(),
      },
    },
    screenPoint: (x: number, y: number) => [x - 10, y - 30],
    paintOverlay: { style: {} },
    paintCursor: { setAttribute: vi.fn() },
    paintTrail: trail,
    selectionOverlay: { hidden: true },
    applyScreenRegion: apply,
    onSelectionGesture: vi.fn(),
  });
  return { view, apply, trail };
}
function pointer(x: number, y: number, extra = {}) {
  return {
    clientX: x,
    clientY: y,
    pointerId: 7,
    button: 0,
    isPrimary: true,
    altKey: false,
    ...extra,
  };
}

it("draws a continuous screen stroke, including empty space, and selects only on release", () => {
  const { view, apply, trail } = fixture();
  view.pointerDown(pointer(10, 30));
  view.pointerMove(
    pointer(110, 130, {
      getCoalescedEvents: () => [pointer(40, 60), pointer(80, 100)],
    }),
  );
  expect(apply).not.toHaveBeenCalled();
  expect(trail.setAttribute).toHaveBeenCalledWith(
    "d",
    "M0,0 L30,30 L70,70 L100,100 L100,100",
  );
  view.pointerUp(pointer(150, 170));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0][1]).toEqual({
    kind: "brush",
    points: [
      [0, 0],
      [30, 30],
      [70, 70],
      [100, 100],
      [140, 140],
    ],
    radius: 20,
  });
  expect(view.onSelectionGesture.mock.calls).toEqual([
    ["begin"],
    ["end", 150, 170],
  ]);
  expect(view.brushPath).toEqual([]);
  expect(trail.setAttribute).toHaveBeenLastCalledWith("d", "");
});

it("forwards Alt subtraction for the complete stroke", () => {
  const { view, apply } = fixture();
  view.pointerDown(pointer(10, 30, { altKey: true }));
  const up = pointer(50, 80, { altKey: true });
  view.pointerUp(up);
  expect(apply.mock.calls[0][0]).toBe(up);
  expect(apply.mock.calls[0][0].altKey).toBe(true);
});

it("cancels a stroke without changing facet selection", () => {
  const { view, apply, trail } = fixture();
  view.pointerDown(pointer(10, 30));
  view.pointerMove(pointer(100, 90));
  view.pointerCancel();
  expect(apply).not.toHaveBeenCalled();
  expect(view.pointer).toBeNull();
  expect(view.brushPath).toEqual([]);
  expect(trail.setAttribute).toHaveBeenLastCalledWith("d", "");
});
