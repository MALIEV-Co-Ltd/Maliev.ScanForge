import { expect, it } from "vitest";
import * as THREE from "three";
import { createOriginGeometry, updateOriginMarker } from "../src/origin";

function dispose(group: THREE.Group): void {
  group.traverse((object) => {
    const item = object as THREE.Mesh;
    item.geometry?.dispose();
    for (const material of [item.material].flat()) material?.dispose();
  });
}

for (const perspective of [false, true]) {
  for (const size of [0.1, 4000]) {
    it(`keeps the origin dot six CSS pixels across at ${size}mm (${perspective ? "perspective" : "orthographic"})`, () => {
      const group = createOriginGeometry(undefined, false);
      const marker = group.children.find(
        (child) => child.userData.originMarker,
      ) as THREE.Mesh<THREE.SphereGeometry>;
      const camera = perspective
        ? new THREE.PerspectiveCamera(42, 1.5, 0.001, 10000)
        : new THREE.OrthographicCamera(-size, size, size, -size, -10000, 10000);
      camera.position.set(size * 0.5, -size * 0.7, size * 1.2);
      camera.up.set(0, 0, 1);
      camera.lookAt(0, 0, 0);
      try {
        for (const zoom of [0.25, 1, 10]) {
          camera.zoom = zoom;
          camera.updateProjectionMatrix();
          for (const height of [300, 1000]) {
            updateOriginMarker(group, camera, height);
            const radius = marker.geometry.parameters.radius * marker.scale.x;
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
              camera.quaternion,
            );
            const a = right.clone().multiplyScalar(-radius).project(camera);
            const b = right.clone().multiplyScalar(radius).project(camera);
            const pixels = Math.hypot(
              ((b.x - a.x) *
                height *
                (camera instanceof THREE.PerspectiveCamera
                  ? camera.aspect
                  : 1)) /
                2,
              ((b.y - a.y) * height) / 2,
            );
            expect(pixels).toBeCloseTo(6, 8);
            expect(marker.visible).toBe(true);
            expect(marker.position.toArray()).toEqual([0, 0, 0]);
          }
        }
      } finally {
        dispose(group);
      }
    });
  }
}

it("handles zero-height viewports and perspective crossings of the origin safely", () => {
  const group = createOriginGeometry();
  const marker = group.children.find((child) => child.userData.originMarker)!;
  const camera = new THREE.PerspectiveCamera();
  try {
    camera.position.z = 10;
    camera.lookAt(0, 0, 0);
    updateOriginMarker(group, camera, 600);
    const scale = marker.scale.clone();
    for (const height of [0, -1, NaN, Infinity]) {
      updateOriginMarker(group, camera, height);
      expect(marker.scale.equals(scale)).toBe(true);
    }
    camera.position.z = 0;
    updateOriginMarker(group, camera, 600);
    expect(marker.visible).toBe(false);
    camera.position.z = -10;
    updateOriginMarker(group, camera, 600);
    expect(marker.visible).toBe(false);
    camera.lookAt(0, 0, 0);
    updateOriginMarker(group, camera, 600);
    expect(marker.visible).toBe(true);
    expect(marker.scale.toArray().every(Number.isFinite)).toBe(true);
  } finally {
    dispose(group);
  }
});
