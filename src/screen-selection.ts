import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Positions } from "./types";
import { brushTrianglePoint, type ScreenPoint } from "./brush-coverage";

export type ScreenRegion =
  | {
      kind: "rectangle" | "circle";
      start: [number, number];
      end: [number, number];
    }
  | { kind: "brush"; points: ScreenPoint[]; radius: number };
export interface SelectionView {
  width: number;
  height: number;
  through: boolean;
}

/** Screen centroid selection with exact accelerated ray tests for self-occlusion of the selected mesh. */
export class ScreenSelectionIndex {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly tree: MeshBVH | undefined;
  constructor(
    private readonly positions: Positions,
    private readonly hidden: number[] = [],
  ) {
    if (!positions.length || positions.length % 9)
      throw new Error("Screen selection requires finite complete triangles.");
    for (let i = 0; i < positions.length; i++)
      if (!Number.isFinite(Math.fround(positions[i])))
        throw new Error(
          "Screen selection requires finite Float32 triangle coordinates.",
        );
    this.geometry.setAttribute(
      "position",
      positions instanceof Float32Array
        ? new THREE.BufferAttribute(positions, 3)
        : new THREE.Float32BufferAttribute(positions, 3),
    );
    if (hidden.length) {
      const hiddenSet = new Set(hidden),
        indices = new Uint32Array((positions.length / 9 - hidden.length) * 3);
      let offset = 0;
      for (let i = 0; i < positions.length / 9; i++)
        if (!hiddenSet.has(i)) {
          indices[offset++] = i * 3;
          indices[offset++] = i * 3 + 1;
          indices[offset++] = i * 3 + 2;
        }
      this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    this.tree =
      hidden.length === positions.length / 9
        ? undefined
        : new MeshBVH(this.geometry, { indirect: true });
  }
  select(
    camera: THREE.Camera,
    region: ScreenRegion,
    view: SelectionView,
  ): Uint8Array {
    if (
      ![
        view.width,
        view.height,
        ...(region.kind === "brush"
          ? [region.radius, ...region.points.flat()]
          : [...region.start, ...region.end]),
      ].every(Number.isFinite) ||
      view.width <= 0 ||
      view.height <= 0 ||
      (region.kind === "brush"
        ? !region.points.length || region.radius <= 0
        : !["rectangle", "circle"].includes(region.kind))
    )
      throw new Error("Invalid screen selection region.");
    camera.updateMatrixWorld();
    const mask = new Uint8Array(this.positions.length / 9);
    const point = new THREE.Vector3(),
      projected = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const start = region.kind === "brush" ? [0, 0] : region.start;
    const end =
      region.kind === "brush" ? [view.width, view.height] : region.end;
    const minX = Math.min(start[0], end[0]),
      maxX = Math.max(start[0], end[0]);
    const minY = Math.min(start[1], end[1]),
      maxY = Math.max(start[1], end[1]);
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      rx = (maxX - minX) / 2,
      ry = (maxY - minY) / 2;
    const hiddenSet = new Set(this.hidden);
    const vertices = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];
    for (let i = 0; i < this.positions.length; i += 9) {
      if (hiddenSet.has(i / 9)) continue;
      point.set(
        (this.positions[i] + this.positions[i + 3] + this.positions[i + 6]) / 3,
        (this.positions[i + 1] +
          this.positions[i + 4] +
          this.positions[i + 7]) /
          3,
        (this.positions[i + 2] +
          this.positions[i + 5] +
          this.positions[i + 8]) /
          3,
      );
      projected.copy(point).project(camera);
      if (projected.z < -1 || projected.z > 1) continue;
      let x = ((projected.x + 1) * view.width) / 2,
        y = ((1 - projected.y) * view.height) / 2;
      if (region.kind === "brush") {
        const triangle = vertices.map((vertex, corner) => {
          vertex.fromArray(this.positions, i + corner * 3);
          projected.copy(vertex).project(camera);
          return [
            ((projected.x + 1) * view.width) / 2,
            ((1 - projected.y) * view.height) / 2,
          ] as ScreenPoint;
        });
        const touch = brushTrianglePoint(
          triangle,
          region.points,
          region.radius,
        );
        if (!touch) continue;
        // Move an edge contact fractionally inward so ray/triangle roundoff
        // does not discard a triangle that the brush actually touched.
        x =
          touch[0] +
          ((triangle[0][0] + triangle[1][0] + triangle[2][0]) / 3 - touch[0]) *
            1e-7;
        y =
          touch[1] +
          ((triangle[0][1] + triangle[1][1] + triangle[2][1]) / 3 - touch[1]) *
            1e-7;
        ndc.set((x / view.width) * 2 - 1, 1 - (y / view.height) * 2);
        raycaster.setFromCamera(ndc, camera);
        if (
          !raycaster.ray.intersectTriangle(
            vertices[0],
            vertices[1],
            vertices[2],
            false,
            point,
          )
        )
          continue;
        projected.copy(point).project(camera);
        if (projected.z < -1 || projected.z > 1) continue;
      }
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (
        region.kind === "circle" &&
        (!rx || !ry || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1)
      )
        continue;
      if (!view.through) {
        ndc.set(projected.x, projected.y);
        raycaster.setFromCamera(ndc, camera);
        const hit = this.tree?.raycastFirst(
          raycaster.ray,
          THREE.DoubleSide,
          camera instanceof THREE.PerspectiveCamera ? camera.near : 0,
          camera instanceof THREE.PerspectiveCamera ? camera.far : Infinity,
        );
        if (
          !hit ||
          hit.point.distanceTo(point) > Math.max(1e-5, hit.distance * 1e-6)
        )
          continue;
      }
      mask[i / 9] = 1;
    }
    return mask;
  }
  dispose(): void {
    this.geometry.dispose();
  }
}
