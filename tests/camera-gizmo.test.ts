import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  cameraAspect,
  cubeRegions,
  convertProjection,
  frameCamera,
  projectCube,
  resizeCamera,
  rotateCamera,
} from "../src/camera-gizmo";
import { Viewport } from "../src/viewport";
import { navigateCamera } from "../src/camera-navigation";

describe("camera projection and view cube", () => {
  it("exposes all 26 face, edge and corner directions across cube orientations", () => {
    const ids = new Set<string>();
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          const camera = new THREE.OrthographicCamera();
          camera.up.set(0, 0, 1);
          camera.position.set(x, y, z);
          camera.lookAt(0, 0, 0);
          const regions = cubeRegions(camera.quaternion);
          expect(regions).toHaveLength(27);
          regions.forEach((region) => {
            ids.add(region.id);
            expect(region.points).toHaveLength(4);
            expect(region.points.every((p) => Number.isFinite(p.x + p.y))).toBe(
              true,
            );
          });
        }
    expect(ids.size).toBe(26);
    expect(ids.has("0,0,0")).toBe(false);
  });
  it("orients to edges and corners without changing the target, distance or zoom", () => {
    const camera = new THREE.OrthographicCamera();
    camera.position.set(10, -80, 40);
    camera.zoom = 2;
    const target = new THREE.Vector3(10, 20, 30);
    const distance = camera.position.distanceTo(target);
    const view = Object.create(Viewport.prototype) as Viewport;
    Object.assign(view, {
      camera,
      controls: { target, update: () => camera.updateMatrixWorld() },
      invalidate: vi.fn(),
    });
    for (const direction of [
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(1, -1, 1),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1),
    ]) {
      view.orientCamera(direction, new THREE.Vector3(0, 0, 1));
      expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 12);
      expect(
        camera.position
          .clone()
          .sub(target)
          .normalize()
          .distanceTo(direction.clone().normalize()),
      ).toBeLessThan(1e-12);
      expect(camera.zoom).toBe(2);
      expect(camera.quaternion.toArray().every(Number.isFinite)).toBe(true);
      expect(target.toArray()).toEqual([10, 20, 30]);
    }
  });
  it("six-axis depth navigation changes orthographic zoom instead of translating invisibly along depth", () => {
    const camera = new THREE.OrthographicCamera(
      -100,
      100,
      100,
      -100,
      0.01,
      10000,
    );
    camera.position.set(0, 0, 200);
    camera.lookAt(0, 0, 0);
    const target = new THREE.Vector3(),
      before = camera.position.clone();
    navigateCamera(
      camera,
      target,
      { translation: [0, 1, 0], rotation: [0, 0, 0] },
      0.05,
    );
    expect(camera.zoom).toBeCloseTo(Math.exp(-0.04), 12);
    expect(camera.position.equals(before)).toBe(true);
    expect(target.length()).toBe(0);
    navigateCamera(
      camera,
      target,
      { translation: [1, 0, 0], rotation: [0, 0, 0] },
      0.05,
    );
    expect(target.x).toBeCloseTo(-4 / Math.exp(-0.04), 12);
    expect(camera.position.x).toBeCloseTo(target.x, 12);
  });
  it.each([0.4, 1, 2.5])(
    "preserves target-plane framing when switching projection at aspect %s",
    (aspect) => {
      const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 10000);
      const target = new THREE.Vector3(100, 200, 300);
      camera.position.copy(target).add(new THREE.Vector3(0, 0, 100));
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const point = target.clone().add(new THREE.Vector3(10, 12, 0));
      const before = point.clone().project(camera);
      const ortho = convertProjection(camera, target, "orthographic");
      expect(ortho).toBeInstanceOf(THREE.OrthographicCamera);
      const projected = point.clone().project(ortho);
      expect(projected.x).toBeCloseTo(before.x, 12);
      expect(projected.y).toBeCloseTo(before.y, 12);
      const perspective = convertProjection(ortho, target, "perspective");
      expect(point.clone().project(perspective).x).toBeCloseTo(before.x, 12);
      expect(point.clone().project(perspective).y).toBeCloseTo(before.y, 12);
      expect(perspective.up.equals(camera.up)).toBe(true);
      expect(perspective.near).toBe(camera.near);
      expect(perspective.far).toBe(camera.far);
    },
  );
  it("preserves orthographic zoom across resize and fits both narrow and wide viewports", () => {
    const camera = new THREE.OrthographicCamera(
      -100,
      100,
      100,
      -100,
      0.01,
      10000,
    );
    camera.zoom = 2;
    resizeCamera(camera, 0.4);
    expect(camera.zoom).toBe(2);
    expect(cameraAspect(camera)).toBeCloseTo(0.4);
    for (const aspect of [0.4, 1, 2.5]) {
      resizeCamera(camera, aspect);
      const distance = frameCamera(camera, 20);
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const x of [-20, 20])
        for (const y of [-20, 20]) {
          const point = new THREE.Vector3(x, y, 0).project(camera);
          expect(Math.abs(point.x)).toBeLessThan(1);
          expect(Math.abs(point.y)).toBeLessThan(1);
        }
    }
  });
  it("uses front-facing cube polygons in the scene camera's orientation", () => {
    const camera = new THREE.OrthographicCamera();
    camera.up.set(0, 0, 1);
    camera.position.set(100, -100, 100);
    camera.lookAt(0, 0, 0);
    const faces = projectCube(camera.quaternion);
    expect(new Set(faces.map((f) => f.view))).toEqual(
      new Set(["top", "front", "right"]),
    );
    expect(faces.every((f) => f.depth > 0 && f.points.length === 4)).toBe(true);
    camera.position.set(0, -100, 0);
    camera.lookAt(0, 0, 0);
    expect(projectCube(camera.quaternion).map((f) => f.view)).toEqual([
      "front",
    ]);
  });
  it("cube dragging rotates camera and up around the existing orbit center", () => {
    const camera = new THREE.OrthographicCamera();
    const target = new THREE.Vector3(10, 20, 30);
    camera.position.copy(target).add(new THREE.Vector3(0, -100, 40));
    camera.up.set(0, 0, 1);
    camera.lookAt(target);
    const before = camera.position.clone(),
      distance = before.distanceTo(target),
      savedTarget = target.clone();
    rotateCamera(camera, target, 30, -10);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(1);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 12);
    expect(camera.up.length()).toBeCloseTo(1, 12);
    expect(target.equals(savedTarget)).toBe(true);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      camera.quaternion,
    );
    expect(
      forward.distanceTo(target.clone().sub(camera.position).normalize()),
    ).toBeLessThan(1e-12);
  });
  it("fits an off-origin import with orthographic projection", () => {
    const camera = new THREE.OrthographicCamera(
      -40,
      40,
      100,
      -100,
      0.01,
      100000,
    );
    camera.position.set(100, -100, 80);
    camera.up.set(0, 0, 1);
    const target = new THREE.Vector3();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(20, 30, 40));
    mesh.position.set(10000, 20000, 30000);
    const view = Object.create(Viewport.prototype) as Viewport;
    Object.assign(view, {
      camera,
      extent: 100,
      objects: new Map([["scan", { mesh }]]),
      controls: {
        target,
        update: () => {
          camera.lookAt(target);
          camera.updateMatrixWorld();
        },
      },
      invalidate: vi.fn(),
    });
    view.fitView("scan");
    const bounds = new THREE.Box3().setFromObject(mesh);
    expect(target.equals(mesh.position)).toBe(true);
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const projected = new THREE.Vector3(x, y, z).project(camera);
          expect(Math.abs(projected.x)).toBeLessThan(1);
          expect(Math.abs(projected.y)).toBeLessThan(1);
          expect(Math.abs(projected.z)).toBeLessThan(1);
        }
  });
});
