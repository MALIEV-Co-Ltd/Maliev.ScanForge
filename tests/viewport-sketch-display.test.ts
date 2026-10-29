import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { coordinateSketchFrame, sketchWorldPoint } from "../src/sketch-frame";
import type { Sketch } from "../src/sketch";

function fixture() {
  const view = Object.create(Viewport.prototype) as Viewport;
  const section = new THREE.Group(),
    sketchGeometry = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(42, 0.5, 0.01, 1e7);
  const target = new THREE.Vector3();
  Object.assign(view, {
    section,
    sketchGeometry,
    sketchPreview: new THREE.Group(),
    camera,
    objects: new Map(),
    clippingPlane: new THREE.Plane(),
    extent: 1e5,
    controls: {
      mouseButtons: {},
      target,
      update: () => {
        camera.lookAt(target);
        camera.updateMatrixWorld();
      },
    },
    invalidate: vi.fn(),
  });
  return { view, section, sketchGeometry, camera, target };
}

describe("sketch display controls", () => {
  it("shows extracted reference points independently of mesh clipping and releases hidden buffers", () => {
    const f = fixture();
    f.view.setSection("z", 10, false);
    expect(f.section.visible).toBe(false);
    f.view.setSectionLines(
      [0, 0, 10, 1, 2, 10],
      "#888888",
      undefined,
      "points",
    );
    expect(f.section.visible).toBe(true);
    const points = f.section.children[0] as THREE.Points;
    expect(points.isPoints).toBe(true);
    expect(points.geometry.getAttribute("position").count).toBe(2);
    const disposeGeometry = vi.spyOn(points.geometry, "dispose"),
      disposeMaterial = vi.spyOn(
        points.material as THREE.PointsMaterial,
        "dispose",
      );
    expect((f.view as unknown as { clipping: boolean }).clipping).toBe(false);
    f.view.setSectionLines([], "#888888", undefined, "hidden");
    expect(f.section.visible).toBe(false);
    expect(f.section.children).toHaveLength(0);
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    f.view.setSectionLines(
      [0, 0, 10, 1, 2, 10],
      "#888888",
      undefined,
      "points",
    );
    expect(f.section.visible).toBe(true);
    f.view.setSectionLines([0, 0, 10, 1, 2, 10], "#888888", undefined, "lines");
    expect((f.section.children[0] as THREE.LineSegments).isLineSegments).toBe(
      true,
    );
  });
  it("hides endpoint markers while retaining editable curves and authoring data", () => {
    const f = fixture();
    const sketch: Sketch = {
      version: 1,
      points: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 0 },
      ],
      segments: [{ id: "line", a: "a", b: "b" }],
      constraints: [],
    };
    const before = structuredClone(sketch),
      onDraw = vi.fn();
    const editor = {
      sketch,
      tool: "line" as const,
      constraints: true,
      beginDraw: () => 17,
      onDraw,
      onError: vi.fn(),
    };
    f.view.setSketchEditor(editor);
    expect(
      f.sketchGeometry.children.some((c) => c instanceof THREE.Points),
    ).toBe(true);
    f.view.setSketchEditor({ ...editor, showControlPoints: false });
    expect(f.sketchGeometry.children).toHaveLength(1);
    expect(f.sketchGeometry.children[0]).toBeInstanceOf(THREE.LineSegments);
    expect(sketch).toEqual(before);
    expect(onDraw).not.toHaveBeenCalled();
  });
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "fits visible scan references in normal view on %s",
    (plane) => {
      const f = fixture(),
        frame = coordinateSketchFrame(plane, 12);
      const sketch: Sketch = {
        version: 1,
        points: [],
        segments: [],
        constraints: [],
        frame,
        reference: {
          kind: "section",
          sourceId: "scan",
          axis: "z",
          offset: 12,
          onSlicingPlane: true,
          selectedOnly: false,
          sampled: false,
          segments: [20000, -30000, 20020, -29990],
        },
      };
      const a = sketchWorldPoint(frame, [20000, -30000]),
        b = sketchWorldPoint(frame, [20020, -29990]);
      f.view.setSectionLines([...a, ...b], "#888888", undefined, "points");
      f.view.setSketchEditor({
        sketch,
        tool: "navigate",
        constraints: true,
        beginDraw: () => 17,
        onDraw: vi.fn(),
        onError: vi.fn(),
      });
      f.view.viewSketchNormal();
      expect(f.target.toArray()).toEqual(a.map((n, i) => (n + b[i]) / 2));
      expect(f.camera.up.toArray()).toEqual(frame.v);
      for (const point of [a, b]) {
        const projected = new THREE.Vector3(...point).project(f.camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(Math.abs(projected.z)).toBeLessThan(1);
      }
    },
  );
});
