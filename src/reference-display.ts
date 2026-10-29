import * as THREE from "three";
import {
  validateReferenceFrameEntity,
  referenceFrameBounds,
} from "./reference-frame";
import type { Entity } from "./types";
import {
  referenceEntityBounds,
  validateReferenceEntity,
} from "./reference-entity";
import { referenceLineEnd } from "./reference-construction-values";

export type ReferenceRenderObject =
  | THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  | THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
export interface ReferenceDisplay {
  object: ReferenceRenderObject;
  bounds: THREE.Box3;
  data: Entity["reference"] | Entity["coordinateFrame"];
  dispose(): void;
}

/** Separate semantic display: no triangle carrier, normals, selection index or BVH. */
export function createReferenceDisplay(entity: Entity): ReferenceDisplay {
  const frame = validateReferenceFrameEntity(entity);
  const data = frame ? undefined : validateReferenceEntity(entity);
  if (!frame && !data) throw new Error("Expected semantic reference geometry.");
  let start: THREE.Vector3;
  let point = false;
  let segments: [THREE.Vector3, THREE.Vector3][];
  if (frame) {
    start = new THREE.Vector3(...frame.frame.origin);
    segments = [frame.frame.u, frame.frame.v, frame.frame.normal].map(
      (axis) => [
        start.clone(),
        new THREE.Vector3(...axis).multiplyScalar(frame.displaySize).add(start),
      ],
    );
  } else {
    const semantic = data!.geometry;
    point = semantic.kind === "point";
    start = new THREE.Vector3(
      ...(semantic.kind === "point" ? semantic.position : semantic.start),
    );
    segments = [
      [
        start.clone(),
        semantic.kind === "point"
          ? start.clone()
          : new THREE.Vector3(...referenceLineEnd(semantic)),
      ],
    ];
  }
  const local = point
    ? [0, 0, 0]
    : segments.flatMap((pair) =>
        pair.flatMap((v) => [v.x - start.x, v.y - start.y, v.z - start.z]),
      );
  const values = new Float32Array(local);
  if (!values.every(Number.isFinite))
    throw new Error(
      "Reference display extent exceeds the finite Float32 range.",
    );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const object: ReferenceRenderObject = point
    ? new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 7, sizeAttenuation: false }),
      )
    : frame
      ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial())
      : new THREE.Line(geometry, new THREE.LineBasicMaterial());
  object.position.copy(start);
  const preciseBounds = (
    frame ? referenceFrameBounds(entity) : referenceEntityBounds(entity)
  )!;
  const bounds = new THREE.Box3(
    new THREE.Vector3(...preciseBounds.min),
    new THREE.Vector3(...preciseBounds.max),
  );
  object.userData.referenceKind = frame ? "frame" : data!.geometry.kind;
  object.userData.referenceBounds = bounds;
  // Picking retains authoritative binary64 world geometry independently of GPU offsets.
  object.raycast = (raycaster, hits) => {
    const threshold = point
      ? raycaster.params.Points.threshold
      : raycaster.params.Line.threshold;
    segments.forEach(([a, b], index) => {
      const onRay = new THREE.Vector3(),
        onGeometry = new THREE.Vector3();
      let distanceSquared: number;
      if (point || a.equals(b)) {
        onGeometry.copy(a);
        raycaster.ray.closestPointToPoint(a, onRay);
        distanceSquared = onRay.distanceToSquared(a);
      } else
        distanceSquared = raycaster.ray.distanceSqToSegment(
          a,
          b,
          onRay,
          onGeometry,
        );
      const distance = raycaster.ray.origin.distanceTo(onRay);
      if (
        distanceSquared <= threshold * threshold &&
        distance >= raycaster.near &&
        distance <= raycaster.far
      )
        hits.push({ object, point: onGeometry, distance, index });
    });
  };
  const material = object.material;
  const retirement = [
    { phase: "scene", done: false, run: () => object.removeFromParent() },
    { phase: "geometry", done: false, run: () => geometry.dispose() },
    { phase: "material", done: false, run: () => material.dispose() },
  ];
  let disposing = false;
  const display: ReferenceDisplay = {
    object,
    bounds,
    data: entity.coordinateFrame ?? entity.reference,
    dispose() {
      if (disposing) return;
      disposing = true;
      object.visible = false;
      const errors: unknown[] = [],
        failed: string[] = [];
      try {
        for (const step of retirement) {
          if (step.done) continue;
          try {
            step.run();
            step.done = true;
          } catch (error) {
            errors.push(error);
            failed.push(step.phase);
          }
        }
        if (errors.length)
          throw new AggregateError(
            errors,
            "Reference display cleanup failed: " + failed.join(", ") + ".",
          );
      } finally {
        disposing = false;
      }
    },
  };
  updateReferenceDisplay(display, entity);
  return display;
}

export function updateReferenceDisplay(
  display: ReferenceDisplay,
  entity: Entity,
): void {
  const { object } = display;
  object.name = entity.name;
  object.visible = entity.visible;
  object.userData.entityId = entity.id;
  object.userData.objectPickable =
    !entity.locked && entity.selectable !== false;
  object.material.color.set(entity.color);
  object.material.opacity = Math.max(0, Math.min(1, entity.opacity));
  object.material.transparent = object.material.opacity < 1;
  object.material.depthWrite = object.material.opacity >= 1;
  object.material.needsUpdate = true;
}
