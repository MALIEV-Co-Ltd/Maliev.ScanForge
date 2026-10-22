import { expect, it } from "vitest";
import * as THREE from "three";
import {
  engineeringStep,
  modelGridSpacing,
  viewportScale,
} from "../src/viewport-scale";

it("adapts model spacing without changing small models or measuring distance from origin", () => {
  for (const [width, spacing] of [
    [40, 10],
    [120, 10],
    [250, 25],
    [500, 50],
    [600, 50],
    [1100, 100],
  ]) {
    const bounds = new THREE.Box3(
      new THREE.Vector3(10000, 0, 0),
      new THREE.Vector3(10000 + width, 10, 5),
    );
    expect(modelGridSpacing(bounds)).toBe(spacing);
  }
  expect(modelGridSpacing(new THREE.Box3())).toBe(10);
  expect(engineeringStep(21)).toBe(25);
});

for (const perspective of [false, true]) {
  it(`shows a correct view-center scale through zoom and resize (${perspective})`, () => {
    const camera = perspective
      ? new THREE.PerspectiveCamera(60, 2, 0.1, 10000)
      : new THREE.OrthographicCamera(-200, 200, 100, -100);
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (const zoom of [0.5, 1, 3]) {
      camera.zoom = zoom;
      camera.position.z = 500 + zoom * 100;
      camera.updateProjectionMatrix();
      const scale = viewportScale(camera, new THREE.Vector3(), 1000, 500)!;
      const origin = new THREE.Vector3().project(camera);
      const end = new THREE.Vector3(scale.distanceMm, 0, 0).project(camera);
      expect((end.x - origin.x) * 500).toBeCloseTo(scale.widthPx, 6);
      expect(scale.widthPx).toBeLessThanOrEqual(120);
      expect(
        viewportScale(camera, new THREE.Vector3(), 1000, 1000)!.distanceMm,
      ).toBeLessThanOrEqual(scale.distanceMm);
    }
    expect(viewportScale(camera, new THREE.Vector3(), 0, 0)).toBeNull();
  });
}
