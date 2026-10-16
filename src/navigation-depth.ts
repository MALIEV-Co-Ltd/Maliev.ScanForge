import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";

/** Decode Three's RGBADepthPacking, then unproject on the exact pointer ray. */
export function navigationDepthPoint(
  bytes: Uint8Array,
  screen: THREE.Vector2,
  camera: NavigationCamera,
): THREE.Vector3 | undefined {
  const depth =
    bytes[0] / 256 +
    bytes[1] / 65536 +
    bytes[2] / 16777216 +
    bytes[3] / (255 * 16777216);
  if (!Number.isFinite(depth) || depth >= 1 || depth <= 0) return;
  return new THREE.Vector3(screen.x, screen.y, depth * 2 - 1).unproject(camera);
}

/** One pixel of rendered triangle depth, even before a CPU surface index exists.
 * Borrow geometry only; all temporary GPU resources are released synchronously.
 */
export function pickNavigationDepth(
  renderer: THREE.WebGLRenderer,
  camera: NavigationCamera,
  meshes: THREE.Mesh[],
  screen: THREE.Vector2,
): THREE.Vector3 | undefined {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const scene = new THREE.Scene();
  const materials: THREE.MeshDepthMaterial[] = [];
  const previousTarget = renderer.getRenderTarget();
  const previousFace = renderer.getActiveCubeFace();
  const previousLevel = renderer.getActiveMipmapLevel();
  const previousColor = renderer.getClearColor(new THREE.Color());
  const previousAlpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  const clipping = renderer.localClippingEnabled;
  try {
    const viewBounds = new THREE.Box3();
    let bounded = true;
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      // Import already measured these bounds. Never compute them by scanning
      // vertices in an input handler; tighten depth only when all are cached.
      if (mesh.geometry.boundingBox) {
        const viewMatrix = camera.matrixWorldInverse
          .clone()
          .multiply(mesh.matrixWorld);
        viewBounds.union(
          mesh.geometry.boundingBox.clone().applyMatrix4(viewMatrix),
        );
      } else bounded = false;
      const depthMaterials = [mesh.material].flat().map((source) => {
        const material = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          side: source.side,
          clippingPlanes: source.clippingPlanes,
          clipIntersection: source.clipIntersection,
          visible: source.visible,
        });
        materials.push(material);
        return material;
      });
      const proxy = new THREE.Mesh(
        mesh.geometry,
        Array.isArray(mesh.material) ? depthMaterials : depthMaterials[0],
      );
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(mesh.matrixWorld);
      proxy.layers.mask = mesh.layers.mask;
      scene.add(proxy);
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depthCamera = camera.clone();
    if (bounded && !viewBounds.isEmpty()) {
      // The display's generous mm clipping range loses depth precision on tiny
      // parts. Restrict this private pass to the visible geometry depth range.
      const margin = Math.max(
        0.01,
        (viewBounds.max.z - viewBounds.min.z) * 0.01,
      );
      const near = Math.max(camera.near, -viewBounds.max.z - margin);
      const far = Math.min(camera.far, -viewBounds.min.z + margin);
      if (far > near) {
        depthCamera.near = near;
        depthCamera.far = far;
        depthCamera.updateProjectionMatrix();
      }
    }
    const cropped = depthCamera.clone();
    // Crop around the exact CSS-pointer ray rather than rounding to a pixel.
    cropped.projectionMatrix.premultiply(
      new THREE.Matrix4().set(
        size.x,
        0,
        0,
        -screen.x * size.x,
        0,
        size.y,
        0,
        -screen.y * size.y,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ),
    );
    cropped.projectionMatrixInverse.copy(cropped.projectionMatrix).invert();
    renderer.setRenderTarget(target);
    renderer.autoClear = true;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0xffffff, 1);
    renderer.render(scene, cropped);
    const bytes = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, bytes);
    return navigationDepthPoint(bytes, screen, depthCamera);
  } finally {
    renderer.setRenderTarget(previousTarget, previousFace, previousLevel);
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.autoClear = autoClear;
    renderer.localClippingEnabled = clipping;
    scene.clear();
    for (const material of materials) material.dispose();
    target.dispose();
  }
}
