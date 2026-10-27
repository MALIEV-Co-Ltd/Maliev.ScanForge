import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createOriginGeometry,
  highlightOriginPlane,
  datumFrame,
  ORIGIN_PLANES,
} from "../src/origin";
import { Viewport } from "../src/viewport";
import { CoordinateSystem } from "../src/ui/OriginControls";
import {
  coordinateSketchFrame,
  validateSketchFrame,
  sketchWorldPoint,
} from "../src/sketch-frame";
import { SketchPlaneDialog } from "../src/ui/SketchPlaneDialog";
import { SketchTools } from "../src/ui/SketchTools";
import { serializeProject, parseProject } from "../src/io";
import { drawSketchLine } from "../src/sketch-drawing";

it("draws three world planes at the world origin with matching right-handed normals", () => {
  const group = createOriginGeometry("OYZ");
  const axes = group.children.find(
    (child) => child instanceof THREE.AxesHelper,
  ) as THREE.AxesHelper;
  expect(Array.from(axes.geometry.getAttribute("color").array)).toEqual([
    1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1,
  ]);
  for (const plane of ORIGIN_PLANES) {
    const mesh = group.children.find(
      (c) => c.userData.originPlane === plane,
    ) as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    const expected = coordinateSketchFrame(plane, 0).normal;
    expected.forEach((n, i) => expect(normal.toArray()[i]).toBeCloseTo(n, 10));
    expect(mesh.material.opacity).toBe(plane === "OYZ" ? 0.3 : 0.08);
  }
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (Array.isArray(m.material)) m.material.forEach((a) => a.dispose());
    else m.material?.dispose();
  });
});
it("shows only axes outside plane picking and restores faint opacity after hover", () => {
  const idle = createOriginGeometry(undefined, false);
  expect(
    idle.children
      .filter((child) => child.userData.originPlane)
      .every((child) => !child.visible),
  ).toBe(true);
  const group = createOriginGeometry();
  const planes = group.children.filter(
    (child) => child.userData.originPlane,
  ) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  expect(planes.every((plane) => plane.material.opacity === 0.08)).toBe(true);
  highlightOriginPlane(group, "OXZ");
  planes.forEach((plane) =>
    expect(plane.material.opacity).toBe(
      plane.userData.originPlane === "OXZ" ? 0.3 : 0.08,
    ),
  );
  highlightOriginPlane(group);
  expect(planes.every((plane) => plane.material.opacity === 0.08)).toBe(true);
  for (const root of [idle, group])
    root.traverse((child) => {
      const object = child as THREE.Mesh;
      object.geometry?.dispose();
      if (Array.isArray(object.material))
        object.material.forEach((material) => material.dispose());
      else object.material?.dispose();
    });
});
it("prioritizes a datum plane over scan meshes while choosing a sketch plane", () => {
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 1000);
  camera.position.set(5, 5, 100);
  camera.lookAt(5, 5, 0);
  camera.updateMatrixWorld();
  const origin = createOriginGeometry();
  origin.updateMatrixWorld(true);
  const onPlane = vi.fn(),
    onSelect = vi.fn();
  const view = Object.create(Viewport.prototype);
  Object.assign(view, {
    camera,
    originGeometry: origin,
    originPicking: true,
    raycaster: new THREE.Raycaster(),
    onOriginPlane: onPlane,
    onSelect,
    renderer: {
      domElement: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          width: 400,
          height: 400,
        }),
      },
    },
    objects: {
      values: () => {
        throw new Error(
          "Scan geometry must not be traversed in plane-picking mode",
        );
      },
    },
  });
  view.pickAt({ clientX: 200, clientY: 200 });
  expect(onPlane).toHaveBeenCalledWith("OXY");
  expect(onSelect).not.toHaveBeenCalled();
});
it("keeps the coordinate row compact without a plane-choice toolbar", () => {
  const row = renderToStaticMarkup(
    <CoordinateSystem visible onVisible={() => {}} onSketch={() => {}} />,
  );
  expect(row).toContain("Coordinate System");
  expect(row).not.toContain("XY plane");
  expect(row).not.toContain("O (0, 0, 0)");
});
it.each(ORIGIN_PLANES)(
  "faces a new %s sketch with its local V axis upright",
  (plane) => {
    const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 10000);
    const target = new THREE.Vector3(10, 20, 30);
    const view = Object.create(Viewport.prototype);
    Object.assign(view, {
      camera,
      bounds: new THREE.Box3(),
      controls: { target, update: () => camera.updateMatrixWorld() },
      invalidate: vi.fn(),
    });
    const frame = coordinateSketchFrame(plane, 0);
    view.viewReferencePlane(frame);
    expect(target.toArray()).toEqual(frame.origin);
    expect(camera.up.toArray()).toEqual(frame.v);
    expect(
      camera.position
        .clone()
        .sub(target)
        .normalize()
        .distanceTo(new THREE.Vector3(...frame.normal)),
    ).toBeLessThan(1e-12);
    const localV = new THREE.Vector3(
      ...sketchWorldPoint(frame, [0, 10]),
    ).project(camera);
    expect(localV.x).toBeCloseTo(0, 10);
    expect(localV.y).toBeGreaterThan(0);
  },
);
it.each([
  [1, 2, 3],
  [0, 0, -1],
  [1, 0, 0],
] as [number, number, number][])(
  "retains a custom datum through project save/load with normal %j",
  (x, y, z) => {
    const frame = datumFrame([10, -20, 30], [x, y, z]);
    validateSketchFrame(frame);
    const sketch = {
      version: 1 as const,
      points: [],
      segments: [],
      constraints: [],
      frame,
    };
    const project = parseProject(
      serializeProject("Datum", [], {
        sketches: [{ id: "sketch", name: "Datum sketch", sketch }],
      }),
    );
    expect(project.authoring?.sketches?.[0].sketch?.frame).toEqual(frame);
    expect(sketchWorldPoint(frame, [0, 0])).toEqual([10, -20, 30]);
  },
);
it("rejects unusable plane normals", () =>
  expect(() => datumFrame([0, 0, 0], [0, 0, 0])).toThrow("nonzero"));
