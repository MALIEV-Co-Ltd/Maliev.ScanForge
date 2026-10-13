import { Box3, OrthographicCamera, Vector3 } from "three";
import type { NavigationCamera } from "./camera-gizmo";

export const EMPTY_SCENE_EXTENT = 100;
export const DEFAULT_CAMERA_NEAR = 0.001;
export const DEFAULT_CAMERA_FAR = 10000;

/** Keep a stable millimetre working range; extend it for outlying geometry. */
export function updateCameraClipping(
  camera: NavigationCamera,
  bounds: Box3,
): void {
  camera.updateMatrixWorld();
  if (bounds.isEmpty()) {
    // Reference axes remain visible after the last object is hidden or removed.
    // Expand the default range when navigating far from the world origin.
    const far = Math.max(
      DEFAULT_CAMERA_FAR,
      camera.position.length() + EMPTY_SCENE_EXTENT * 10,
    );
    const near =
      camera instanceof OrthographicCamera ? -far : DEFAULT_CAMERA_NEAR;
    if (camera.near !== near || camera.far !== far) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    return;
  }
  let closest = Infinity;
  let furthest = -Infinity;
  const corner = new Vector3();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        const depth = -corner
          .set(x, y, z)
          .applyMatrix4(camera.matrixWorldInverse).z;
        closest = Math.min(closest, depth);
        furthest = Math.max(furthest, depth);
      }
  const size = bounds.getSize(corner).length();
  const epsilon = Math.max(
    size * 1e-7,
    Math.abs(furthest) * Number.EPSILON * 32,
    1e-12,
  );
  const margin = Math.max(size * 0.02, epsilon * 10);
  // Parallel projection can display geometry on either side of its eye plane.
  // Perspective must retain a positive near plane when navigating inside a scan.
  const near =
    camera instanceof OrthographicCamera
      ? Math.min(-DEFAULT_CAMERA_FAR, closest - margin)
      : Math.min(DEFAULT_CAMERA_NEAR, Math.max(epsilon, closest - margin));
  const far = Math.max(DEFAULT_CAMERA_FAR, near + margin, furthest + margin);
  if (camera.near !== near || camera.far !== far) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}
