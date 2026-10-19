import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { Viewport } from "../src/viewport";
import type { Entity } from "../src/types";

function setup(colored: boolean) {
  const view = Object.create(Viewport.prototype) as Viewport;
  const scene = new THREE.Scene();
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
  const cloud: Entity = {
    id: "cloud",
    kind: "pointcloud",
    name: "scan",
    color: "#abcdef",
    visible: true,
    opacity: 1,
    positions: new Float32Array([0, 0, -1, 1, 0, 0, 0, 1, 1, 1, 1, 2]),
    meshSelection: { hidden: [1], saved: [] },
  };
  view.setEntities([cloud], cloud.id);
  const proxy = scene.children.find(
    (child) => child instanceof THREE.Mesh,
  ) as THREE.Mesh;
  const points = proxy.children.find(
    (child) => child instanceof THREE.Points,
  ) as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  // Current source has no imported RGB contract. Exercise restoration of an existing
  // real rendered attribute without inventing an Entity.pointColors producer.
  if (colored) {
    points.geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(
        [1, 0, 0, 0, 1, 0, 0, 0, 1, 0.5, 0.25, 0.75],
        3,
      ),
    );
    points.material.vertexColors = true;
  }
  return { view, cloud, proxy, points };
}

it.each([false, true])(
  "colors visible Points and restores exact attributes/material (RGB=%s)",
  (colored) => {
    const { view, cloud, proxy, points } = setup(colored);
    const original = points.geometry.getAttribute("color"),
      tint = points.material.color.clone();
    const before = cloud.positions.slice(),
      index = points.geometry.getIndex();
    const values = new Float32Array([-1, 0, 1, 2]),
      valuesBefore = values.slice();
    try {
      view.setDeviation(cloud.id, values, 1);
      expect(proxy.geometry.drawRange.count).toBe(0);
      expect(proxy.geometry.getAttribute("color")).toBeUndefined();
      expect(points.geometry.getAttribute("color").count).toBe(4);
      expect(points.geometry.getAttribute("color")).not.toBe(original);
      expect(points.geometry.getIndex()).toBe(index);
      expect(Array.from(index!.array)).toEqual([0, 2, 3]);
      expect(points.material.vertexColors).toBe(true);
      expect(points.material.color.getHex()).toBe(0xffffff);
      const expected = ["#2479de", "#4bb78c", "#e56b47", "#e56b47"].flatMap(
        (value) => new THREE.Color(value).toArray(),
      );
      expect(Array.from(points.geometry.getAttribute("color").array)).toEqual(
        Array.from(new Float32Array(expected)),
      );
      view.setDeviation(cloud.id, null, 1);
      expect(points.geometry.getAttribute("color")).toBe(original);
      expect(points.material.vertexColors).toBe(colored);
      expect(points.material.color.equals(tint)).toBe(true);
      expect(cloud.positions).toEqual(before);
      expect(values).toEqual(valuesBefore);
    } finally {
      view.setDeviation("", null, 1);
      view.setEntities([], null);
    }
  },
);

it("clears/reapplies without caching the previous deviation attribute as original RGB", () => {
  const { view, cloud, points } = setup(true);
  const original = points.geometry.getAttribute("color");
  try {
    view.setDeviation(cloud.id, new Float32Array([-1, 0, 1, 2]), 1);
    view.setDeviation(cloud.id, new Float32Array([1, 0, -1, -2]), 1);
    view.setDeviation("", null, 1);
    expect(points.geometry.getAttribute("color")).toBe(original);
    view.setDeviation(cloud.id, new Float32Array([1]), 1);
    expect(points.geometry.getAttribute("color")).toBe(original);
    expect(points.material.vertexColors).toBe(true);
    view.setDeviation(cloud.id, new Float32Array([-1, 0, 1, 2]), 1);
    view.setEntities([cloud], null);
    expect(points.geometry.getAttribute("color")).toBe(original);
  } finally {
    view.setDeviation("", null, 1);
    view.setEntities([], null);
  }
});

it("preserves active colors during scene color changes and restores the updated tint", () => {
  const { view, cloud, points } = setup(false);
  try {
    view.setDeviation(cloud.id, new Float32Array([-1, 0, 1, 2]), 1);
    const display = points.geometry.getAttribute("color");
    view.setEntities([{ ...cloud, color: "#123456" }], cloud.id);
    expect(points.geometry.getAttribute("color")).toBe(display);
    expect(points.material.color.getHex()).toBe(0xffffff);
    view.setDeviation(cloud.id, null, 1);
    expect(points.geometry.getAttribute("color")).toBeUndefined();
    expect(points.material.vertexColors).toBe(false);
    expect(points.material.color.equals(new THREE.Color("#123456"))).toBe(true);
  } finally {
    view.setDeviation("", null, 1);
    view.setEntities([], null);
  }
});

it.each([false, true])(
  "never restores stale RGB onto replacement geometry (hidden change=%s)",
  (hidden) => {
    const { view, cloud, proxy, points } = setup(true);
    const original = points.geometry.getAttribute("color");
    try {
      view.setDeviation(cloud.id, new Float32Array([-1, 0, 1, 2]), 1);
      const changed = hidden
        ? { ...cloud, meshSelection: { hidden: [2], saved: [] } }
        : { ...cloud, positions: new Float32Array(cloud.positions) };
      view.setEntities([changed], cloud.id);
      view.setDeviation(cloud.id, null, 1);
      const current = proxy.children.find(
        (child) => child instanceof THREE.Points,
      ) as THREE.Points;
      expect(current).not.toBe(points);
      expect(current.geometry.getAttribute("color")).toBeUndefined();
      expect(current.geometry.getAttribute("color")).not.toBe(original);
    } finally {
      view.setDeviation("", null, 1);
      view.setEntities([], null);
    }
  },
);

it("preserves mesh palette and clearing behavior", () => {
  const view = Object.create(Viewport.prototype) as Viewport;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, -1, 1, 0, 0, 0, 1, 1], 3),
  );
  const material = new THREE.MeshStandardMaterial({ color: "#abcdef" }),
    mesh = new THREE.Mesh(geometry, material);
  Object.assign(view, {
    objects: new Map([["mesh", { mesh, color: "#abcdef" }]]),
    selectedId: "mesh",
    invalidate: vi.fn(),
  });
  try {
    view.setDeviation("mesh", new Float32Array([-1, 0, 1]), 1);
    expect(material.vertexColors).toBe(true);
    expect(Array.from(geometry.getAttribute("color").array)).toEqual(
      Array.from(
        new Float32Array(
          ["#2479de", "#4bb78c", "#e56b47"].flatMap((value) =>
            new THREE.Color(value).toArray(),
          ),
        ),
      ),
    );
    view.setDeviation("mesh", null, 1);
    expect(geometry.getAttribute("color")).toBeUndefined();
    expect(material.vertexColors).toBe(false);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
