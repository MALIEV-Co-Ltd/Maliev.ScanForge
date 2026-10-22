import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";

/** Readable engineering intervals, including quarter-decade steps. */
export function engineeringStep(minimum: number): number {
  if (!Number.isFinite(minimum) || minimum <= 0) return 10;
  const decade = 10 ** Math.floor(Math.log10(minimum));
  for (const step of [1, 2, 2.5, 5, 10])
    if (step * decade >= minimum * (1 - 1e-12)) return step * decade;
  return decade * 10;
}

/** About twelve cells across a part; small parts retain the familiar 10 mm floor. */
export function modelGridSpacing(bounds: THREE.Box3): number {
  if (bounds.isEmpty()) return 10;
  const size = bounds.getSize(new THREE.Vector3());
  return Math.min(
    1e6,
    Math.max(10, engineeringStep(Math.max(size.x, size.y, size.z) / 12)),
  );
}

export type ViewportScale = {
  distanceMm: number;
  widthPx: number;
  reference: "view-center";
};

/** Screen-horizontal distance in the camera-facing plane through the orbit target. */
export function viewportScale(
  camera: NavigationCamera,
  target: THREE.Vector3,
  width: number,
  height: number,
): ViewportScale | null {
  if (width <= 0 || height <= 0) return null;
  let worldHeight: number;
  if (camera instanceof THREE.OrthographicCamera)
    worldHeight = (camera.top - camera.bottom) / camera.zoom;
  else {
    camera.updateMatrixWorld();
    const depth = -target.clone().applyMatrix4(camera.matrixWorldInverse).z;
    if (depth <= 0) return null;
    worldHeight =
      (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
      camera.zoom;
  }
  const mmPerPixel = worldHeight / height;
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;
  const maxWidth = Math.min(120, width * 0.22);
  const distanceMm = engineeringStep((maxWidth * mmPerPixel) / 2.5);
  return {
    distanceMm,
    widthPx: distanceMm / mmPerPixel,
    reference: "view-center",
  };
}

export function formatScaleMm(value: number): string {
  return `${Number(value.toPrecision(6))} mm`;
}
