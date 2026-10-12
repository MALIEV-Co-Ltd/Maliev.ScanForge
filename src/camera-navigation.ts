import * as THREE from "three";
import type { Motion6D } from "./spacemouse";
/** Camera-relative six-axis navigation, with the orbit target as rotation pivot. */
export function navigateCamera(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  target: THREE.Vector3,
  motion: Motion6D,
  seconds: number,
): void {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    ![...motion.translation, ...motion.rotation].every(Number.isFinite)
  )
    throw new Error("Invalid navigation motion.");
  const dt = Math.min(seconds, 0.05);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
    camera.quaternion,
  );
  const distance = Math.max(
    camera instanceof THREE.OrthographicCamera
      ? (camera.top - camera.bottom) / (2 * camera.zoom)
      : camera.position.distanceTo(target),
    camera.near * 10,
  );
  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = Math.max(
      1e-6,
      Math.min(1e6, camera.zoom * Math.exp(motion.translation[1] * 0.8 * dt)),
    );
    camera.updateProjectionMatrix();
  }
  const delta = right
    .clone()
    .multiplyScalar(motion.translation[0])
    .addScaledVector(
      forward,
      camera instanceof THREE.OrthographicCamera ? 0 : motion.translation[1],
    )
    .addScaledVector(up, motion.translation[2])
    .multiplyScalar(distance * 0.8 * dt);
  camera.position.add(delta);
  target.add(delta);
  const rotation = right
    .multiplyScalar(motion.rotation[0])
    .addScaledVector(forward, motion.rotation[1])
    .addScaledVector(up, motion.rotation[2]);
  if (rotation.lengthSq() > 0) {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(
      rotation.clone().normalize(),
      rotation.length() * 1.4 * dt,
    );
    camera.position.sub(target).applyQuaternion(quaternion).add(target);
    camera.up.applyQuaternion(quaternion).normalize();
  }
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
