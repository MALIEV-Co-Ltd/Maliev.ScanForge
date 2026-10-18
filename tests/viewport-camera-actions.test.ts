import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
function fixture() {
  const camera = new THREE.OrthographicCamera(-100, 100, 50, -50, 0.01, 10000);
  camera.position.set(100, -100, 80);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    camera,
    controls: { enabled: true, target: new THREE.Vector3(), update: vi.fn() },
    container: { clientWidth: 800, clientHeight: 400 },
    bounds: new THREE.Box3(
      new THREE.Vector3(-10, -10, -10),
      new THREE.Vector3(10, 10, 10),
    ),
    renderer: {
      domElement: {
        style: {},
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 800,
          height: 400,
        }),
        hasPointerCapture: () => false,
      },
    },
    gizmo: { setNavigation: vi.fn() },
    zoomWindowOverlay: { hidden: true, style: {} },
    zoomWindowHint: { hidden: true },
    invalidate: vi.fn(),
    fitView: vi.fn(),
  });
  return view;
}
it("fits all on a stationary middle double click, including mesh edit", () => {
  const view = fixture();
  view.brushing = true;
  view.auxClick({ button: 1, detail: 1, preventDefault: vi.fn() });
  view.auxClick({ button: 1, detail: 2, preventDefault: vi.fn() });
  expect(view.fitView).toHaveBeenCalledOnce();
  view.middleClickStart = { x: 0, y: 0, moved: true };
  view.auxClick({ button: 1, detail: 2, preventDefault: vi.fn() });
  expect(view.fitView).toHaveBeenCalledOnce();
});
it("uses shared window zoom and navigation commands without touching model history", () => {
  const view = fixture();
  view.controlAgentView({ action: "navigation", orbitMode: "constrained" });
  expect(view.orbitMode).toBe("constrained");
  view.controlAgentView({
    action: "zoomWindow",
    x0: 0.2,
    y0: 0.2,
    x1: 0.7,
    y1: 0.7,
  });
  expect(view.camera.zoom).toBeCloseTo(2);
  expect(view.fitView).not.toHaveBeenCalled();
  const before = view.camera.position.clone();
  expect(() =>
    view.controlAgentView({
      action: "zoomWindow",
      x0: 0.4,
      y0: 0.4,
      x1: 0.4,
      y1: 0.8,
    }),
  ).toThrow();
  expect(view.camera.position.equals(before)).toBe(true);
});
it("Escape cancels armed window zoom without moving the camera", () => {
  const view = fixture();
  const before = view.camera.position.clone();
  view.controlAgentView({ action: "navigation", zoomWindowActive: true });
  expect(view.zoomWindowActive).toBe(true);
  view.navigationKeyDown({
    key: "Escape",
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  });
  expect(view.zoomWindowActive).toBe(false);
  expect(view.camera.position.equals(before)).toBe(true);
});

it("applies captured GUI window drag through the shared operation", () => {
  const view = fixture();
  view.zoomWindowActive = true;
  view.zoomWindowPointer = { id: 7, x: 0.25, y: 0.25, endX: 0.25, endY: 0.25 };
  view.pointerMove({
    pointerId: 7,
    buttons: 1,
    clientX: 600,
    clientY: 300,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  });
  expect(view.zoomWindowOverlay.hidden).toBe(false);
  expect(view.zoomWindowOverlay.style.width).toBe("400px");
  view.pointerUp({
    pointerId: 7,
    button: 0,
    buttons: 0,
    clientX: 600,
    clientY: 300,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  });
  expect(view.camera.zoom).toBeCloseTo(2);
  expect(view.zoomWindowActive).toBe(false);
  expect(view.zoomWindowPointer).toBeUndefined();
});
it.each(["blur", "cancel"])(
  "cancels an in-progress window drag on %s without camera changes",
  (reason) => {
    const view = fixture();
    const before = view.camera.position.clone();
    view.zoomWindowActive = true;
    view.zoomWindowPointer = { id: 7, x: 0.2, y: 0.2, endX: 0.8, endY: 0.8 };
    Object.assign(view, {
      cancelBridgeDrag: vi.fn(),
      releaseInteractivePointer: vi.fn(),
      cancelSketchDrag: vi.fn(),
      paintTrail: { setAttribute: vi.fn() },
      selectionOverlay: { hidden: false },
    });
    if (reason === "blur") view.navigationBlur();
    else view.pointerCancel();
    expect(view.zoomWindowActive).toBe(false);
    expect(view.camera.position.equals(before)).toBe(true);
    expect(view.zoomWindowPointer).toBeUndefined();
  },
);

it("does not count a preceding middle drag as the first Fit click", () => {
  const view = fixture();
  view.middleClickStart = { x: 0, y: 0, moved: true };
  view.auxClick({ button: 1, detail: 1, preventDefault: vi.fn() });
  view.middleClickStart = { x: 20, y: 20, moved: false };
  view.auxClick({ button: 1, detail: 2, preventDefault: vi.fn() });
  expect(view.fitView).not.toHaveBeenCalled();
});
