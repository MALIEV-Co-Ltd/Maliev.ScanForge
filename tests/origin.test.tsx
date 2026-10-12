import { expect, it } from "vitest";
import * as THREE from "three";
import { renderToStaticMarkup } from "react-dom/server";
import { createOriginGeometry, datumFrame, ORIGIN_PLANES } from "../src/origin";
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
    expect(project.authoring?.sketches?.[0].sketch.frame).toEqual(frame);
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
