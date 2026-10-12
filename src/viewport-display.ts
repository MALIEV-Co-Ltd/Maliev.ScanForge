import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
/** Average adjacent facet normals for the smooth display; source vertices stay unchanged. */
export function smoothDisplayNormals(
  positions: ArrayLike<number>,
): Float32Array {
  const source = new THREE.BufferGeometry();
  source.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(Array.from(positions), 3),
  );
  const welded = mergeVertices(source, 0.000001);
  welded.computeVertexNormals();
  const expanded = welded.toNonIndexed();
  const normals = new Float32Array(expanded.getAttribute("normal").array);
  expanded.dispose();
  welded.dispose();
  source.dispose();
  return normals;
}
export function snapSketchGrid(
  point: [number, number],
  enabled: boolean,
  spacing: number,
): [number, number] {
  return enabled && Number.isFinite(spacing) && spacing > 0
    ? (point.map((value) => Math.round(value / spacing) * spacing) as [
        number,
        number,
      ])
    : point;
}
