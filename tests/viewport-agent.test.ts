import { expect, it } from "vitest";
import * as THREE from "three";
import {
  inspectCamera,
  pickCamera,
  setCameraPose,
} from "../src/viewport-agent";

it("applies a finite camera pose and exposes projection, dimensions and bounds", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100),
    target = new THREE.Vector3();
  setCameraPose(camera, target, [0, 0, 10], [0, 0, 0], [0, 1, 0], 2);
  expect(
    inspectCamera(
      camera,
      target,
      new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
      800,
      600,
    ),
  ).toMatchObject({
    projection: "perspective",
    position: [0, 0, 10],
    target: [0, 0, 0],
    zoom: 2,
    viewport: { width: 800, height: 600 },
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  });
  expect(
    inspectCamera(camera, target, new THREE.Box3(), 800, 600).bounds,
  ).toBeNull();
});
it("rejects degenerate camera frames without changing the current pose", () => {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100),
    target = new THREE.Vector3();
  camera.position.set(0, 0, 10);
  for (const [position, up] of [
    [
      [0, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 5],
      [0, 0, 1],
    ],
    [
      [NaN, 0, 5],
      [0, 1, 0],
    ],
  ])
    expect(() =>
      setCameraPose(camera, target, position, [0, 0, 0], up),
    ).toThrow();
  expect(camera.position.toArray()).toEqual([0, 0, 10]);
});
it("picks rendered object geometry with world points, respecting visibility, selectability and clipping", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  setCameraPose(camera, new THREE.Vector3(), [0, 0, 10], [0, 0, 0]);
  const geometry = new THREE.BoxGeometry(2, 2, 2),
    material = new THREE.MeshStandardMaterial(),
    mesh = new THREE.Mesh(geometry, material);
  mesh.userData.entityId = "box";
  try {
    expect(pickCamera(camera, [mesh], 0.5, 0.5, 1).hits[0]).toMatchObject({
      entityId: "box",
      point: [0, 0, 1],
    });
    mesh.visible = false;
    expect(pickCamera(camera, [mesh], 0.5, 0.5, 5).hits).toEqual([]);
    mesh.visible = true;
    mesh.userData.objectPickable = false;
    expect(pickCamera(camera, [mesh], 0.5, 0.5, 5).hits).toEqual([]);
    mesh.userData.objectPickable = true;
    material.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -2)];
    expect(pickCamera(camera, [mesh], 0.5, 0.5, 5).hits).toEqual([]);
    expect(() => pickCamera(camera, [mesh], 2, 0.5, 1)).toThrow();
  } finally {
    geometry.dispose();
    material.dispose();
  }
});

it("picks visible point-cloud children without inventing triangle indices", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  setCameraPose(camera, new THREE.Vector3(), [0, 0, 10], [0, 0, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0.01, 0, 0, 1, 0, 0], 3),
  );
  geometry.setDrawRange(0, 0);
  const parentMaterial = new THREE.MeshStandardMaterial(),
    parent = new THREE.Mesh(geometry, parentMaterial);
  const pointsGeometry = new THREE.BufferGeometry();
  pointsGeometry.setAttribute("position", geometry.getAttribute("position"));
  const material = new THREE.PointsMaterial(),
    points = new THREE.Points(pointsGeometry, material);
  points.userData.entityId = "cloud";
  parent.add(points);
  try {
    expect(pickCamera(camera, [parent], 0.5, 0.5, 1).hits[0]).toMatchObject({
      entityId: "cloud",
      pointIndex: 0,
      triangleIndex: null,
    });
    expect(
      pickCamera(camera, [parent], 0.5, 0.5, 1).hits[0].point[0],
    ).toBeCloseTo(0.01);
    points.visible = false;
    expect(pickCamera(camera, [parent], 0.5, 0.5, 1).hits).toEqual([]);
  } finally {
    geometry.dispose();
    pointsGeometry.dispose();
    parentMaterial.dispose();
    material.dispose();
  }
});
