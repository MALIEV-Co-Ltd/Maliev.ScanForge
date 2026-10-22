import * as THREE from "three";
import { updateCameraClipping } from "./camera-clipping";
import type { NavigationCamera } from "./camera-gizmo";

export function createViewportGrid(
  spacing = 20,
  visibleRadius = 0,
): THREE.GridHelper {
  const requested = Math.ceil(
    Math.max(spacing * 10, visibleRadius / 0.8) / spacing,
  );
  // Bound line geometry for very large scans or very small user grid spacing.
  const stride = Math.max(1, Math.ceil(requested / 1024));
  const halfCells = Math.ceil(requested / stride);
  const halfExtent = halfCells * stride * spacing;
  const grid = new THREE.GridHelper(
    halfExtent * 2,
    halfCells * 2,
    "#a7b6bd",
    "#d0dadf",
  );
  grid.userData.spacing = spacing;
  grid.userData.halfExtent = halfExtent;
  grid.userData.divisions = halfCells * 2;
  grid.rotation.x = Math.PI / 2;
  const material = grid.material as THREE.LineBasicMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 gridPosition;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ngridPosition = position.xz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec2 gridPosition;",
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(${(halfExtent * 0.8).toExponential(8)}, ${(halfExtent * 0.95).toExponential(8)}, length(gridPosition));`,
      );
  };
  material.customProgramCacheKey = () => `radial-workspace-grid-${halfExtent}`;
  return grid;
}

/** Keep the unfaded floor at least half a part width beyond every projected edge. */
export function updateViewportGrid(
  grid: THREE.GridHelper,
  spacing: number,
  bounds: THREE.Box3,
): boolean {
  let radius = 0;
  if (!bounds.isEmpty()) {
    grid.updateWorldMatrix(true, false);
    const local = bounds
      .clone()
      .applyMatrix4(grid.matrixWorld.clone().invert());
    const width = local.max.x - local.min.x;
    const depth = local.max.z - local.min.z;
    const x =
      Math.max(Math.abs(local.min.x), Math.abs(local.max.x)) + width * 0.5;
    const z =
      Math.max(Math.abs(local.min.z), Math.abs(local.max.z)) + depth * 0.5;
    radius = Math.hypot(x, z);
  }
  const requested = Math.ceil(Math.max(spacing * 10, radius / 0.8) / spacing);
  const stride = Math.max(1, Math.ceil(requested / 1024));
  const halfExtent = Math.ceil(requested / stride) * stride * spacing;
  if (
    grid.userData.spacing === spacing &&
    grid.userData.halfExtent === halfExtent
  )
    return false;
  const fresh = createViewportGrid(spacing, radius);
  grid.geometry.dispose();
  for (const material of [grid.material].flat()) material.dispose();
  grid.geometry = fresh.geometry;
  grid.material = fresh.material;
  Object.assign(grid.userData, fresh.userData);
  return true;
}

/** Draw the reference grid behind the model with its own depth range. */
export function renderSceneWithGrid(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  gridScene: THREE.Scene,
  camera: NavigationCamera,
  modelBounds: THREE.Box3,
  referenceBounds?: THREE.Box3,
): void {
  const clippingBounds = referenceBounds
    ? modelBounds.clone().union(referenceBounds)
    : modelBounds;
  const background = scene.background;
  const autoClear = renderer.autoClear;
  const near = camera.near,
    far = camera.far;
  try {
    gridScene.background = background;
    updateCameraClipping(camera, new THREE.Box3().setFromObject(gridScene));
    renderer.autoClear = true;
    renderer.render(gridScene, camera);
    renderer.clearDepth();
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    updateCameraClipping(camera, clippingBounds);
    renderer.autoClear = false;
    scene.background = null;
    renderer.render(scene, camera);
  } finally {
    scene.background = background;
    renderer.autoClear = autoClear;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    updateCameraClipping(camera, clippingBounds);
  }
}
