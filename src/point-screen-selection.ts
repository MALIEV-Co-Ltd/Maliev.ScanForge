import * as THREE from "three";
import type { Positions } from "./types";
import type { ScreenRegion, SelectionView } from "./screen-selection";
import { pointInLasso } from "./lasso-coverage";

/** Point selection uses projected samples, never synthetic triangle faces. */
export class PointScreenSelectionIndex {
  constructor(
    private positions: Positions,
    private hidden: number[] = [],
  ) {
    if (
      !positions.length ||
      positions.length % 3 ||
      !positions.every(Number.isFinite)
    )
      throw new Error("Point selection requires finite XYZ samples.");
  }
  select(
    camera: THREE.Camera,
    region: ScreenRegion,
    view: SelectionView,
    range = { start: 0, end: this.positions.length / 3 },
  ): Uint8Array {
    if (
      !Number.isFinite(view.width) ||
      !Number.isFinite(view.height) ||
      view.width <= 0 ||
      view.height <= 0 ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > this.positions.length / 3
    )
      throw new Error("Invalid point selection view or partition.");
    const values =
      "points" in region
        ? [region.radius, ...region.points.flat()]
        : [...region.start, ...region.end];
    if (
      !values.every(Number.isFinite) ||
      ("points" in region && (!region.points.length || region.radius <= 0))
    )
      throw new Error("Invalid point selection region.");
    if (
      view.clippingPlanes?.some(
        (p) =>
          p.length !== 4 ||
          !p.every(Number.isFinite) ||
          !Math.hypot(...p.slice(0, 3)),
      )
    )
      throw new Error("Invalid selection clipping plane.");
    camera.updateMatrixWorld();
    const hidden = new Set(this.hidden),
      point = new THREE.Vector3();
    // Depth memory depends on canvas pixels rather than the scan size. No
    // projected object array is retained for multi-million-point scans.
    const columns = Math.floor(view.width / 2) + 1;
    const depths = view.through
      ? undefined
      : new Float32Array(columns * (Math.floor(view.height / 2) + 1)).fill(
          Infinity,
        );
    const project = (i: number): boolean => {
      if (hidden.has(i)) return false;
      point.fromArray(this.positions, i * 3);
      if (
        view.clippingPlanes?.some(
          ([a, b, c, d]) => a * point.x + b * point.y + c * point.z + d < 0,
        )
      )
        return false;
      point.project(camera);
      if (point.z < -1 || point.z > 1) return false;
      point.x = ((point.x + 1) * view.width) / 2;
      point.y = ((1 - point.y) * view.height) / 2;
      return (
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= view.width &&
        point.y <= view.height
      );
    };
    const cell = () =>
      Math.floor(point.y / 2) * columns + Math.floor(point.x / 2);
    if (depths)
      for (let i = 0; i < this.positions.length / 3; i++) {
        if (!project(i)) continue;
        const key = cell();
        depths[key] = Math.min(depths[key], point.z);
      }
    const mask = new Uint8Array(range.end - range.start);
    const path =
      "points" in region
        ? region.kind === "lasso" && region.points.length > 1
          ? [...region.points, region.points[0]]
          : region.points
        : undefined;
    for (let index = range.start; index < range.end; index++) {
      if (!project(index) || (depths && point.z > depths[cell()] + 1e-6))
        continue;
      const p = point;
      let inside = false;
      if ("points" in region) {
        inside =
          region.kind === "lasso" &&
          region.points.length >= 3 &&
          pointInLasso([p.x, p.y], region.points);
        for (let i = 0; !inside && i < path!.length; i++) {
          const a = path![Math.max(0, i - 1)],
            b = path![i],
            dx = b[0] - a[0],
            dy = b[1] - a[1];
          const t = Math.max(
            0,
            Math.min(
              1,
              ((p.x - a[0]) * dx + (p.y - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          );
          inside =
            Math.hypot(p.x - a[0] - t * dx, p.y - a[1] - t * dy) <=
            region.radius;
        }
      } else {
        const left = Math.min(region.start[0], region.end[0]),
          right = Math.max(region.start[0], region.end[0]);
        const top = Math.min(region.start[1], region.end[1]),
          bottom = Math.max(region.start[1], region.end[1]);
        inside =
          region.kind === "rectangle"
            ? p.x >= left && p.x <= right && p.y >= top && p.y <= bottom
            : right > left &&
              bottom > top &&
              ((p.x - (left + right) / 2) / ((right - left) / 2)) ** 2 +
                ((p.y - (top + bottom) / 2) / ((bottom - top) / 2)) ** 2 <=
                1;
      }
      if (inside) mask[index - range.start] = 1;
    }
    return mask;
  }
  dispose(): void {}
}
