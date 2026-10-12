import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";

export interface ScanBoundaryPath {
  points: readonly number[];
  closed: boolean;
}
/** Edge-only overlay. A subdued casing keeps charcoal readable over the dark canvas. */
export function createScanBoundaryEdges(
  paths: readonly ScanBoundaryPath[],
): THREE.Group {
  const group = new THREE.Group();
  const segments: number[] = [];
  for (const { points, closed } of paths) {
    if (
      points.length < 6 ||
      points.length % 3 ||
      !points.every(Number.isFinite)
    )
      continue;
    for (let i = 3; i < points.length; i += 3)
      segments.push(...points.slice(i - 3, i), ...points.slice(i, i + 3));
    if (closed && points.slice(-3).some((value, i) => value !== points[i]))
      segments.push(...points.slice(-3), ...points.slice(0, 3));
  }
  if (!segments.length) return group;
  for (const [color, linewidth] of [
    ["#87939a", 4],
    ["#172126", 2.5],
  ] as const) {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(segments);
    const material = new LineMaterial({
      color,
      linewidth,
      depthTest: true,
      depthWrite: false,
    });
    const edges = new LineSegments2(geometry, material);
    edges.renderOrder = linewidth === 4 ? 2 : 3;
    edges.raycast = () => {}; // This visualization is not a face-selection target.
    group.add(edges);
  }
  return group;
}
