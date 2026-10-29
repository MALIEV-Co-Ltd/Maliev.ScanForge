import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { coordinateSketchFrame } from "../src/sketch-frame";
import type { Sketch } from "../src/sketch";
import {
  applySketchDrawIntent,
  type SketchDrawIntent,
} from "../src/sketch-draw-intent";
type Hooks = {
  pointerDown: (e: PointerEvent) => void;
  pointerMove: (e: PointerEvent) => void;
  pointerUp: (e: PointerEvent) => void;
  pointerCancel: () => void;
  sketchKeyDown: (e: KeyboardEvent) => void;
};
function fixture(plane: "OXY" | "OYZ" | "OXZ" = "OXY") {
  const view = Object.create(Viewport.prototype) as Viewport;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
  const frame = coordinateSketchFrame(plane, 12);
  camera.up.set(...frame.v);
  camera.position
    .set(...frame.origin)
    .addScaledVector(new THREE.Vector3(...frame.normal), 100);
  camera.lookAt(new THREE.Vector3(...frame.origin));
  camera.updateMatrixWorld();
  const capture = new Set<number>();
  const canvas = {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 1000,
    }),
    setPointerCapture: (id: number) => capture.add(id),
    hasPointerCapture: (id: number) => capture.has(id),
    releasePointerCapture: (id: number) => capture.delete(id),
  };
  const geometry = new THREE.Group(),
    preview = new THREE.Group();
  Object.assign(view, {
    camera,
    raycaster: new THREE.Raycaster(),
    selectionOverlay: { hidden: true },
    paintTrail: { setAttribute: vi.fn() },
    renderer: { domElement: canvas },
    controls: {
      mouseButtons: {},
      target: new THREE.Vector3(...frame.origin),
      update: () => {
        camera.lookAt(new THREE.Vector3(...frame.origin));
        camera.updateMatrixWorld();
      },
    },
    sketchGeometry: geometry,
    sketchPreview: preview,
    invalidate: vi.fn(),
    extent: 100,
  });
  const change = vi.fn(),
    error = vi.fn();
  const revision = vi.fn(() => 17);
  // A test host for the same intent boundary used by the real application API.
  const draw = vi.fn((intent: SketchDrawIntent, expectedRevision: number) => {
    expect(expectedRevision).toBe(17);
    const state = view as unknown as {
      sketchEditor: { sketch: Sketch };
      snapGrid?: boolean;
      gridSpacing?: number;
    };
    const result = applySketchDrawIntent(state.sketchEditor.sketch, intent, {
      enabled: state.snapGrid ?? false,
      spacingMm: state.gridSpacing ?? 10,
    });
    if (result.changed) change(result.sketch);
  });
  const sketch: Sketch = {
    version: 1,
    points: [],
    segments: [],
    constraints: [],
    frame,
  };
  return {
    view,
    hooks: view as unknown as Hooks,
    camera,
    capture,
    geometry,
    preview,
    change,
    draw,
    revision,
    error,
    sketch,
  };
}
function event(x: number, y: number, extra = {}) {
  return {
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: true,
    pointerId: 1,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    ...extra,
  } as unknown as PointerEvent;
}
describe("sketch model-view pointer routing", () => {
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "creates a circle by center/radius drag on %s",
    (plane) => {
      const f = fixture(plane);
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool: "circle",
        constraints: true,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
      f.hooks.pointerDown(event(500, 500));
      f.hooks.pointerMove(event(650, 500));
      expect(f.change).not.toHaveBeenCalled();
      expect(f.preview.children.length).toBeGreaterThan(0);
      f.hooks.pointerUp(event(650, 500));
      expect(f.change).toHaveBeenCalledOnce();
      expect(f.error).not.toHaveBeenCalled();
      expect(f.change.mock.calls[0][0].arcs).toHaveLength(2);
      expect(f.change.mock.calls[0][0].frame).toEqual(f.sketch.frame);
      expect(f.capture.size).toBe(0);
      expect(f.preview.children).toHaveLength(0);
    },
  );
  it.each(["circle3", "arc3"] as const)(
    "commits %s only after its third pick",
    (tool) => {
      const f = fixture();
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool,
        constraints: false,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
      for (const [x, y] of [
        [650, 500],
        [500, 350],
      ]) {
        f.hooks.pointerDown(event(x, y));
        f.hooks.pointerUp(event(x, y));
      }
      expect(f.change).not.toHaveBeenCalled();
      expect(f.preview.children.length).toBeGreaterThan(0);
      expect(f.capture.size).toBe(0);
      f.hooks.pointerMove(event(350, 500));
      f.hooks.pointerDown(event(350, 500));
      f.hooks.pointerUp(event(350, 500));
      expect(f.change).toHaveBeenCalledOnce();
      expect(f.error).not.toHaveBeenCalled();
      expect(f.change.mock.calls[0][0].arcs).toHaveLength(
        tool === "circle3" ? 2 : 1,
      );
      expect(f.preview.children).toHaveLength(0);
    },
  );
  it("submits raw three-point intent with only the first pick's revision", () => {
    const f = fixture();
    Object.assign(f.view, { snapGrid: true, gridSpacing: 10 });
    f.view.setSketchEditor({
      sketch: f.sketch,
      tool: "arc3",
      constraints: true,
      beginDraw: f.revision,
      onDraw: f.draw,
      onError: f.error,
    });
    for (const [index, [x, y]] of [
      [650, 500],
      [500, 350],
      [350, 500],
    ].entries()) {
      f.hooks.pointerDown(event(x, y));
      f.hooks.pointerUp(event(x, y));
      if (index === 0) f.revision.mockReturnValue(99);
    }
    expect(f.revision).toHaveBeenCalledOnce();
    expect(f.draw).toHaveBeenCalledOnce();
    expect(f.draw.mock.calls[0][1]).toBe(17);
    const intent = f.draw.mock.calls[0][0];
    expect(intent.kind).toBe("arc3");
    if (intent.kind !== "arc3") throw Error("Expected arc intent");
    expect(intent.points[0][0]).not.toBe(10);
    expect(f.change).toHaveBeenCalledOnce();
    expect(f.capture.size).toBe(0);
  });
  it("discards incomplete three-point picks on Escape and tool changes, and recovers after collinearity rejection", () => {
    const f = fixture();
    const activate = () =>
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool: "arc3",
        constraints: false,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
    const click = (x: number, y: number) => {
      f.hooks.pointerDown(event(x, y));
      f.hooks.pointerUp(event(x, y));
    };
    activate();
    click(650, 500);
    click(500, 350);
    f.hooks.sketchKeyDown({
      key: "Escape",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    expect(f.preview.children).toHaveLength(0);
    expect(f.change).not.toHaveBeenCalled();
    click(650, 500);
    activate();
    click(650, 500);
    click(500, 500);
    click(350, 500);
    expect(f.error).toHaveBeenCalledOnce();
    expect(f.change).not.toHaveBeenCalled();
    click(650, 500);
    click(500, 350);
    click(350, 500);
    expect(f.change).toHaveBeenCalledOnce();
    expect(f.preview.children).toHaveLength(0);
  });
  it("rejects out-of-range authoring coordinates before GPU upload", () => {
    const f = fixture();
    f.sketch.points = [{ id: "bad", x: 1e20, y: 0 }];
    f.view.setSketchEditor({
      sketch: f.sketch,
      tool: "line",
      constraints: false,
      beginDraw: f.revision,
      onDraw: f.draw,
      onError: f.error,
    });
    expect(f.error).toHaveBeenCalledOnce();
    expect(f.geometry.children).toHaveLength(0);
    const down = event(500, 500);
    f.hooks.pointerDown(down);
    expect(down.stopImmediatePropagation).not.toHaveBeenCalled();
  });
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "draws a placed line on %s and commits once on release",
    (plane) => {
      const f = fixture(plane);
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool: "line",
        constraints: true,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
      const down = event(500, 500);
      f.hooks.pointerDown(down);
      expect(down.stopImmediatePropagation).toHaveBeenCalledOnce();
      expect(f.capture.has(1)).toBe(true);
      f.hooks.pointerMove(event(650, 500));
      expect(f.change).not.toHaveBeenCalled();
      expect(f.preview.children).toHaveLength(1);
      f.hooks.pointerUp(event(650, 500));
      expect(f.change).toHaveBeenCalledOnce();
      expect(f.error).not.toHaveBeenCalled();
      const sketch = f.change.mock.calls[0][0] as Sketch;
      expect(sketch.frame).toEqual(f.sketch.frame);
      expect(sketch.points[0].x).toBeCloseTo(0);
      expect(sketch.points[1].x).toBeGreaterThan(10);
      expect(sketch.points[1].y).toBeCloseTo(0);
      expect(f.capture.size).toBe(0);
      expect(f.preview.children).toHaveLength(0);
    },
  );
  it("cancels capture and disposable preview on Escape, cancellation and editor exit", () => {
    const f = fixture();
    f.view.setSketchEditor({
      sketch: f.sketch,
      tool: "line",
      constraints: false,
      beginDraw: f.revision,
      onDraw: f.draw,
      onError: f.error,
    });
    for (const cancel of [
      () =>
        f.hooks.sketchKeyDown({
          key: "Escape",
          preventDefault: vi.fn(),
        } as unknown as KeyboardEvent),
      () => f.hooks.pointerCancel(),
      () => f.view.setSketchEditor(),
    ]) {
      f.hooks.pointerDown(event(500, 500));
      f.hooks.pointerMove(event(600, 600));
      const line = f.preview.children[0] as THREE.LineSegments;
      const disposed = vi.spyOn(line.geometry, "dispose");
      cancel();
      expect(f.capture.size).toBe(0);
      expect(disposed).toHaveBeenCalledOnce();
      expect(f.change).not.toHaveBeenCalled();
    }
  });
  it("moves the picked endpoint while preserving camera modifiers and releases rendered resources", () => {
    const f = fixture();
    f.sketch.points = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 10, y: 0 },
    ];
    f.sketch.segments = [{ id: "line", a: "a", b: "b" }];
    f.view.setSketchEditor({
      sketch: f.sketch,
      tool: "move",
      constraints: false,
      beginDraw: f.revision,
      onDraw: f.draw,
      onError: f.error,
    });
    const ctrl = event(500, 500, { ctrlKey: true });
    f.hooks.pointerDown(ctrl);
    expect(ctrl.stopImmediatePropagation).not.toHaveBeenCalled();
    f.hooks.pointerCancel();
    f.hooks.pointerDown(event(500, 500));
    f.hooks.pointerUp(event(550, 450));
    expect(f.change).toHaveBeenCalledOnce();
    expect(f.change.mock.calls[0][0].points[0].x).toBeGreaterThan(0);
    expect(f.change.mock.calls[0][0].points[0].y).toBeGreaterThan(0);
    const releases = f.geometry.children.map((child) =>
      vi.spyOn((child as THREE.Mesh).geometry, "dispose"),
    );
    f.view.setSketchEditor();
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
  });
});

