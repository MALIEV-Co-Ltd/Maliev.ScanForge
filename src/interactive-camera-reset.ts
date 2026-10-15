import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";
import { nativeInteractiveResetView } from "./interactive-alignment-math";
import {
  nativeInteractiveFitView,
  nativeInteractiveAspectBounds,
  nativeInteractivePerspectiveSetup,
} from "./interactive-view-fit";

/** Bridge the retained renderer fit to Three cameras; depth remains under the shared clipping guard. */
export function resetInteractiveCamera(
  camera: NavigationCamera,
  target: THREE.Vector3,
  bounds: THREE.Box3,
  width: number,
  height: number,
  alternateUpAxis = false,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    bounds.isEmpty()
  )
    throw new Error(
      "Interactive view reset requires visible finite bounds and a nonempty viewport.",
    );
  const frame = nativeInteractiveResetView(alternateUpAxis);
  const fit = nativeInteractiveFitView(frame, [
    ...bounds.min.toArray(),
    ...bounds.max.toArray(),
  ]);
  const originalCamera = camera,
    originalTarget = target;
  camera = camera.clone();
  target = target.clone();
  const inverse = new THREE.Matrix3()
    .set(
      frame[0],
      frame[1],
      frame[2],
      frame[4],
      frame[5],
      frame[6],
      frame[8],
      frame[9],
      frame[10],
    )
    .invert();
  const anchor = new THREE.Vector3(...(fit.anchor as [number, number, number]));
  const up = new THREE.Vector3(0, 1, 0).applyMatrix3(inverse).normalize();
  const back = new THREE.Vector3(0, 0, 1).applyMatrix3(inverse).normalize();
  let fallback = false;
  camera.zoom = 1;
  if (camera instanceof THREE.OrthographicCamera) {
    let viewBounds = fit.viewBounds;
    if (viewBounds[0] === viewBounds[3] && viewBounds[1] === viewBounds[4]) {
      const radius = Math.max(
        1,
        ...anchor.toArray().map((n) => Math.abs(n) * 2 ** -20),
      );
      viewBounds = [
        anchor.x - radius,
        anchor.y - radius,
        viewBounds[2],
        anchor.x + radius,
        anchor.y + radius,
        viewBounds[5],
      ];
      fallback = true;
    }
    const adjusted = nativeInteractiveAspectBounds(viewBounds, width / height);
    anchor.fromArray(adjusted.anchor);
    target.copy(anchor);
    camera.left = adjusted.viewBounds[0] - anchor.x;
    camera.right = adjusted.viewBounds[3] - anchor.x;
    camera.bottom = adjusted.viewBounds[1] - anchor.y;
    camera.top = adjusted.viewBounds[4] - anchor.y;
    const distance = Math.max(1, camera.position.distanceTo(target));
    camera.position.copy(target).addScaledVector(back, distance);
  } else {
    const setup = nativeInteractivePerspectiveSetup(
      [...bounds.min.toArray(), ...bounds.max.toArray()],
      fit.anchor,
      camera.fov,
      width / height,
      [camera.near, camera.far],
    );
    camera.fov = setup.perspective[0];
    camera.aspect = setup.perspective[1];
    const eye = new THREE.Vector3(
      ...(setup.lookAt.slice(0, 3) as [number, number, number]),
    );
    const center = new THREE.Vector3(
      ...(setup.lookAt.slice(3, 6) as [number, number, number]),
    );
    target.copy(center).sub(anchor).applyMatrix3(inverse).add(anchor);
    camera.position.copy(eye).sub(anchor).applyMatrix3(inverse).add(anchor);
    if (camera.position.distanceToSquared(target) === 0) {
      fallback = true;
      camera.position
        .copy(target)
        .addScaledVector(
          back,
          Math.max(1e-6, bounds.getSize(new THREE.Vector3()).length()),
        );
    }
  }
  camera.up.copy(up);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  if (
    originalCamera instanceof THREE.OrthographicCamera &&
    camera instanceof THREE.OrthographicCamera
  )
    originalCamera.copy(camera, false);
  else if (
    originalCamera instanceof THREE.PerspectiveCamera &&
    camera instanceof THREE.PerspectiveCamera
  )
    originalCamera.copy(camera, false);
  originalTarget.copy(target);
  return { fit, fallback };
}
