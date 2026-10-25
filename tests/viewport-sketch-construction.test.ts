import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import { coordinateSketchFrame, sketchWorldPoint } from "../src/sketch-frame";
import { sampleSketchArc, type Sketch } from "../src/sketch";

function fixture() {
  const view = Object.create(Viewport.prototype) as Viewport;
  const geometry = new THREE.Group();
  Object.assign(view, {
    sketchGeometry: geometry,
    sketchPreview: new THREE.Group(),
    controls: { mouseButtons: {} },
    invalidate: vi.fn(),
  });
  const change = vi.fn(),
    error = vi.fn();
  return {
    view,
    geometry,
    change,
    error,
    show(sketch: Sketch, showControlPoints = false) {
      view.setSketchEditor({
        sketch,
        tool: "navigate",
        constraints: true,
        showControlPoints,
        beginDraw: () => 17,
        onDraw: change,
        onError: error,
      });
    },
  };
}

function sketch(scale = 1): Sketch {
  return {
    version: 1,
    points: [
      { id: "a", x: 0, y: -10 * scale },
      { id: "b", x: 10 * scale, y: -10 * scale },
      { id: "o", x: 0, y: -5 * scale },
      { id: "p", x: 0, y: 5 * scale },
      { id: "s", x: 5 * scale, y: 0 },
      { id: "t", x: -5 * scale, y: 0 },
      { id: "c", x: 0, y: 0 },
    ],
    segments: [
      { id: "ordinary", a: "a", b: "b" },
      { id: "axis", a: "o", b: "p", construction: true },
    ],
    arcs: [
      {
        id: "reference-arc",
        a: "s",
        b: "t",
        center: "c",
        clockwise: false,
        construction: true,
      },
    ],
    constraints: [],
  };
}
const curves = (group: THREE.Group) =>
  group.children.filter(
    (c) => c instanceof THREE.LineSegments,
  ) as THREE.LineSegments[];

