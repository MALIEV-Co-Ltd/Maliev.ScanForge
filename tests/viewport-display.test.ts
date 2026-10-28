import { expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  localDisplayCoordinates,
  smoothDisplayNormals,
  snapSketchGrid,
} from "../src/viewport-display";
import { createViewportGrid } from "../src/viewport-grid";
import { Viewport } from "../src/viewport";
it("retains the Float32 results of recentering precise coordinates", () => {
  const positions = [1e8 + 0.25, -1e8 - 0.5, -0, 1e8 + 4.125, -1e8 + 2, 3];
  const origin = new THREE.Vector3(1e8 + 0.125, -1e8 + 0.25, 0);
  const before = positions.slice();
  expect(localDisplayCoordinates(positions, origin)).toEqual(
    Float32Array.from(
      positions,
      (value, i) => value - origin.getComponent(i % 3),
    ),
  );
  expect(positions).toEqual(before);
});
it("snaps sketch coordinates to a metric lattice only when enabled", () => {
  expect(snapSketchGrid([12.3, -7.8], true, 5)).toEqual([10, -10]);
  expect(snapSketchGrid([12.3, -7.8], false, 5)).toEqual([12.3, -7.8]);
  expect(snapSketchGrid([1, 2], true, 0)).toEqual([1, 2]);
});
it("averages normals at shared mesh vertices without changing the source", () => {
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0];
  const original = [...positions],
    normals = smoothDisplayNormals(positions);
  expect(positions).toEqual(original);
  expect(normals.length).toBe(positions.length);
  expect(normals[1]).toBeCloseTo(Math.SQRT1_2);
  expect(normals[2]).toBeCloseTo(Math.SQRT1_2);
});
it("changes grid visibility and metric spacing and releases replaced GPU resources", () => {
  const view = Object.create(Viewport.prototype) as any;
  const grid = createViewportGrid(10),
    geometry = grid.geometry,
    material = grid.material;
  const disposedGeometry = vi.spyOn(geometry, "dispose"),
    disposedMaterial = vi.spyOn(material as THREE.Material, "dispose");
  Object.assign(view, {
    grid,
    bounds: new THREE.Box3(),
    gridSpacing: 10,
    setTheme: vi.fn(),
    invalidate: vi.fn(),
    theme: "dark",
  });
  view.setGridOptions(false, 5, true);
  expect(grid.visible).toBe(false);
  expect(view.snapGrid).toBe(true);
  grid.geometry.computeBoundingBox();
  expect(grid.geometry.boundingBox!.max.x).toBe(50);
  expect(disposedGeometry).toHaveBeenCalledOnce();
  expect(disposedMaterial).toHaveBeenCalledOnce();
  grid.geometry.dispose();
  (grid.material as THREE.Material).dispose();
});
it("switches material shading without editing source geometry", () => {
  const material = new THREE.MeshStandardMaterial();
  const view = Object.create(Viewport.prototype) as any;
  Object.assign(view, {
    objects: new Map([["a", { mesh: { material } }]]),
    invalidate: vi.fn(),
  });
  view.setFlatShading(true);
  expect(material.flatShading).toBe(true);
  view.setFlatShading(false);
  expect(material.flatShading).toBe(false);
  material.dispose();
});

it("emits floating-point GLSL fade distances for integral grid spacing", () => {
  const grid = createViewportGrid(5);
  const shader = {
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <color_fragment>",
  };
  (grid.material as THREE.Material).onBeforeCompile(shader as any, {} as any);
  expect(shader.fragmentShader).toContain(
    "smoothstep(4.00000000e+1, 4.75000000e+1, length(gridPosition))",
  );
  grid.geometry.dispose();
  (grid.material as THREE.Material).dispose();
});
