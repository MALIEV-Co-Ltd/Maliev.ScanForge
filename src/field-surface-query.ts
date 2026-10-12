import {
  guideQueryBoundsContain,
  guideQueryBoundsLength,
} from "./field-query-bounds";
import { projectGuideTriangle } from "./field-triangle-projection";

/** Supplied native-style tree; construction and geometry/cache acquisition remain separate. */
export interface GuideQueryNode {
  bounds: Float32Array;
  range?: readonly [start: number, end: number];
  children?: readonly [first: number | null, second: number | null];
}
export interface GuideQuerySurface {
  positions: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
  bounds: Float32Array;
  faces: Uint32Array;
  nodes: readonly GuideQueryNode[];
  root: number | null;
}

/** Recovered triangle-storage traversal with a caller-supplied tree and normal cache. */
export function queryGuideSurface(
  surface: GuideQuerySurface,
  point: Float32Array,
  threshold: number,
  output = new Float32Array(3),
): {
  face: number;
  secondaryFace: number;
  distance: number;
  point: Float32Array;
} {
  const f = Math.fround;
  if (
    surface.positions.length % 3 ||
    surface.triangles.length % 3 ||
    surface.normals.length !== surface.triangles.length ||
    [surface.positions, surface.normals, point, output].some(
      (values) => !values.every(Number.isFinite),
    ) ||
    point.length !== 3 ||
    output.length !== 3 ||
    !Number.isFinite(f(threshold))
  )
    throw new Error("Surface query dimensions or float inputs are invalid");
  for (const vertex of surface.triangles)
    if (vertex >= surface.positions.length / 3)
      throw new Error("Surface query vertex is invalid");
  for (const face of surface.faces)
    if (face >= surface.triangles.length / 3)
      throw new Error("Surface query face is invalid");
  let distance = f(threshold);
  if (distance < 0)
    distance = f(guideQueryBoundsLength(surface.bounds) * f(0.025));
  let face = -1;
  const result = output.slice();
  const projected = new Float32Array(3);
  const stack: number[] = surface.root === null ? [] : [surface.root];
  const visited = new Set<number>();
  while (stack.length) {
    const index = stack.pop()!;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= surface.nodes.length ||
      visited.has(index)
    )
      throw new Error("Surface query tree is invalid or cyclic");
    visited.add(index);
    const node = surface.nodes[index];
    if (!guideQueryBoundsContain(node.bounds, point, distance)) continue;
    if (node.range && node.range[0] < node.range[1]) {
      const [start, end] = node.range;
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > surface.faces.length
      )
        throw new Error("Surface query leaf range is invalid");
      for (let ordinal = start; ordinal < end; ordinal++) {
        const candidate = surface.faces[ordinal];
        const vertices = [0, 1, 2].map((corner) => {
          const vertex = surface.triangles[candidate * 3 + corner];
          return surface.positions.slice(vertex * 3, vertex * 3 + 3);
        });
        const candidateDistance = projectGuideTriangle(
          point,
          vertices[0],
          vertices[1],
          vertices[2],
          surface.normals.slice(candidate * 3, candidate * 3 + 3),
          projected,
        );
        if (candidateDistance < distance) {
          distance = candidateDistance;
          face = candidate;
          result.set(projected);
        }
      }
    } else if (node.children && node.children[0] !== null) {
      stack.push(node.children[0]);
      if (node.children[1] === null)
        throw new Error("Surface query second child is missing");
      stack.push(node.children[1]);
    }
  }
  return { face, secondaryFace: face, distance, point: result };
}
