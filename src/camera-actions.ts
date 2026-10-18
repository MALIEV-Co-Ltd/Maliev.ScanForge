import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";

export type OrbitMode = "free" | "constrained";

const WORLD_UP = new THREE.Vector3(0, 0, 1);
const MAX_PITCH = THREE.MathUtils.degToRad(89.5);

function cameraOffset(
  camera: NavigationCamera,
  target: THREE.Vector3,
): THREE.Vector3 {
  const offset = camera.position.clone().sub(target);
  if (
    ![
      ...camera.position.toArray(),
      ...target.toArray(),
      ...camera.quaternion.toArray(),
      offset.length(),
    ].every(Number.isFinite) ||
    offset.length() <= 1e-12
  ) {
    throw new Error("Invalid camera pose.");
  }
  return offset;
}

/** Remove camera roll using world Z; exact poles use world Y as a stable up. */
export function constrainCameraUp(
  camera: NavigationCamera,
  target: THREE.Vector3,
): void {
  const backward = cameraOffset(camera, target).normalize();
  const up = WORLD_UP.clone().addScaledVector(backward, -backward.z);
  if (up.lengthSq() < 1e-16)
    up.set(0, 1, 0).addScaledVector(backward, -backward.y);
  camera.up.copy(up.normalize());
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

/** Drag with world-Z yaw and bounded elevation, keeping the orbit radius fixed. */
export function rotateConstrained(
  camera: NavigationCamera,
  target: THREE.Vector3,
  dx: number,
  dy: number,
): void {
  if (![dx, dy].every(Number.isFinite)) throw new Error("Invalid orbit drag.");
  const offset = cameraOffset(camera, target);
  const distance = offset.length();
  const yaw = Math.atan2(offset.y, offset.x) - dx * 0.008;
  const pitch = THREE.MathUtils.clamp(
    Math.asin(THREE.MathUtils.clamp(offset.z / distance, -1, 1)) + dy * 0.008,
    -MAX_PITCH,
    MAX_PITCH,
  );
  const horizontal = distance * Math.cos(pitch);
  camera.position.set(
    target.x + horizontal * Math.cos(yaw),
    target.y + horizontal * Math.sin(yaw),
    target.z + distance * Math.sin(pitch),
  );
  constrainCameraUp(camera, target);
}

/** Fit a normalized top-left rectangle on the camera-facing target plane.
 * All calculations use a clone so invalid requests leave the live pose intact. */
export function zoomCameraWindow(
  camera: NavigationCamera,
  target: THREE.Vector3,
  rect: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number,
): void {
  const coordinates = [rect.x0, rect.y0, rect.x1, rect.y1];
  const relativeWidth = Math.abs(rect.x1 - rect.x0);
  const relativeHeight = Math.abs(rect.y1 - rect.y0);
  if (
    ![width, height, ...coordinates].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    coordinates.some((value) => value < 0 || value > 1) ||
    relativeWidth * width < 4 ||
    relativeHeight * height < 4
  )
    throw new Error(
      "Invalid zoom window: select at least 4 pixels in each dimension within the viewport.",
    );
  const offset = cameraOffset(camera, target);
  const next = camera.clone();
  next.updateProjectionMatrix();
  next.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(rect.x0 + rect.x1 - 1, 1 - rect.y0 - rect.y1),
    next,
  );
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
    next.getWorldDirection(new THREE.Vector3()),
    target,
  );
  const center = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!center || !center.toArray().every(Number.isFinite))
    throw new Error("Invalid camera target plane.");
  const ratio = Math.max(relativeWidth, relativeHeight);
  if (next instanceof THREE.OrthographicCamera) {
    next.zoom = THREE.MathUtils.clamp(next.zoom / ratio, 0.001, 1000);
    next.position.add(center.clone().sub(target));
  } else {
    next.position.copy(center).addScaledVector(offset, ratio);
  }
  next.updateProjectionMatrix();
  if (
    ![
      ...next.position.toArray(),
      ...next.projectionMatrix.elements,
      next.zoom,
    ].every(Number.isFinite) ||
    next.zoom <= 0
  ) {
    throw new Error("Invalid camera projection.");
  }
  camera.position.copy(next.position);
  camera.zoom = next.zoom;
  target.copy(center);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
