import {
  reductionCandidate,
  type ReductionVertex,
} from "./scan-reduction-candidate";
import type { ReductionWorkingFace } from "./scan-reduction-update";
import type { ReductionReference } from "./scan-reduction-validity";
import type { Vec3 } from "./types";

export interface ReductionWorkingVertex extends ReductionVertex {
  offset: number;
  count: number;
}

/** Original preparation order: normals/quadrics, errors, incidence, then boundaries. */
export function prepareReductionMesh(
  coordinates: ArrayLike<number>,
  triangles: ArrayLike<number>,
  checkpoint?: () => void,
) {
  let work = 0;
  const check = () => {
    if (work++ % 4096 === 0) checkpoint?.();
  };
  const vertices: ReductionWorkingVertex[] = [];
  for (let id = 0; id < coordinates.length / 3; id++) {
    check();
    vertices.push({
      point: [
        coordinates[id * 3],
        coordinates[id * 3 + 1],
        coordinates[id * 3 + 2],
      ],
      quadric: new Float64Array(10),
      boundary: false,
      offset: 0,
      count: 0,
    });
  }
  const faces: ReductionWorkingFace[] = [];
  for (let corner = 0; corner < triangles.length; corner += 3) {
    check();
    const ids: [number, number, number] = [
      triangles[corner],
      triangles[corner + 1],
      triangles[corner + 2],
    ];
    const a = vertices[ids[0]].point,
      b = vertices[ids[1]].point,
      c = vertices[ids[2]].point;
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    let nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length >= Number.EPSILON) {
      const reciprocal = 1 / length;
      nx *= reciprocal;
      ny *= reciprocal;
      nz *= reciprocal;
    }
    const d = -(a[1] * ny + nx * a[0] + a[2] * nz);
    const quadric = [
      nx * nx,
      nx * ny,
      nx * nz,
      nx * d,
      ny * ny,
      ny * nz,
      ny * d,
      nz * nz,
      nz * d,
      d * d,
    ];
    for (const id of ids) {
      const q = vertices[id].quadric as Float64Array;
      for (let entry = 0; entry < 10; entry++)
        q[entry] = quadric[entry] + q[entry];
    }
    faces.push({
      vertices: ids,
      normal: [nx, ny, nz] as Vec3,
      errors: [0, 0, 0],
      bestEdge: 0,
      dirty: false,
      deleted: false,
    });
  }
  let minimum = 3.4028234663852886e38;
  for (const face of faces) {
    check();
    const [a, b, c] = face.vertices;
    const e0 = reductionCandidate(vertices[a], vertices[b]).cost;
    const e1 = reductionCandidate(vertices[b], vertices[c]).cost;
    const e2 = reductionCandidate(vertices[c], vertices[a]).cost;
    face.errors = [e0, e1, e2];
    face.bestEdge = e1 <= e0 ? (e2 <= e1 ? 2 : 1) : e2 <= e0 ? 2 : 0;
    if (face.errors[face.bestEdge] < minimum)
      minimum = face.errors[face.bestEdge];
    for (const id of face.vertices) vertices[id].count++;
  }
  let offset = 0;
  for (const vertex of vertices) {
    check();
    vertex.offset = offset;
    offset += vertex.count;
    vertex.count = 0;
  }
  const references: ReductionReference[] = new Array(triangles.length);
  for (let face = 0; face < faces.length; face++) {
    check();
    for (let corner = 0; corner < 3; corner++) {
      const vertex = vertices[faces[face].vertices[corner]];
      references[vertex.offset + vertex.count++] = { face, corner };
    }
  }
  for (const vertex of vertices) {
    check();
    const occurrences = new Map<number, number>();
    for (
      let entry = vertex.offset;
      entry < vertex.offset + vertex.count;
      entry++
    ) {
      check();
      for (const id of faces[references[entry].face].vertices)
        occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
    for (const [id, count] of occurrences)
      if (count === 1) vertices[id].boundary = true;
  }
  checkpoint?.();
  return { vertices, faces, references, minimum };
}
