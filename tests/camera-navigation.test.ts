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
    expect(camera.position.x).toBeCloseTo(0.4);
    expect(target.x).toBeCloseTo(0.4);
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
});