it("creates sketches without requiring a scan and exposes origin/custom plane choices", () => {
  const markup = renderToStaticMarkup(
    <SketchPlaneDialog
      initialPlane="OXZ"
      entities={[]}
      onCreate={() => {}}
      onCancel={() => {}}
    />,
  );
  expect(markup).toContain('value="OXZ" selected');
  expect(markup).toContain("Custom plane");
  expect(markup).toContain("Create sketch");
  expect(markup).not.toContain("Use scan section");
});
it("snaps a new line to a fixed sketch origin and reuses existing endpoints", () => {
  let counter = 0;
  const id = () => `geometry-${++counter}`;
  const first = drawSketchLine(
    {
      version: 1,
      points: [],
      segments: [],
      constraints: [],
      frame: coordinateSketchFrame("OYZ", 0),
    },
    [0.1, -0.1],
    [10, 0],
    0.5,
    true,
    id,
  );
  expect(first.points[0]).toMatchObject({ x: 0, y: 0 });
  expect(first.constraints).toContainEqual(
    expect.objectContaining({
      kind: "fixed",
      point: first.points[0].id,
      x: 0,
      y: 0,
    }),
  );
  const next = drawSketchLine(first, [10.1, 0.1], [10, 10], 0.5, true, id);
  expect(next.points).toHaveLength(3);
  expect(next.segments[1].a).toBe(first.points[1].id);
});
it("resolves dimension selectors to actual drawn geometry instead of legacy p1/p2 IDs", () => {
  const sketch = {
    version: 1 as const,
    points: [
      { id: "drawn-a", x: 0, y: 0 },
      { id: "drawn-b", x: 10, y: 0 },
    ],
    segments: [{ id: "drawn-edge", a: "drawn-a", b: "drawn-b" }],
    constraints: [],
  };
  const html = renderToStaticMarkup(
    <SketchTools value={sketch} onExtrude={() => {}} />,
  );
  expect(html).toContain('value="drawn-a" selected');
  expect(html).toContain('value="drawn-b" selected');
});
