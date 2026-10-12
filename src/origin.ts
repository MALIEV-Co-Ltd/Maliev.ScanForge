import * as THREE from "three";
import {
  coordinateSketchFrame,
  validateSketchFrame,
  type SketchFrame,
} from "./sketch-frame";
import type { Vec3 } from "./types";
export const ORIGIN_PLANES = ["OXY", "OYZ", "OXZ"] as const;
export type OriginPlane = (typeof ORIGIN_PLANES)[number];
export const PLANE_LABELS = {
  OXY: "XY plane",
  OYZ: "YZ plane",
  OXZ: "XZ plane",
};

/** Explicit right-handed frame for a user-defined datum. */
export function datumFrame(origin: Vec3, normal: Vec3): SketchFrame {
  const n = new THREE.Vector3(...normal);
  if (!Number.isFinite(n.length()) || n.length() < 1e-9)
    throw new Error("Plane normal must be nonzero and finite.");
  n.normalize();
  const reference =
    Math.abs(n.z) < 0.9
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(0, 1, 0);
  const u = reference.cross(n).normalize();
  const v = n.clone().cross(u).normalize();
  const frame = {
    origin: [...origin] as Vec3,
    u: u.toArray() as Vec3,
    v: v.toArray() as Vec3,
    normal: n.toArray() as Vec3,
  };
  validateSketchFrame(frame);
  return frame;
}
export function highlightOriginPlane(
  group: THREE.Group,
  hovered?: OriginPlane,
): void {
  for (const child of group.children) {
    if (!child.userData.originPlane) continue;
    const item = child as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >;
    item.material.opacity = child.userData.originPlane === hovered ? 0.3 : 0.08;
  }
}
export function createOriginGeometry(
  hovered?: OriginPlane,
  showPlanes = true,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "World origin";
  group.add(new THREE.AxesHelper(35));
  const colors = { OXY: 0x669bd1, OYZ: 0xdb7971, OXZ: 0x79ba8c };
  for (const plane of ORIGIN_PLANES) {
    const frame = coordinateSketchFrame(plane, 0);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({
        color: colors[plane],
        transparent: true,
        opacity: hovered === plane ? 0.3 : 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...frame.u),
        new THREE.Vector3(...frame.v),
        new THREE.Vector3(...frame.normal),
      ),
    );
    mesh.userData.originPlane = plane;
    mesh.visible = showPlanes;
    mesh.renderOrder = 5;
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({
        color: colors[plane],
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      }),
    );
    edge.quaternion.copy(mesh.quaternion);
    edge.visible = showPlanes;
    edge.renderOrder = 6;
    group.add(mesh, edge);
  }
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xe5e5e5 }),
  );
  marker.name = "Origin (0, 0, 0) mm";
  group.add(marker);
  return group;
}
