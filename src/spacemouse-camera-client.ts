import * as THREE from "three";

interface CameraHost {
  camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera;
  target: THREE.Vector3;
  bounds(): THREE.Box3;
  update(): void;
  motion(): void;
  rotatable?(): boolean;
  pointer?(): THREE.Vector3 | undefined;
  selection?(): THREE.Box3 | undefined;
}
function values(input: unknown, count: number): number[] {
  if (
    !Array.isArray(input) ||
    input.length !== count ||
    !input.every((v) => typeof v === "number" && Number.isFinite(v))
  )
    throw new Error("Invalid SpaceMouse camera data.");
  return input;
}
/** The official driver exchanges absolute camera poses, not raw cap deltas. */
export function createSpaceMouseCameraClient(host: CameraHost) {
  const changed = () => {
    host.motion();
    host.update();
  };
  return {
    getCoordinateSystem: () => [
      1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
    ],
    getUnitsToMeters: () => 0.001,
    getPerspective: () => host.camera() instanceof THREE.PerspectiveCamera,
    getViewRotatable: () => host.rotatable?.() ?? true,
    getConstructionPlane: () => [0, 0, 1, 0],
    getFloorPlane: () => [0, 0, 1, 0],
    getViewMatrix: () => {
      const camera = host.camera();
      camera.updateMatrixWorld();
      return camera.matrixWorld.toArray();
    },
    setViewMatrix: (input: unknown) => {
      const data = values(input, 16),
        matrix = new THREE.Matrix4().fromArray(data);
      const position = new THREE.Vector3(),
        rotation = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      matrix.decompose(position, rotation, scale);
      if (
        data[3] !== 0 ||
        data[7] !== 0 ||
        data[11] !== 0 ||
        data[15] !== 1 ||
        Math.abs(matrix.determinant() - 1) > 1e-5 ||
        [scale.x, scale.y, scale.z].some((v) => Math.abs(v - 1) > 1e-5) ||
        !Number.isFinite(rotation.w)
      )
        throw new Error("SpaceMouse requires a rigid camera pose.");
      const camera = host.camera(),
        distance = Math.max(
          camera.position.distanceTo(host.target),
          camera.near * 10,
        );
      camera.position.copy(position);
      camera.quaternion.copy(rotation);
      camera.up.set(0, 1, 0).applyQuaternion(rotation);
      host.target
        .copy(position)
        .add(new THREE.Vector3(0, 0, -distance).applyQuaternion(rotation));
      changed();
    },
    getViewTarget: () => host.target.toArray(),
    setTarget: (input: unknown) => {
      host.target.fromArray(values(input, 3));
      changed();
    },
    getPivotPosition: () =>
      host.selection?.()?.getCenter(new THREE.Vector3()).toArray() ??
      host.target.toArray(),
    getPointerPosition: () => (host.pointer?.() ?? host.target).toArray(),
    getModelExtents: () => {
      const box = host.bounds();
      return box.isEmpty()
        ? [-50, -50, -50, 50, 50, 50]
        : [...box.min.toArray(), ...box.max.toArray()];
    },
    getSelectionEmpty: () => !host.selection?.(),
    getSelectionExtents: () => {
      const box = host.selection?.();
      return box ? [...box.min.toArray(), ...box.max.toArray()] : [];
    },
    getFov: () => {
      const camera = host.camera();
      return camera instanceof THREE.PerspectiveCamera
        ? THREE.MathUtils.degToRad(camera.getEffectiveFOV())
        : 0;
    },
    setFov: (input: unknown) => {
      const camera = host.camera();
      if (
        typeof input !== "number" ||
        !Number.isFinite(input) ||
        input <= 0 ||
        input >= Math.PI
      )
        throw new Error("Invalid SpaceMouse field of view.");
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = THREE.MathUtils.radToDeg(input);
        camera.zoom = 1;
        camera.updateProjectionMatrix();
        changed();
      }
    },
    getViewExtents: () => {
      const camera = host.camera();
      return camera instanceof THREE.OrthographicCamera
        ? [
            camera.left / camera.zoom,
            camera.bottom / camera.zoom,
            -camera.far,
            camera.right / camera.zoom,
            camera.top / camera.zoom,
            -camera.near,
          ]
        : [-1, -1, -camera.far, 1, 1, -camera.near];
    },
    setViewExtents: (input: unknown) => {
      const data = values(input, 6),
        camera = host.camera();
      if (data[3] <= data[0] || data[4] <= data[1] || data[5] <= data[2])
        throw new Error("Invalid SpaceMouse view extents.");
      if (camera instanceof THREE.OrthographicCamera) {
        const zoom = (camera.right - camera.left) / (data[3] - data[0]);
        if (zoom < 1e-6 || zoom > 1e6)
          throw new Error("SpaceMouse zoom is outside the viewport range.");
        camera.left = data[0] * zoom;
        camera.right = data[3] * zoom;
        camera.bottom = data[1] * zoom;
        camera.top = data[4] * zoom;
        camera.far = -data[2];
        camera.near = -data[5];
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        changed();
      }
    },
    getViewFrustum: () => {
      const camera = host.camera();
      const top =
        camera instanceof THREE.PerspectiveCamera
          ? camera.near *
            Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2)
          : 1;
      const aspect =
        camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
      return [-top * aspect, top * aspect, -top, top, camera.near, camera.far];
    },
    onStartMotion: () => host.motion(),
    onStopMotion: () => host.update(),
    setTransaction: (transaction: number) => {
      if (transaction === 0) changed();
    },
  };
}
