import { Matrix4, Ray, Vector3 } from "three";
import type { ReferenceCoordinateView } from "./automation/api";
import type { Positions, Vec3 } from "./types";

export const REFERENCE_SCREEN_TRIANGLE_LIMIT = 2_000_000;
export const REFERENCE_SCREEN_CLIP_LIMIT = 32;

/** Small detached camera/material witness; never copies source geometry. */
export function copyReferenceCoordinateView(
  view: ReferenceCoordinateView,
): ReferenceCoordinateView {
  if (
    !view ||
    !["perspective", "orthographic"].includes(view.projection) ||
    view.cameraMatrixFormat !== "column-major-4x4"
  )
    throw new Error(
      "Reference acquisition requires a supported camera capture.",
    );
  const matrix = (values: readonly number[]) => {
    if (
      !Array.isArray(values) ||
      values.length !== 16 ||
      !Array.from(values).every(
        (value) => typeof value === "number" && Number.isFinite(value),
      )
    )
      throw new Error(
        "Reference camera matrices require sixteen finite values.",
      );
    const copy = [...values],
      determinant = new Matrix4().fromArray(copy).determinant();
    if (!Number.isFinite(determinant) || determinant === 0)
      throw new Error("Reference camera matrix is not invertible.");
    return copy;
  };
  const projectionMatrix = matrix(view.projectionMatrix),
    cameraWorldMatrix = matrix(view.cameraWorldMatrix);
  if (
    !view.viewport ||
    !Number.isFinite(view.viewport.width) ||
    view.viewport.width <= 0 ||
    !Number.isFinite(view.viewport.height) ||
    view.viewport.height <= 0
  )
    throw new Error(
      "Reference acquisition requires a finite positive viewport.",
    );
  if (
    view.viewport.coordinates !== undefined &&
    typeof view.viewport.coordinates !== "string"
  )
    throw new Error("Invalid reference viewport coordinate convention.");
  if (
    !Array.isArray(view.clippingPlanes) ||
    view.clippingPlanes.length > REFERENCE_SCREEN_CLIP_LIMIT
  )
    throw new Error(
      "Reference screen capture exceeds the 32 clipping-plane limit.",
    );
  const clippingPlanes = Array.from(view.clippingPlanes, (plane) => {
    if (
      !plane ||
      !Array.isArray(plane.normal) ||
      plane.normal.length !== 3 ||
      !Array.from(plane.normal).every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) ||
      !Number.isFinite(plane.constant) ||
      !Number.isFinite(Math.hypot(...plane.normal)) ||
      !(Math.hypot(...plane.normal) > 0)
    )
      throw new Error(
        "Reference clipping planes require finite nonzero normals and constants.",
      );
    return {
      normal: [plane.normal[0], plane.normal[1], plane.normal[2]] as const,
      constant: plane.constant,
    };
  });
  const side = view.materialSide ?? 2;
  const materialSide =
    side === "front" ? 0 : side === "back" ? 1 : side === "double" ? 2 : side;
  if (![0, 1, 2].includes(materialSide))
    throw new Error("Invalid reference material side.");
  if (
    view.clipIntersection !== undefined &&
    typeof view.clipIntersection !== "boolean"
  )
    throw new Error("Invalid reference clipping intersection policy.");
  return {
    projection: view.projection,
    cameraMatrixFormat: "column-major-4x4",
    projectionMatrix,
    cameraWorldMatrix,
    viewport: {
      width: view.viewport.width,
      height: view.viewport.height,
      ...(view.viewport.coordinates === undefined
        ? {}
        : { coordinates: view.viewport.coordinates }),
    },
    clippingPlanes,
    materialSide,
    clipIntersection: view.clipIntersection ?? false,
  };
}

/**
 * Declared application screen acquisition: world F32 nodes, double ray/triangle
 * arithmetic, then one F32 XYZ. This is not a native viewport-predicate claim.
 */
