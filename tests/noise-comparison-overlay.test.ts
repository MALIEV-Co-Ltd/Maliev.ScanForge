import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createNoiseComparisonOverlay } from "../src/noise-comparison-overlay";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";
const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1,
]);
const rgb = new Uint8Array([
  0, 153, 0, 153, 76, 0, 0, 76, 153, 50, 50, 50, 79, 0, 0, 0, 0, 79,
]);
afterEach(() => vi.unstubAllGlobals());
it("owns original coordinates and exact sRGB bytes with lit, matte surface shading", () => {
  const overlay = createNoiseComparisonOverlay(positions, rgb);
  try {
    expect(overlay.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(overlay.material.toneMapped).toBe(false);
    expect(overlay.material.side).toBe(THREE.DoubleSide);
    expect(overlay.material.vertexColors).toBe(true);
    expect(overlay.material.color.r).toBe(0.5);
    expect(overlay.material.roughness).toBe(0.85);
    expect(overlay.material.metalness).toBe(0);
    const normals = overlay.geometry.getAttribute("normal");
    expect(normals.count).toBe(positions.length / 3);
    expect(Array.from(normals.array).every(Number.isFinite)).toBe(true);
    expect(normals.getZ(0)).toBeCloseTo(1);
    const p = overlay.geometry.getAttribute("position"),
      c = overlay.geometry.getAttribute("color");
    expect(p.array).not.toBe(positions);
    expect(Array.from(p.array)).toEqual(Array.from(positions));
    const color = new THREE.Color();
    for (let i = 0; i < c.count; i++) {
      color.setRGB(c.getX(i), c.getY(i), c.getZ(i));
      const srgb = color.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
      expect([srgb.r, srgb.g, srgb.b].map((v) => Math.round(v * 255))).toEqual(
        Array.from(rgb.slice(i * 3, i * 3 + 3)),
      );
    }
    expect(c.getY(0)).toBeCloseTo(0.3185468, 6);
    const hits: THREE.Intersection[] = [];
    overlay.raycast(new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  } finally {
    overlay.geometry.dispose();
    overlay.material.dispose();
  }
});
it("copies only valid hidden facet indices and validates complete original geometry", () => {
  const overlay = createNoiseComparisonOverlay(positions, rgb, [0, 0, -1, 99]);
  expect(Array.from(overlay.geometry.index!.array)).toEqual([3, 4, 5]);
  overlay.geometry.dispose();
  overlay.material.dispose();
  expect(() =>
    createNoiseComparisonOverlay(positions, new Uint8Array(3)),
  ).toThrow("match");
  expect(() =>
    createNoiseComparisonOverlay(new Float32Array(8), new Uint8Array(8)),
  ).toThrow("complete");
  const bad = positions.slice();
  bad[0] = NaN;
  expect(() => createNoiseComparisonOverlay(bad, rgb)).toThrow("finite");
});
function setup(visible = true) {
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene(),
    triangleSelection = new THREE.Group();
  Object.assign(view, {
    scene,
    triangleSelection,
    objects: new Map(),
    selectedId: null,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    flatShading: true,
    clippingPlane: new THREE.Plane(),
  });
  const entity: Entity = {
    id: "scan",
    name: "Scan",
    kind: "mesh",
    positions: positions.slice(),
    color: "#aeb5b8",
    visible,
    opacity: 1,
    meshSelection: { hidden: [0], saved: [] },
  };
  view.setEntities([entity], null);
  const mesh = scene.children[0] as THREE.Mesh;
  return { view, scene, triangleSelection, entity, mesh };
}
it("shows original surface separately, suppresses selected facets and restores visibility on clear", () => {
  const { view, scene, triangleSelection, mesh } = setup();
  view.setNoiseComparison("scan", positions, rgb);
  const group = scene.getObjectByName("Noise comparison") as THREE.Group;
  const overlay = group.children[0] as THREE.Mesh;
  expect(mesh.visible).toBe(false);
  expect(triangleSelection.visible).toBe(false);
  expect(Array.from(overlay.geometry.getAttribute("position").array)).toEqual(
    Array.from(positions),
  );
  expect(Array.from(overlay.geometry.index!.array)).toEqual([3, 4, 5]);
  const geometryDisposed = vi.spyOn(overlay.geometry, "dispose"),
    materialDisposed = vi.spyOn(overlay.material as THREE.Material, "dispose");
  view.setNoiseComparison();
  expect(mesh.visible).toBe(true);
  expect(triangleSelection.visible).toBe(true);
  expect(group.children).toHaveLength(0);
  expect(geometryDisposed).toHaveBeenCalledOnce();
  expect(materialDisposed).toHaveBeenCalledOnce();
  view.setEntities([], null);
});
it("setEntities applies current visibility after clearing comparison and releases replacement scratch", () => {
  const { view, scene, entity, mesh } = setup(false);
  view.setNoiseComparison("scan", positions, rgb);
  const group = scene.getObjectByName("Noise comparison") as THREE.Group;
  expect(group.children[0].visible).toBe(false);
  view.setNoiseComparison();
  expect(mesh.visible).toBe(false);
  view.setEntities([{ ...entity, visible: true }], null);
  view.setNoiseComparison("scan", positions, rgb);
  const old = group.children[0] as THREE.Mesh;
  const disposed = vi.spyOn(old.geometry, "dispose");
  view.setNoiseComparison("scan", positions, rgb);
  expect(disposed).toHaveBeenCalledOnce();
  expect(group.children).toHaveLength(1);
  view.setEntities([{ ...entity, visible: false }], null);
  expect(mesh.visible).toBe(false);
  expect(group.children).toHaveLength(0);
  view.setEntities([], null);
});
it("dispose releases original comparison geometry and restores underlying mesh", () => {
  const { view, scene, mesh } = setup();
  view.setNoiseComparison("scan", positions, rgb);
  const overlay = scene.getObjectByName(
    "Original surface noise comparison",
  ) as THREE.Mesh;
  const disposed = vi.spyOn(overlay.geometry, "dispose");
  const disposable = { remove: vi.fn() };
  const canvas = { removeEventListener: vi.fn(), remove: vi.fn() };
  Object.assign(view, {
    frame: null,
    observer: { disconnect: vi.fn() },
    controls: { removeEventListener: vi.fn(), dispose: vi.fn() },
    renderer: {
      domElement: canvas,
      dispose: vi.fn(),
      forceContextLoss: vi.fn(),
    },
    gizmo: { dispose: vi.fn() },
    grid: new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    ),
    gridScene: new THREE.Scene(),
    selectionOverlay: disposable,
    paintOverlay: disposable,
    landmarkOverlay: disposable,
    pivotMarker: disposable,
    section: new THREE.Group(),
    measurement: new THREE.Group(),
    boundaryEdges: new THREE.Group(),
    sketchGeometry: new THREE.Group(),
    sketchPreview: new THREE.Group(),
    originGeometry: new THREE.Group(),
  });
  vi.stubGlobal("window", { removeEventListener: vi.fn() });
  view.dispose();
  expect(disposed).toHaveBeenCalledOnce();
  expect(mesh.visible).toBe(true);
  expect(scene.children).toHaveLength(0);
});
