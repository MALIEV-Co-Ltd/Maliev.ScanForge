import { describe, expect, it } from "vitest";
import { Box3, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { updateCameraClipping } from "../src/camera-clipping";

describe("camera depth range", () => {
  it.each([false, true])(
    "restores empty-scene limits after geometry fitting (orthographic: %s)",
    (orthographic) => {
      const camera = orthographic
        ? new OrthographicCamera(-100, 100, 100, -100)
        : new PerspectiveCamera();
      camera.position.set(0, 0, 200);
      camera.lookAt(0, 0, 0);
      updateCameraClipping(
        camera,
        new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
      );
      camera.position.set(0, 0, 150);
      updateCameraClipping(camera, new Box3());
      expect(camera.near).toBe(orthographic ? -10000 : 0.01);
      expect(camera.far).toBe(10000);
      for (const point of [new Vector3(), new Vector3(0, 0, 80)])
        expect(Math.abs(point.project(camera).z)).toBeLessThan(1);
      camera.position.z = 100000;
      updateCameraClipping(camera, new Box3());
      expect(Math.abs(new Vector3().project(camera).z)).toBeLessThan(1);
    },
  );
  for (const scale of [0.000001, 1, 1000000]) {
    for (const orthographic of [false, true]) {
      it(`fits ${orthographic ? "parallel" : "perspective"} geometry at scale ${scale}`, () => {
        const camera = orthographic
          ? new OrthographicCamera(-scale, scale, scale, -scale)
          : new PerspectiveCamera();
        const center = new Vector3(10000, 20000, 30000);
        const bounds = new Box3(
          center.clone().addScalar(-scale),
          center.clone().addScalar(scale),
        );
        camera.position.copy(center).add(new Vector3(0, 0, scale * 4));
        camera.lookAt(center);
        updateCameraClipping(camera, bounds);
        expect(camera.near).toBeGreaterThan(0);
        expect(camera.far / camera.near).toBeLessThan(2);
        for (const z of [bounds.min.z, bounds.max.z]) {
          const depth = new Vector3(center.x, center.y, z).project(camera).z;
          expect(Math.abs(depth)).toBeLessThan(1);
        }
        const previousFar = camera.far;
        camera.position.z += scale * 100;
        updateCameraClipping(camera, bounds);
        expect(camera.far).toBeGreaterThan(previousFar);
        expect(Math.abs(center.clone().project(camera).z)).toBeLessThan(1);
      });
    }
  }
  it("keeps parallel geometry visible when panning across the eye plane", () => {
    const camera = new OrthographicCamera(-2, 2, 2, -2);
    const bounds = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    updateCameraClipping(camera, bounds);
    expect(camera.near).toBeLessThan(-1);
    expect(camera.far).toBeGreaterThan(1);
    for (const z of [-1, 1])
      expect(Math.abs(new Vector3(0, 0, z).project(camera).z)).toBeLessThan(1);
  });
  it("retains a positive, small perspective near plane inside a scan", () => {
    const camera = new PerspectiveCamera();
    const bounds = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    camera.position.set(0, 0, 0);
    updateCameraClipping(camera, bounds);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.near).toBeLessThan(0.00001);
    expect(camera.far).toBeGreaterThan(1);
    expect(Math.abs(new Vector3(0, 0, -0.0001).project(camera).z)).toBeLessThan(
      1,
    );
  });
});
