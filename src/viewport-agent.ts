import * as THREE from "three";
import type { NavigationCamera } from "./camera-gizmo";

export function inspectCamera(
  camera: NavigationCamera,
  target: THREE.Vector3,
  bounds: THREE.Box3,
  width: number,
  height: number,
) {
  camera.updateMatrixWorld(true);
  return {
    projection:
      camera instanceof THREE.OrthographicCamera
        ? "orthographic"
        : "perspective",
    position: camera.position.toArray(),
    target: target.toArray(),
    up: camera.up.toArray(),
    zoom: camera.zoom,
    near: camera.near,
    far: camera.far,
    cameraMatrixFormat: "column-major-4x4",
    projectionMatrix: camera.projectionMatrix.toArray(),
    cameraWorldMatrix: camera.matrixWorld.toArray(),
    viewport: {
      width,
      height,
      coordinates: "normalized top-left x/y in [0,1]",
    },
    bounds: bounds.isEmpty()
      ? null
      : { min: bounds.min.toArray(), max: bounds.max.toArray() },
  };
}

export function setCameraPose(
  camera: NavigationCamera,
  target: THREE.Vector3,
  position: number[],
  nextTarget: number[],
  up?: number[],
  zoom?: number,
) {
  const point = new THREE.Vector3(...position),
    center = new THREE.Vector3(...nextTarget),
    vertical = up ? new THREE.Vector3(...up) : camera.up.clone();
  if (
    [
      ...position,
      ...nextTarget,
      ...vertical.toArray(),
      zoom ?? camera.zoom,
    ].some((n) => !Number.isFinite(n))
  )
    throw new Error("Camera pose must contain finite numbers.");
  const direction = point.clone().sub(center);
  if (
    direction.lengthSq() < 1e-12 ||
    vertical.lengthSq() < 1e-12 ||
    Math.abs(direction.clone().normalize().dot(vertical.clone().normalize())) >
      0.9999
  )
    throw new Error(
      "Camera position, target and up must define a valid viewing frame.",
    );
  if (zoom !== undefined && (zoom < 0.001 || zoom > 1000))
    throw new Error("Camera zoom is outside supported bounds.");
  camera.position.copy(point);
  target.copy(center);
  camera.up.copy(vertical.normalize());
  if (zoom !== undefined) camera.zoom = zoom;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/** Surface hits keep their intersection; cloud hits identify a measured vertex. */
export function pickedWorldPoint(hit: THREE.Intersection) {
  if (!(hit.object instanceof THREE.Points) || hit.index === undefined)
    return hit.point;
  const attribute = hit.object.geometry.getAttribute("position");
  return new THREE.Vector3(
    attribute.getX(hit.index),
    attribute.getY(hit.index),
    attribute.getZ(hit.index),
  ).applyMatrix4(hit.object.matrixWorld);
}

export function pickCamera(
  camera: NavigationCamera,
  objects: THREE.Mesh[],
  x: number,
  y: number,
  maxHits: number,
) {
  if (
    ![x, y].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    !Number.isInteger(maxHits) ||
    maxHits < 1 ||
    maxHits > 20
  )
    throw new Error("Pick coordinates or limit outside supported bounds.");
  camera.updateMatrixWorld(true);
  const eligible = objects.filter(
    (mesh) => mesh.visible && mesh.userData.objectPickable !== false,
  );
  for (const mesh of eligible) mesh.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const bounds = new THREE.Box3();
  for (const mesh of eligible)
    bounds.union(new THREE.Box3().setFromObject(mesh));
  ray.params.Points.threshold = Math.max(
    bounds.getSize(new THREE.Vector3()).length() / 800,
    0.05,
  );
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  return {
    hits: ray
      .intersectObjects(eligible, true)
      .filter((hit) => {
        if (
          !hit.object.visible ||
          !(
            hit.object instanceof THREE.Mesh ||
            hit.object instanceof THREE.Points
          )
        )
          return false;
        const material = Array.isArray(hit.object.material)
          ? hit.object.material[hit.face?.materialIndex ?? 0]
          : hit.object.material;
        return (material?.clippingPlanes ?? []).every(
          (plane: THREE.Plane) =>
            plane.distanceToPoint(pickedWorldPoint(hit)) >= 0,
        );
      })
      .slice(0, maxHits)
      .map((hit) => ({
        entityId: hit.object.userData.entityId,
        point: pickedWorldPoint(hit).toArray(),
        distance: hit.distance,
        triangleIndex: hit.faceIndex ?? null,
        ...(hit.object instanceof THREE.Points
          ? { pointIndex: hit.index ?? null }
          : {}),
      })),
    coordinates: { x, y },
    units: "mm",
    note: "Triangle indices refer to rendered tessellation; pointIndex refers to a point-cloud vertex. Neither is a native CAD edge/face reference.",
  };
}
