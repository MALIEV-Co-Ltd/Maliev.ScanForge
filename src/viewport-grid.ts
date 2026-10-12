import * as THREE from "three";
import { updateCameraClipping } from "./camera-clipping";
import type { NavigationCamera } from "./camera-gizmo";

export function createViewportGrid(spacing = 20): THREE.GridHelper {
  const grid = new THREE.GridHelper(spacing * 20, 20, "#a7b6bd", "#d0dadf");
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
        `#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(80.0, 190.0, length(gridPosition) * ${(20 / spacing).toExponential(8)});`,
      );
  };
  material.customProgramCacheKey = () => `radial-workspace-grid-${spacing}`;
  return grid;
}

/** Draw the reference grid behind the model with its own depth range. */
export function renderSceneWithGrid(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  gridScene: THREE.Scene,
  camera: NavigationCamera,
  modelBounds: THREE.Box3,
): void {
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
    updateCameraClipping(camera, modelBounds);
    renderer.autoClear = false;
    scene.background = null;
    renderer.render(scene, camera);
  } finally {
    scene.background = background;
    renderer.autoClear = autoClear;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    updateCameraClipping(camera, modelBounds);
  }
}
