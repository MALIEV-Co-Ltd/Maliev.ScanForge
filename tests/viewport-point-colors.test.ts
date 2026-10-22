import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

const rgba = () => Uint8Array.of(255, 0, 32, 255, 0, 128, 255, 255);
function setup(pointColors: Uint8Array | undefined = rgba()) {
  const scene = new THREE.Scene();
  const view = Object.create(Viewport.prototype) as Viewport;
  Object.assign(view, {
    selectedId: null,
    objects: new Map(),
    scene,
    bounds: new THREE.Box3(),
    grid: new THREE.Object3D(),
    invalidate: vi.fn(),
    theme: "dark",
    raycaster: new THREE.Raycaster(),
    clippingPlane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  });
  const cloud: Entity & { pointColors?: Uint8Array } = {
    id: "cloud",
    name: "colored.asc",
    kind: "pointcloud",
    positions: Float32Array.of(0, 0, 0, 1, 2, 3),
    pointColors,
    visible: true,
    opacity: 1,
    color: "#abcdef",
  };
  view.setEntities([cloud], cloud.id);
  const mesh = scene.children[0] as THREE.Mesh;
  const points = mesh.children[0] as THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  return { view, cloud, points, mesh };
}

it("borrows normalized opaque RGBA colors without tinting or mutating authored bytes", () => {
  const colors = rgba(),
    before = colors.slice();
  const { view, cloud, points } = setup(colors);
  try {
    const attribute = points.geometry.getAttribute("color");
    expect(attribute).toBeInstanceOf(THREE.BufferAttribute);
    expect(attribute.array).toBe(colors);
    expect(attribute.itemSize).toBe(4);
    expect(attribute.count).toBe(cloud.positions.length / 3);
    expect(attribute.normalized).toBe(true);
    expect(attribute.getX(0)).toBe(1);
    expect(attribute.getY(1)).toBeCloseTo(128 / 255);
    expect(attribute.getW(1)).toBe(1);
    expect(points.material.vertexColors).toBe(true);
    expect(points.material.color.getHex()).toBe(0xffffff);
    expect(colors).toEqual(before);
  } finally {
    view.setEntities([], null);
  }
});

it("updates and removes color-only changes without rebuilding points or position buffers", () => {
  const { view, cloud, points } = setup();
  const position = points.geometry.getAttribute("position"),
    geometry = points.geometry;
  const nextColors = Uint8Array.of(1, 2, 3, 255, 4, 5, 6, 255);
  try {
    view.setEntities([{ ...cloud, pointColors: nextColors }], cloud.id);
    expect(points.geometry).toBe(geometry);
    expect(points.geometry.getAttribute("position")).toBe(position);
    expect(points.geometry.getAttribute("color").array).toBe(nextColors);
    expect(points.material.vertexColors).toBe(true);
    view.setEntities(
      [{ ...cloud, pointColors: undefined, color: "#123456" }],
      cloud.id,
    );
    expect(points.geometry).toBe(geometry);
    expect(points.geometry.getAttribute("color")).toBeUndefined();
    expect(points.material.vertexColors).toBe(false);
    expect(points.material.color.getHexString()).toBe("123456");
  } finally {
    view.setEntities([], null);
  }
});

it("keeps the deviation overlay while a color-only edit updates its restoration baseline", () => {
  const { view, cloud, points } = setup();
  const nextColors = Uint8Array.of(5, 6, 7, 255, 8, 9, 10, 255);
  try {
    view.setDeviation(cloud.id, Float32Array.of(-1, 1), 1);
    const overlay = points.geometry.getAttribute("color");
    expect(overlay.itemSize).toBe(3);
    view.setEntities(
      [{ ...cloud, pointColors: nextColors, color: "#123456" }],
      cloud.id,
    );
    expect(points.geometry.getAttribute("color")).toBe(overlay);
    expect(points.material.color.getHex()).toBe(0xffffff);
    view.setDeviation(cloud.id, null, 1);
    expect(points.geometry.getAttribute("color").array).toBe(nextColors);
    expect(points.geometry.getAttribute("color").normalized).toBe(true);
    expect(points.material.vertexColors).toBe(true);
    expect(points.material.color.getHex()).toBe(0xffffff);
    expect(nextColors).toEqual(Uint8Array.of(5, 6, 7, 255, 8, 9, 10, 255));
  } finally {
    view.setEntities([], null);
  }
});

it("restores authored colors on selection changes and preserves hidden-point indexing", () => {
  const { view, cloud, mesh } = setup();
  const filtered = { ...cloud, meshSelection: { hidden: [1], saved: [] } };
  try {
    view.setEntities([filtered], cloud.id);
    const points = mesh.children[0] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    expect(Array.from(points.geometry.index!.array)).toEqual([0]);
    expect(points.geometry.getAttribute("color").array).toBe(cloud.pointColors);
    view.setDeviation(cloud.id, Float32Array.of(-1, 1), 1);
    view.setEntities([filtered], null);
    const restored = mesh.children[0] as THREE.Points<
      THREE.BufferGeometry,
      THREE.PointsMaterial
    >;
    expect(restored).toBe(points);
    expect(restored.geometry.getAttribute("color").array).toBe(
      cloud.pointColors,
    );
    expect(restored.material.vertexColors).toBe(true);
    expect(restored.material.color.getHex()).toBe(0xffffff);
  } finally {
    view.setEntities([], null);
  }
});

it("removes an authored color baseline during deviation and restores ordinary entity tint", () => {
  const { view, cloud, points } = setup();
  try {
    view.setDeviation(cloud.id, Float32Array.of(-1, 1), 1);
    const overlay = points.geometry.getAttribute("color");
    view.setEntities(
      [{ ...cloud, pointColors: undefined, color: "#123456" }],
      cloud.id,
    );
    expect(points.geometry.getAttribute("color")).toBe(overlay);
    view.setDeviation(cloud.id, null, 1);
    expect(points.geometry.getAttribute("color")).toBeUndefined();
    expect(points.material.vertexColors).toBe(false);
    expect(points.material.color.getHexString()).toBe("123456");
  } finally {
    view.setEntities([], null);
  }
});