it("snaps points in each sketch plane's local coordinates", () => {
  for (const plane of ["OXY", "OYZ", "OXZ"] as const) {
    const f = fixture(plane);
    Object.assign(f.view, { snapGrid: true, gridSpacing: 5 });
    f.view.setSketchEditor({
      sketch: f.sketch,
      tool: "line",
      constraints: false,
      beginDraw: f.revision,
      onDraw: f.draw,
      onError: f.error,
    });
    const point = (f.view as any).sketchPlanePoint(613, 537);
    expect(point[0] / 5).toBeCloseTo(Math.round(point[0] / 5));
    expect(point[1] / 5).toBeCloseTo(Math.round(point[1] / 5));
  }
});

describe("paint trim gesture ownership", () => {
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "collects unsnapped %s samples and commits the gesture-start revision once",
    async (plane) => {
      const f = fixture(plane),
        trim = vi.fn(),
        revision = vi.fn(() => 17);
      Object.assign(f.view, { snapGrid: true, gridSpacing: 10 });
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool: "trim",
        constraints: false,
        trimRadiusMm: 0.1,
        beginTrim: revision,
        onTrim: trim,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
      f.hooks.pointerDown(event(487, 500));
      f.hooks.pointerMove(
        event(488, 500, { getCoalescedEvents: () => [event(487.5, 500)] }),
      );
      expect(trim).not.toHaveBeenCalled();
      expect(f.change).not.toHaveBeenCalled();
      expect(revision).toHaveBeenCalledOnce();
      f.hooks.pointerUp(event(490, 500));
      await Promise.resolve();
      expect(trim).toHaveBeenCalledOnce();
      const [request, expectedRevision] = trim.mock.calls[0];
      expect(expectedRevision).toBe(17);
      expect(request.radiusMm).toBe(0.1);
      expect(request.stroke.length).toBeGreaterThanOrEqual(4);
      expect(request.stroke[0][0]).toBeLessThan(0);
      expect(request.stroke.at(-1)[0]).toBeLessThan(0);
      expect(request.stroke.every((p: number[]) => p[0] !== 0)).toBe(true);
      expect(f.change).not.toHaveBeenCalled();
      expect(f.capture.size).toBe(0);
      expect(f.preview.children).toHaveLength(0);
      expect(f.geometry.visible).toBe(true);
    },
  );
  it.each(["escape", "pointercancel", "toolchange"] as const)(
    "discards the stroke and late preview after %s",
    async (how) => {
      const f = fixture(),
        trim = vi.fn();
      f.view.setSketchEditor({
        sketch: f.sketch,
        tool: "trim",
        constraints: false,
        trimRadiusMm: 0.1,
        beginTrim: () => 17,
        onTrim: trim,
        beginDraw: f.revision,
        onDraw: f.draw,
        onError: f.error,
      });
      f.hooks.pointerDown(event(487, 500));
      f.hooks.pointerMove(event(490, 500));
      if (how === "escape")
        f.hooks.sketchKeyDown({
          key: "Escape",
          preventDefault: vi.fn(),
        } as unknown as KeyboardEvent);
      else if (how === "pointercancel") f.hooks.pointerCancel();
      else f.view.setSketchEditor();
      f.hooks.pointerUp(event(490, 500));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(trim).not.toHaveBeenCalled();
      expect(f.change).not.toHaveBeenCalled();
      expect(f.capture.size).toBe(0);
      expect(f.preview.children).toHaveLength(0);
      expect(f.geometry.visible).toBe(true);
    },
  );
});
