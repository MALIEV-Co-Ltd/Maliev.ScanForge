import * as THREE from "three";

/** Mark only exposed selection edges, excluding shared internal triangulation. */
export function installSelectionBoundaryAttributes(
  geometry: THREE.BufferGeometry,
) {
  const positions = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!;
  const size = bounds.getSize(new THREE.Vector3());
  const tolerance = Math.max(size.x, size.y, size.z, 1) * 1e-6;
  const vertexKeys = Array.from({ length: positions.count }, (_, i) =>
    [positions.getX(i), positions.getY(i), positions.getZ(i)]
      .map((value) => Math.round(value / tolerance))
      .join(","),
  );
  const edgeKey = (a: number, b: number) =>
    vertexKeys[a] < vertexKeys[b]
      ? `${vertexKeys[a]}:${vertexKeys[b]}`
      : `${vertexKeys[b]}:${vertexKeys[a]}`;
  const edges = new Map<string, number>();
  for (let i = 0; i < positions.count; i += 3)
    for (const [a, b] of [
      [i + 1, i + 2],
      [i + 2, i],
      [i, i + 1],
    ]) {
      const key = edgeKey(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const barycentric = new Float32Array(positions.count * 3);
  const boundary = new Float32Array(positions.count * 3);
  const segments: number[] = [];
  for (let i = 0; i < positions.count; i += 3) {
    const exposed = [
      edges.get(edgeKey(i + 1, i + 2)) === 1 ? 1 : 0,
      edges.get(edgeKey(i + 2, i)) === 1 ? 1 : 0,
      edges.get(edgeKey(i, i + 1)) === 1 ? 1 : 0,
    ];
    for (let edge = 0; edge < 3; edge++) {
      if (!exposed[edge]) continue;
      for (const vertex of [i + ((edge + 1) % 3), i + ((edge + 2) % 3)])
        segments.push(
          positions.getX(vertex),
          positions.getY(vertex),
          positions.getZ(vertex),
        );
    }
    for (let vertex = 0; vertex < 3; vertex++) {
      barycentric[(i + vertex) * 3 + vertex] = 1;
      boundary.set(exposed, (i + vertex) * 3);
    }
  }
  geometry.setAttribute(
    "processingBarycentric",
    new THREE.BufferAttribute(barycentric, 3),
  );
  geometry.setAttribute(
    "processingBoundary",
    new THREE.BufferAttribute(boundary, 3),
  );
  return segments;
}
