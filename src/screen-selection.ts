import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Positions } from "./types";

export type ScreenRegion = {
  kind: "rectangle" | "circle";
  start: [number, number];
  end: [number, number];
};
export interface SelectionView {
  width: number;
  height: number;
  through: boolean;
}

/** Screen centroid selection with exact accelerated ray tests for self-occlusion of the selected mesh. */
export class ScreenSelectionIndex {
  private readonly geometry = new THREE.BufferGeometry();
  private readonly tree: MeshBVH;
  constructor(private readonly positions: Positions) {
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
    this.tree = new MeshBVH(this.geometry, { indirect: true });
  }
  select(
    camera: THREE.Camera,
    region: ScreenRegion,
    view: SelectionView,
  ): Uint8Array {
    if (
      ![view.width, view.height, ...region.start, ...region.end].every(
        Number.isFinite,
      ) ||
      view.width <= 0 ||
      view.height <= 0 ||
      !["rectangle", "circle"].includes(region.kind)
    )
      throw new Error("Invalid screen selection region.");
    camera.updateMatrixWorld();
    const mask = new Uint8Array(this.positions.length / 9);
    const point = new THREE.Vector3(),
      projected = new THREE.Vector3();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const minX = Math.min(region.start[0], region.end[0]),
      maxX = Math.max(region.start[0], region.end[0]);
    const minY = Math.min(region.start[1], region.end[1]),
      maxY = Math.max(region.start[1], region.end[1]);
    const cx = (minX + maxX) / 2,
      cy = (minY + maxY) / 2,
      rx = (maxX - minX) / 2,
      ry = (maxY - minY) / 2;
    for (let i = 0; i < this.positions.length; i += 9) {
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
      const x = ((projected.x + 1) * view.width) / 2,
        y = ((1 - projected.y) * view.height) / 2;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (
        region.kind === "circle" &&
        (!rx || !ry || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1)
      )
        continue;
      if (!view.through) {
        ndc.set(projected.x, projected.y);
        raycaster.setFromCamera(ndc, camera);
        const hit = this.tree.raycastFirst(
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
