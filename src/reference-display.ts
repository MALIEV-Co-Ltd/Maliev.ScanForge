import * as THREE from "three";
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
  data: Entity["reference"];
  dispose(): void;
}

/** Separate semantic display: no triangle carrier, normals, selection index or BVH. */
export function createReferenceDisplay(entity: Entity): ReferenceDisplay {
  const data = validateReferenceEntity(entity);
  if (!data) throw new Error("Expected semantic reference geometry.");
  const semantic = data.geometry;
  const start = new THREE.Vector3(
    ...(semantic.kind === "point" ? semantic.position : semantic.start),
  );
  const end =
    semantic.kind === "point"
      ? start.clone()
      : new THREE.Vector3(...referenceLineEnd(semantic));
  const local =
    semantic.kind === "point"
      ? [0, 0, 0]
      : [0, 0, 0, end.x - start.x, end.y - start.y, end.z - start.z];
  const values = new Float32Array(local);
  if (!values.every(Number.isFinite))
    throw new Error(
      "Reference display extent exceeds the finite Float32 range.",
    );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(values, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const object: ReferenceRenderObject =
    semantic.kind === "point"
      ? new THREE.Points(
          geometry,
          new THREE.PointsMaterial({ size: 7, sizeAttenuation: false }),
        )
      : new THREE.Line(geometry, new THREE.LineBasicMaterial());
  object.position.copy(start);
  const preciseBounds = referenceEntityBounds(entity)!;
  const bounds = new THREE.Box3(
    new THREE.Vector3(...preciseBounds.min),
    new THREE.Vector3(...preciseBounds.max),
  );
  object.userData.referenceKind = semantic.kind;
  object.userData.referenceBounds = bounds;
  // Picking uses the same authoritative world values as inspection. Display
  // Float32 offsets never replace the saved point or finite-line endpoint.
  object.raycast = (raycaster, hits) => {
    const onRay = new THREE.Vector3(),
      onGeometry = new THREE.Vector3();
    const threshold =
      semantic.kind === "point"
        ? raycaster.params.Points.threshold
        : raycaster.params.Line.threshold;
    let distanceSquared: number;
    if (semantic.kind === "point" || start.equals(end)) {
      onGeometry.copy(start);
      raycaster.ray.closestPointToPoint(start, onRay);
      distanceSquared = onRay.distanceToSquared(start);
    } else
      distanceSquared = raycaster.ray.distanceSqToSegment(
        start,
        end,
        onRay,
        onGeometry,
      );
    const distance = raycaster.ray.origin.distanceTo(onRay);
    if (
      distanceSquared > threshold * threshold ||
      distance < raycaster.near ||
      distance > raycaster.far
    )
      return;
    hits.push({ object, point: onGeometry, distance, index: 0 });
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
    data: entity.reference,
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
