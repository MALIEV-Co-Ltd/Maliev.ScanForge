import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  constrainCameraUp,
  rotateConstrained,
  zoomCameraWindow,
} from "../src/camera-actions";

describe("constrained camera orbit", () => {
  it("removes roll without moving the camera or its target", () => {
    const camera = new THREE.PerspectiveCamera();
    const target = new THREE.Vector3(2, 3, 4);
    camera.position.set(2, -7, 9);
    camera.up.set(1, 1, 0);
    camera.lookAt(target);
    const position = camera.position.clone();
    constrainCameraUp(camera, target);
    expect(camera.position.equals(position)).toBe(true);
    expect(target.toArray()).toEqual([2, 3, 4]);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const forward = target.clone().sub(position).normalize();
    const expected = new THREE.Vector3(0, 0, 1)
      .addScaledVector(forward, -forward.z)
      .normalize();
    expect(up.distanceTo(expected)).toBeLessThan(1e-10);
  });
  it.each([-1, 1])(
    "has a deterministic finite orientation at pole %i",
    (sign) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 10 * sign);
      constrainCameraUp(camera, new THREE.Vector3());
      const quaternion = camera.quaternion.clone();
      constrainCameraUp(camera, new THREE.Vector3());
      expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-7);
      expect(
        camera
          .getWorldDirection(new THREE.Vector3())
          .distanceTo(new THREE.Vector3(0, 0, -sign)),
      ).toBeLessThan(1e-10);
    },
  );
  it("uses world Z yaw and the existing drag direction while retaining radius", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, -10, 0);
    const target = new THREE.Vector3();
    rotateConstrained(camera, target, 10, 20);
    expect(camera.position.distanceTo(target)).toBeCloseTo(10);
    expect(Math.atan2(camera.position.y, camera.position.x)).toBeCloseTo(
      -Math.PI / 2 - 0.08,
    );
    expect(Math.asin(camera.position.z / 10)).toBeCloseTo(0.16);
    expect(camera.up.z).toBeGreaterThan(0);
  });
  it.each([-1, 1])("caps pitch at pole %i without inversion", (sign) => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, -10, 0);
    rotateConstrained(camera, new THREE.Vector3(), 0, sign * 10000);
    expect(Math.asin(camera.position.z / 10)).toBeCloseTo(
      THREE.MathUtils.degToRad(89.5) * sign,
    );
    expect(camera.up.z).toBeGreaterThan(0);
  });
  it("rejects invalid drags atomically", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, -10, 0);
    const before = camera.toJSON();
    expect(() =>
      rotateConstrained(camera, new THREE.Vector3(), NaN, 2),
    ).toThrow();
    expect(camera.toJSON()).toEqual(before);
  });
  it("starts a drag at an exact pole without losing its radius", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    rotateConstrained(camera, new THREE.Vector3(), 10, -10);
    expect(camera.position.length()).toBeCloseTo(10);
    expect(camera.position.toArray().every(Number.isFinite)).toBe(true);
    expect(camera.up.z).toBeGreaterThan(0);
  });
});

describe("camera window zoom", () => {
  for (const projection of ["orthographic", "perspective"] as const) {
    const makeCamera = () => {
      const camera =
        projection === "perspective"
          ? new THREE.PerspectiveCamera(90, 2, 0.1, 1000)
          : new THREE.OrthographicCamera(-20, 20, 10, -10, 0.1, 1000);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      return camera;
    };
    it.each([
      [0.5, 0.25, 1, 0.75],
      [0.6, 0.1, 0.8, 0.9],
      [0.1, 0.4, 0.9, 0.6],
    ])(
      `${projection} centers and fits wide and tall windows`,
      (x0, y0, x1, y1) => {
        const camera = makeCamera();
        const target = new THREE.Vector3();
        const quaternion = camera.quaternion.clone();
        const corners = [
          [x0, y0],
          [x1, y1],
        ].map(([x, y]) => {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
          return ray.ray.intersectPlane(
            new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
            new THREE.Vector3(),
          )!;
        });
        const center = corners[0].clone().add(corners[1]).multiplyScalar(0.5);
        zoomCameraWindow(
          camera,
          target,
          { x0: x1, y0: y1, x1: x0, y1: y0 },
          1000,
          500,
        );
        expect(target.distanceTo(center)).toBeLessThan(1e-9);
        expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-7);
        const projected = corners.map((p) => p.project(camera));
        expect(
          Math.max(...projected.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])),
        ).toBeCloseTo(1);
        expect(projected[0].x + projected[1].x).toBeCloseTo(0);
        expect(projected[0].y + projected[1].y).toBeCloseTo(0);
      },
    );
    it.each([
      [{ x0: 0, y0: 0, x1: NaN, y1: 1 }, 1000, 500],
      [{ x0: -0.1, y0: 0, x1: 0.5, y1: 1 }, 1000, 500],
      [{ x0: 0, y0: 0, x1: 0, y1: 1 }, 1000, 500],
      [{ x0: 0, y0: 0, x1: 0.003, y1: 1 }, 1000, 500],
      [{ x0: 0, y0: 0, x1: 1, y1: 0.007 }, 1000, 500],
      [{ x0: 0, y0: 0, x1: 1, y1: 1 }, 0, 500],
      [{ x0: 0, y0: 0, x1: 1, y1: 1 }, 1000, Infinity],
    ])(
      `${projection} rejects invalid rectangles without changing state`,
      (rect, width, height) => {
        const camera = makeCamera();
        const target = new THREE.Vector3();
        const before = camera.toJSON();
        expect(() =>
          zoomCameraWindow(camera, target, rect, width, height),
        ).toThrow();
        expect(camera.toJSON()).toEqual(before);
        expect(target.toArray()).toEqual([0, 0, 0]);
      },
    );
  }
  it("fits a window in a portrait viewport without using pixel aspect twice", () => {
    const camera = new THREE.PerspectiveCamera(60, 0.5, 0.1, 1000);
    camera.position.set(10, -10, 15);
    camera.up.set(0, 0, 1);
    const target = new THREE.Vector3(2, 3, 4);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      target,
    );
    const corners = [
      [0.1, 0.3],
      [0.9, 0.7],
    ].map(([x, y]) => {
      ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
      return ray.ray.intersectPlane(plane, new THREE.Vector3())!;
    });
    const before = camera.quaternion.clone();
    zoomCameraWindow(
      camera,
      target,
      { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.7 },
      500,
      1000,
    );
    expect(camera.quaternion.angleTo(before)).toBeLessThan(1e-7);
    expect(corners[0].project(camera).x).toBeCloseTo(-1);
    expect(corners[1].project(camera).x).toBeCloseTo(1);
  });
  it("bounds orthographic zoom at the existing maximum", () => {
    const camera = new THREE.OrthographicCamera(-20, 20, 10, -10);
    camera.position.z = 10;
    camera.zoom = 999;
    zoomCameraWindow(
      camera,
      new THREE.Vector3(),
      { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 },
      1000,
      500,
    );
    expect(camera.zoom).toBe(1000);
  });
  it("rejects an invalid projection without mutating camera or target", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.z = 10;
    camera.aspect = NaN;
    const before = camera.toJSON();
    const target = new THREE.Vector3();
    expect(() =>
      zoomCameraWindow(
        camera,
        target,
        { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 },
        1000,
        500,
      ),
    ).toThrow();
    expect(camera.toJSON()).toEqual(before);
    expect(target.toArray()).toEqual([0, 0, 0]);
  });
});
