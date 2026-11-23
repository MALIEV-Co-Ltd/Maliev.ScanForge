import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";

/** Decode Three's RGBADepthPacking, then unproject on the exact pointer ray. */
export function navigationDepthPoint(
  bytes: Uint8Array,
  screen: THREE.Vector2,
  camera: NavigationCamera,
): THREE.Vector3 | undefined {
  const depth = packedDepth(bytes, 0);
  if (!Number.isFinite(depth) || depth >= 1 || depth <= 0) return;
  return new THREE.Vector3(screen.x, screen.y, depth * 2 - 1).unproject(camera);
}

function packedDepth(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] / 256 +
    bytes[offset + 1] / 65536 +
    bytes[offset + 2] / 16777216 +
    bytes[offset + 3] / (255 * 16777216)
  );
}

/** Prefer the exact pixel; bridge only a small rendered-point gap, never a distant object. */
export function nearestNavigationDepth(
  bytes: Uint8Array,
  size: number,
  radius: number,
): Uint8Array | undefined {
  const center = Math.floor(size / 2);
  let best = -1,
    bestDistance = Infinity,
    bestDepth = Infinity;
  for (
    let y = Math.max(0, center - radius);
    y <= Math.min(size - 1, center + radius);
    y++
  ) {
    for (
      let x = Math.max(0, center - radius);
      x <= Math.min(size - 1, center + radius);
      x++
    ) {
      const distance = (x - center) ** 2 + (y - center) ** 2;
      if (distance > radius ** 2 || distance > bestDistance) continue;
      const offset = (y * size + x) * 4;
      const depth = packedDepth(bytes, offset);
      if (
        !(depth > 0 && depth < 1) ||
        (distance === bestDistance && depth >= bestDepth)
      )
        continue;
      best = offset;
      bestDistance = distance;
      bestDepth = depth;
    }
  }
  return best < 0 ? undefined : bytes.subarray(best, best + 4);
}

/** One pixel of rendered mesh/point/line depth, even before a CPU index exists.
 * Borrow geometry only; all temporary GPU resources are released synchronously.
 */
export function pickNavigationDepth(
  renderer: THREE.WebGLRenderer,
  camera: NavigationCamera,
  meshes: (THREE.Mesh | THREE.Points | THREE.Line)[],
  screen: THREE.Vector2,
): THREE.Vector3 | undefined {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio?.() ?? 1;
  const gl = renderer.getContext?.();
  const maximumPointSize =
    gl?.getParameter(gl.ALIASED_POINT_SIZE_RANGE)?.[1] ?? Infinity;
  const pointRadius = meshes.some((object) => object instanceof THREE.Points)
    ? Math.ceil(6 * pixelRatio)
    : 0;
  let tileSize = pointRadius * 2 + 1;
  for (const object of meshes) {
    if (!(object instanceof THREE.Points)) continue;
    object.updateWorldMatrix(true, false);
    const bounds = object.geometry.boundingBox
      ?.clone()
      .applyMatrix4(
        camera.matrixWorldInverse.clone().multiply(object.matrixWorld),
      );
    for (const material of [object.material].flat()) {
      const source = material as THREE.PointsMaterial;
      let pixels = source.size * pixelRatio;
      if (source.sizeAttenuation && camera instanceof THREE.PerspectiveCamera)
        pixels *=
          size.y /
          (2 *
            pixelRatio *
            Math.max(camera.near, -(bounds?.max.z ?? -camera.near)));
      tileSize = Math.max(
        tileSize,
        pointRadius * 2 + Math.ceil(Math.min(pixels, maximumPointSize)) + 2,
      );
    }
  }
  // Point centers must remain inside the crop even when the cursor hits a sprite edge.
  tileSize += tileSize % 2 === 0 ? 1 : 0;
  const target = new THREE.WebGLRenderTarget(tileSize, tileSize, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const scene = new THREE.Scene();
  const materials: THREE.Material[] = [];
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
      if (mesh instanceof THREE.Points)
        mesh.onBeforeRender(
          renderer,
          scene,
          camera,
          mesh.geometry,
          [mesh.material].flat()[0],
          null!, // Three uses null for non-grouped point geometry.
        );
      const depthMaterials = [mesh.material].flat().map((source) => {
        const material =
          mesh instanceof THREE.Points
            ? pointDepthMaterial(
                source as THREE.PointsMaterial,
                renderer.getPixelRatio(),
                size.y,
                camera,
              )
            : new THREE.MeshDepthMaterial({
                depthPacking: THREE.RGBADepthPacking,
                side: source.side,
                clippingPlanes: source.clippingPlanes,
                clipIntersection: source.clipIntersection,
                visible: source.visible,
              });
        materials.push(material);
        return material;
      });
      const proxy = mesh.clone(false);
      proxy.material = Array.isArray(mesh.material)
        ? depthMaterials
        : depthMaterials[0];
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(mesh.matrixWorld);
      proxy.layers.mask = mesh.layers.mask;
      scene.add(proxy);
    }
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
        size.x / tileSize,
        0,
        0,
        (-screen.x * size.x) / tileSize,
        0,
        size.y / tileSize,
        0,
        (-screen.y * size.y) / tileSize,
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
    const readSize = pointRadius * 2 + 1;
    const readStart = (tileSize - readSize) / 2;
    const bytes = new Uint8Array(readSize * readSize * 4);
    renderer.readRenderTargetPixels(
      target,
      readStart,
      readStart,
      readSize,
      readSize,
      bytes,
    );
    const sample = nearestNavigationDepth(bytes, readSize, pointRadius);
    return sample
      ? navigationDepthPoint(sample, screen, depthCamera)
      : undefined;
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

/** Keep sprite coverage at the displayed size while cropping the camera to one pixel. */
function pointDepthMaterial(
  source: THREE.PointsMaterial,
  pixelRatio: number,
  drawingHeight: number,
  camera: NavigationCamera,
) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      pointSize: { value: source.size * pixelRatio },
      pointScale: { value: drawingHeight / (2 * pixelRatio) },
      attenuate: {
        value:
          source.sizeAttenuation && camera instanceof THREE.PerspectiveCamera,
      },
    },
    side: source.side,
    clipping: true,
    clippingPlanes: source.clippingPlanes,
    clipIntersection: source.clipIntersection,
    visible: source.visible,
    vertexShader: `
      uniform float pointSize;
      uniform float pointScale;
      uniform bool attenuate;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
        gl_PointSize = pointSize;
        if (attenuate) gl_PointSize *= pointScale / -mvPosition.z;
        #include <clipping_planes_vertex>
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <packing>
      #include <logdepthbuf_pars_fragment>
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        #include <logdepthbuf_fragment>
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
  });
  // Reuse the displayed cloud's stable sampling discard and current fraction.
  material.onBeforeCompile = (shader, renderer) =>
    source.onBeforeCompile(shader, renderer);
  material.customProgramCacheKey = () =>
    `navigation-depth:${source.customProgramCacheKey()}`;
  return material;
}
