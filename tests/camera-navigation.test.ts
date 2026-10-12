import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { navigateCamera } from "../src/camera-navigation";
describe("six-axis navigation", () => {
  it("pans the target and camera equally in camera coordinates", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const target = new THREE.Vector3();
    navigateCamera(
      camera,
      target,
      { translation: [1, 0, 0], rotation: [0, 0, 0] },
      0.05,
    );
    expect(camera.position.x).toBeCloseTo(-0.4);
    expect(target.x).toBeCloseTo(-0.4);
    expect(camera.position.distanceTo(target)).toBeCloseTo(10);
  });
  it("rotates around the target while preserving radius and normalizing up", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const target = new THREE.Vector3();
    navigateCamera(
      camera,
      target,
      { translation: [0, 0, 0], rotation: [1, 0.3, 0.2] },
      0.05,
    );
    expect(camera.position.distanceTo(target)).toBeCloseTo(10);
    expect(camera.up.length()).toBeCloseTo(1);
    expect(camera.position.y).not.toBe(0);
  });
  it("ignores long frame gaps and rejects invalid input", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, 10);
    const target = new THREE.Vector3();
    navigateCamera(
      camera,
      target,
      { translation: [0, 1, 0], rotation: [0, 0, 0] },
      4,
    );
    expect(target.length()).toBeCloseTo(0.4);
    expect(() =>
      navigateCamera(
        camera,
        target,
        { translation: [NaN, 0, 0], rotation: [0, 0, 0] },
        0.01,
      ),
    ).toThrow("Invalid");
  });
  it.each([0, 1, 2])(
    "reverses translation axis %i so the model follows the cap",
    (axis) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      const target = new THREE.Vector3();
      const translation: [number, number, number] = [0, 0, 0];
      translation[axis] = 1;
      navigateCamera(
        camera,
        target,
        { translation, rotation: [0, 0, 0] },
        0.05,
      );
      const expected = [
        new THREE.Vector3(-0.4, 0, 0),
        new THREE.Vector3(0, 0, 0.4),
        new THREE.Vector3(0, -0.4, 0),
      ][axis];
      expect(target.distanceTo(expected)).toBeLessThan(1e-10);
      expect(
        camera.position
          .clone()
          .sub(new THREE.Vector3(0, 0, 10))
          .distanceTo(expected),
      ).toBeLessThan(1e-10);
    },
  );
  it.each([0, 1, 2])(
    "reverses rotation axis %i around the camera-relative pivot",
    (axis) => {
      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      const target = new THREE.Vector3();
      const rotation: [number, number, number] = [0, 0, 0];
      rotation[axis] = 1;
      const basis = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0, 1, 0),
      ][axis];
      const expected = new THREE.Quaternion().setFromAxisAngle(basis, -0.07);
      navigateCamera(
        camera,
        target,
        { translation: [0, 0, 0], rotation },
        0.05,
      );
      expect(
        camera.position.distanceTo(
          new THREE.Vector3(0, 0, 10).applyQuaternion(expected),
        ),
      ).toBeLessThan(1e-10);
      expect(
        camera.up.distanceTo(
          new THREE.Vector3(0, 1, 0).applyQuaternion(expected),
        ),
      ).toBeLessThan(1e-10);
      expect(target.length()).toBe(0);
    },
  );
  it("keeps orthographic zoom direction consistent with perspective depth motion", () => {
    const camera = new THREE.OrthographicCamera(-5, 5, 5, -5);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    const target = new THREE.Vector3();
    navigateCamera(
      camera,
      target,
      { translation: [0, 1, 0], rotation: [0, 0, 0] },
      0.05,
    );
    expect(camera.zoom).toBeLessThan(1);
    expect(target.length()).toBe(0);
    navigateCamera(
      camera,
      target,
      { translation: [0, -1, 0], rotation: [0, 0, 0] },
      0.05,
    );
    expect(camera.zoom).toBeCloseTo(1);
  });
});
