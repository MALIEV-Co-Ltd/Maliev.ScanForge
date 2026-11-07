import { expect, it, vi } from "vitest";
import { Viewport } from "../src/viewport";

it("starts screen-selection preparation only for an actual selection gesture", () => {
  const view = Object.create(Viewport.prototype) as any;
  const index = { prepare: vi.fn(), cancel: vi.fn() };
  const item = {
    mesh: { visible: true },
    positions: [0, 0, 0],
    selectionIndex: index,
  };
  Object.assign(view, {
    selectedId: "scan",
    objects: new Map([["scan", item]]),
    controls: { enabled: true, mouseButtons: {} },
    paintOverlay: { style: {} },
    renderer: { domElement: { setPointerCapture: vi.fn() } },
    beginBridgeDrag: vi.fn(() => false),
    beginSketchDrag: vi.fn(() => false),
    paintScreen: vi.fn(),
    onSelectionGesture: vi.fn(),
    selectionTool: "rectangle",
    selectionGeneration: 0,
  });
  view.setBrush(true);
  expect(index.prepare).not.toHaveBeenCalled();
  view.pointerDown({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX: 1,
    clientY: 1,
  });
  expect(index.prepare).toHaveBeenCalledOnce();
  expect(view.onSelectionGesture).toHaveBeenCalledWith("begin");
});