describe("construction curves in the main THREE sketch editor", () => {
  it.each(["OXY", "OYZ", "OXZ"] as const)(
    "separates dashed construction geometry without changing coordinates on %s",
    (plane) => {
      const f = fixture(),
        source = sketch();
      source.frame = coordinateSketchFrame(plane, 12);
      const original = structuredClone(source);
      f.show(source);
      const lines = curves(f.geometry);
      expect(lines).toHaveLength(2);
      const ordinary = lines.find(
        (l) => !(l.material instanceof THREE.LineDashedMaterial),
      )!;
      const construction = lines.find(
        (l) => l.material instanceof THREE.LineDashedMaterial,
      )!;
      expect(ordinary.material).toBeInstanceOf(THREE.LineBasicMaterial);
      expect(construction.material).toBeInstanceOf(THREE.LineDashedMaterial);
      const world = (uv: [number, number]) =>
        sketchWorldPoint(source.frame!, uv);
      expect(
        Array.from(ordinary.geometry.getAttribute("position").array),
      ).toEqual([...world([0, -10]), ...world([10, -10])]);
      const arcSamples = sampleSketchArc(source, source.arcs![0]);
      arcSamples.push([-5, 0]);
      const expected = [...world([0, -5]), ...world([0, 5])];
      for (let i = 1; i < arcSamples.length; i++)
        expected.push(...world(arcSamples[i - 1]), ...world(arcSamples[i]));
      expect(
        Array.from(construction.geometry.getAttribute("position").array),
      ).toEqual(Array.from(new Float32Array(expected)));
      const distance = construction.geometry.getAttribute("lineDistance");
      expect(distance.count).toBe(
        construction.geometry.getAttribute("position").count,
      );
      expect(distance.getX(0)).toBe(0);
      expect(distance.getX(1)).toBe(1);
      expect(distance.getX(2)).toBe(0);
      expect(distance.getX(distance.count - 1)).toBe(1);
      for (let i = 3; i < distance.count; i++)
        expect(distance.getX(i)).toBeGreaterThanOrEqual(distance.getX(i - 1));
      for (const line of lines) {
        expect((line.material as THREE.LineBasicMaterial).depthTest).toBe(
          false,
        );
        expect(line.renderOrder).toBe(10);
      }
      expect(source).toEqual(original);
      expect(f.change).not.toHaveBeenCalled();
      expect(f.error).not.toHaveBeenCalled();
    },
  );

  it("keeps gaps in separated short and long primitives in one batch", () => {
    const f = fixture();
    const source = sketch();
    source.points.push(
      { id: "far-a", x: 10000, y: 0 },
      { id: "far-b", x: 10000, y: 10 },
      { id: "long-a", x: -1e6, y: 0 },
      { id: "long-b", x: -1e6, y: 1e6 },
    );
    source.segments.push(
      { id: "far", a: "far-a", b: "far-b", construction: true },
      { id: "long", a: "long-a", b: "long-b", construction: true },
    );
    f.show(source);
    const dashed = curves(f.geometry).filter(
      (l) => l.material instanceof THREE.LineDashedMaterial,
    );
    expect(dashed).toHaveLength(1);
    const distance = dashed[0].geometry.getAttribute("lineDistance");
    const material = dashed[0].material as THREE.LineDashedMaterial;
    for (const start of [0, 2, 4, 6]) expect(distance.getX(start)).toBe(0);
    for (const end of [1, 3, 5, distance.count - 1]) {
      expect(distance.getX(end)).toBe(1);
      expect(
        distance.getX(end) / (material.dashSize + material.gapSize),
      ).toBeGreaterThanOrEqual(8);
    }
    for (let i = 7; i < distance.count; i++)
      expect(distance.getX(i)).toBeGreaterThanOrEqual(distance.getX(i - 1));
  });

  it("keeps degenerate construction curves finite alongside valid references", () => {
    const f = fixture(),
      source = sketch();
    source.segments.unshift({ id: "zero", a: "o", b: "o", construction: true });
    f.show(source);
    const dashed = curves(f.geometry).find(
      (l) => l.material instanceof THREE.LineDashedMaterial,
    )!;
    const distance = dashed.geometry.getAttribute("lineDistance");
    expect(Array.from(distance.array).every(Number.isFinite)).toBe(true);
    expect(Array.from(distance.array).slice(0, 4)).toEqual([0, 0, 0, 1]);
    expect(distance.getX(distance.count - 1)).toBe(1);
    expect((dashed.material as THREE.LineDashedMaterial).dashSize).toBe(1 / 32);
    expect((dashed.material as THREE.LineDashedMaterial).gapSize).toBe(1 / 32);
  });

  it("retains normalized dash and gap fractions at tiny and large scales", () => {
    const sizes: number[] = [];
    for (const scale of [1e-6, 1, 1e6]) {
      const f = fixture();
      f.show(sketch(scale));
      const dashed = curves(f.geometry).find(
        (l) => l.material instanceof THREE.LineDashedMaterial,
      )!;
      expect(dashed).toBeDefined();
      const material = dashed.material as THREE.LineDashedMaterial;
      expect(Number.isFinite(material.dashSize)).toBe(true);
      expect(material.dashSize).toBeGreaterThan(0);
      expect(material.gapSize).toBeGreaterThan(0);
      expect(material.scale).toBeGreaterThan(0);
      sizes.push(material.dashSize);
      const distance = dashed.geometry.getAttribute("lineDistance");
      expect(distance.getX(1)).toBe(1);
      expect(distance.getX(2)).toBe(0);
      expect(distance.getX(distance.count - 1)).toBe(1);
    }
    expect(sizes[0]).toBeCloseTo(sizes[1], 8);
    expect(sizes[2]).toBeCloseTo(sizes[1], 8);
  });

  it("releases both real line geometries and materials on toggle and editor close", () => {
    const f = fixture(),
      source = sketch();
    f.show(source);
    const old = curves(f.geometry);
    expect(old).toHaveLength(2);
    const dispose = old.flatMap((l) => [
      vi.spyOn(l.geometry, "dispose"),
      vi.spyOn(l.material as THREE.Material, "dispose"),
    ]);
    f.show({
      ...source,
      segments: source.segments.map((s) => ({ ...s, construction: false })),
      arcs: source.arcs!.map((a) => ({ ...a, construction: false })),
    });
    dispose.forEach((spy) => expect(spy).toHaveBeenCalledOnce());
    const current = curves(f.geometry);
    expect(current).toHaveLength(1);
    expect(current[0].material).not.toBeInstanceOf(THREE.LineDashedMaterial);
    const geometryDispose = vi.spyOn(current[0].geometry, "dispose"),
      materialDispose = vi.spyOn(
        current[0].material as THREE.Material,
        "dispose",
      );
    f.view.setSketchEditor(undefined);
    expect(f.geometry.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("retains solid preview defaults and does not create markers when hidden", () => {
    const f = fixture();
    f.show(sketch(), false);
    expect(
      f.geometry.children.every((c) => c instanceof THREE.LineSegments),
    ).toBe(true);
    const group = new THREE.Group();
    (
      f.view as unknown as {
        addSketchLines: (g: THREE.Group, p: number[], c: string) => void;
      }
    ).addSketchLines(group, [0, 0, 0, 1, 2, 3], "#ee933d");
    expect(curves(group)[0].material).not.toBeInstanceOf(
      THREE.LineDashedMaterial,
    );
    expect(
      curves(group)[0].geometry.getAttribute("lineDistance"),
    ).toBeUndefined();
  });

  it("marks symmetry arc centers and axis endpoints as related, not every point", () => {
    const f = fixture();
    const source: Sketch = {
      version: 1,
      points: [
        { id: "a", x: -2, y: 0 },
        { id: "b", x: -3, y: 1 },
        { id: "left-center", x: -3, y: 0 },
        { id: "c", x: 2, y: 0 },
        { id: "d", x: 3, y: 1 },
        { id: "right-center", x: 3, y: 0 },
        { id: "o", x: 0, y: -5 },
        { id: "p", x: 0, y: 5 },
        { id: "unrelated", x: 9, y: 9 },
      ],
      segments: [{ id: "axis", a: "o", b: "p", construction: true }],
      arcs: [
        { id: "left", a: "a", b: "b", center: "left-center", clockwise: false },
        {
          id: "right",
          a: "c",
          b: "d",
          center: "right-center",
          clockwise: true,
        },
      ],
      constraints: [
        {
          id: "sym",
          kind: "symmetric",
          first: "left",
          second: "right",
          axis: "axis",
          reverse: false,
        },
      ],
    };
    f.show(source, true);
    const points = f.geometry.children.filter(
      (c) => c instanceof THREE.Points,
    ) as THREE.Points[];
    const related = points.find(
      (p) =>
        (p.material as THREE.PointsMaterial).color.getHexString() === "398ce5",
    )!;
    const free = points.find(
      (p) =>
        (p.material as THREE.PointsMaterial).color.getHexString() === "ee933d",
    )!;
    expect(related.geometry.getAttribute("position").count).toBe(8);
    expect(Array.from(free.geometry.getAttribute("position").array)).toEqual([
      9, 9, 0,
    ]);
  });

  it("preserves prior non-symmetry marker semantics for an arc radius", () => {
    const f = fixture(),
      source = sketch();
    source.constraints = [
      { id: "radius", kind: "radius", arc: "reference-arc", value: 5 },
    ];
    f.show(source, true);
    const related = f.geometry.children.find(
      (c) =>
        c instanceof THREE.Points &&
        (c.material as THREE.PointsMaterial).color.getHexString() === "398ce5",
    ) as THREE.Points;
    expect(related.geometry.getAttribute("position").count).toBe(2);
  });
});