export function resolveReferenceScreenCoordinate(
  mesh: { vertices: Positions; triangles: readonly number[] | Uint32Array },
  capture: ReferenceCoordinateView,
  selection: { x: number; y: number },
  options: {
    firstTriangle?: number;
    triangleCount?: number;
    hiddenTriangles?: readonly number[];
    check?: () => void;
  } = {},
): { position: Vec3; triangleIndex: number } {
  const check = options.check ?? (() => {});
  check();
  const view = copyReferenceCoordinateView(capture);
  if (
    !selection ||
    !Number.isFinite(selection.x) ||
    !Number.isFinite(selection.y) ||
    selection.x < 0 ||
    selection.x > 1 ||
    selection.y < 0 ||
    selection.y > 1
  )
    throw new Error(
      "Reference screen coordinates must be normalized x/y within [0,1].",
    );
  const vertices = mesh?.vertices,
    triangles = mesh?.triangles;
  if (
    !(Array.isArray(vertices) || vertices instanceof Float32Array) ||
    vertices.length % 3 !== 0 ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    triangles.length % 3 !== 0
  )
    throw new Error(
      "Reference screen acquisition requires complete canonical triangles.",
    );
  const total = triangles.length / 3,
    first = options.firstTriangle ?? 0,
    count = options.triangleCount ?? total - first;
  if (
    !Number.isSafeInteger(first) ||
    first < 0 ||
    first > total ||
    !Number.isSafeInteger(count) ||
    count < 0 ||
    first + count > total
  )
    throw new Error("Reference screen face triangle range is invalid.");
  if (count > REFERENCE_SCREEN_TRIANGLE_LIMIT)
    throw new Error(
      "Reference screen work exceeds 2000000 triangle visits. Select a smaller face or split the source.",
    );
  const hidden = options.hiddenTriangles ?? [];
  if (!Array.isArray(hidden) || hidden.length > REFERENCE_SCREEN_TRIANGLE_LIMIT)
    throw new Error(
      "Reference hidden-face work limit exceeded. Reduce the selection or split the source.",
    );
  const excluded = new Set<number>();
  for (let index = 0; index < hidden.length; index++) {
    if ((index & 1023) === 0) check();
    const triangle = hidden[index];
    if (!Number.isSafeInteger(triangle) || triangle < 0 || triangle >= total)
      throw new Error("Reference hidden triangle index is invalid.");
    excluded.add(triangle);
  }
  const projection = new Matrix4().fromArray(view.projectionMatrix),
    inverseProjection = projection.clone().invert();
  const camera = new Matrix4().fromArray(view.cameraWorldMatrix),
    inverseCamera = camera.clone().invert();
  const near = new Vector3(selection.x * 2 - 1, 1 - selection.y * 2, -1)
    .applyMatrix4(inverseProjection)
    .applyMatrix4(camera);
  const origin =
    view.projection === "perspective"
      ? new Vector3().setFromMatrixPosition(camera)
      : near.clone();
  const direction =
    view.projection === "perspective"
      ? near.clone().sub(origin).normalize()
      : new Vector3(0, 0, -1).transformDirection(camera);
  if (
    ![
      origin.x,
      origin.y,
      origin.z,
      direction.x,
      direction.y,
      direction.z,
    ].every(Number.isFinite) ||
    direction.lengthSq() === 0
  )
    throw new Error("Reference screen ray exceeds the finite numeric range.");
  const ray = new Ray(origin, direction),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    hit = new Vector3(),
    best = new Vector3(),
    projected = new Vector3();
  const vertexCount = vertices.length / 3;
  const vertex = (index: number, target: Vector3) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= vertexCount)
      throw new Error(
        "Reference triangle contains a missing canonical vertex.",
      );
    const offset = index * 3,
      x = vertices[offset],
      y = vertices[offset + 1],
      z = vertices[offset + 2];
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z) ||
      Math.abs(x) > 1e9 ||
      Math.abs(y) > 1e9 ||
      Math.abs(z) > 1e9
    )
      throw new Error(
        "Canonical reference coordinates exceed finite world bounds.",
      );
    target.set(Math.fround(x), Math.fround(y), Math.fround(z));
  };
  let closest = Infinity,
    winner = -1;
  for (let index = first; index < first + count; index++) {
    if ((index & 1023) === 0) check();
    if (excluded.has(index)) continue;
    const offset = index * 3;
    vertex(triangles[offset], a);
    vertex(triangles[offset + 1], b);
    vertex(triangles[offset + 2], c);
    const intersection =
      view.materialSide === 1
        ? ray.intersectTriangle(c, b, a, true, hit)
        : ray.intersectTriangle(a, b, c, view.materialSide === 0, hit);
    if (!intersection) continue;
    projected.copy(hit).applyMatrix4(inverseCamera).applyMatrix4(projection);
    if (!Number.isFinite(projected.z) || projected.z < -1 || projected.z > 1)
      continue;
    let anyClipped = false,
      allClipped = view.clippingPlanes.length > 0;
    for (
      let planeIndex = 0;
      planeIndex < view.clippingPlanes.length;
      planeIndex++
    ) {
      const plane = view.clippingPlanes[planeIndex],
        n = plane.normal;
      const distance =
        n[0] * hit.x + n[1] * hit.y + n[2] * hit.z + plane.constant;
      if (!Number.isFinite(distance))
        throw new Error(
          "Reference clip equation exceeds finite numeric range.",
        );
      const clipped = distance < 0;
      anyClipped ||= clipped;
      allClipped &&= clipped;
    }
    if (view.clipIntersection ? allClipped : anyClipped) continue;
    const distance = hit.distanceToSquared(origin);
    if (distance < closest) {
      closest = distance;
      winner = index;
      best.copy(hit);
    }
  }
  check();
  if (winner < 0)
    throw new Error(
      "No visible canonical source triangle intersects the captured screen coordinate.",
    );
  return {
    position: [Math.fround(best.x), Math.fround(best.y), Math.fround(best.z)],
    triangleIndex: winner,
  };
}
