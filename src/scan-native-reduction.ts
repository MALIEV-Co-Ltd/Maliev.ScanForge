import { prepareReductionMesh } from "./scan-reduction-preparation";
import { reductionCandidate } from "./scan-reduction-candidate";
import {
  rejectReductionCollapse,
  type ReductionReference,
} from "./scan-reduction-validity";
import { updateReductionFaces } from "./scan-reduction-update";
import { compactReductionMesh } from "./scan-reduction-final";
import type { MeshProcessingOptions } from "./mesh-processing";

/** Recovered sequential reduction kernel; original face/edge and reference ordering. */
export function nativeReductionMesh(
  coordinates: ArrayLike<number>,
  triangles: ArrayLike<number>,
  target: number,
  options: MeshProcessingOptions = {},
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const report = (fraction: number, stage: string) => {
    check();
    options.onProgress?.(fraction, stage);
    check();
  };
  check();
  if (coordinates.length % 3 || triangles.length % 3)
    throw new Error("Reduction requires complete vertex and triangle records.");
  if (
    !Number.isSafeInteger(target) ||
    target < 0 ||
    target > triangles.length / 3
  )
    throw new Error(
      "Reduction target must be an integer within the mesh face count.",
    );
  for (let index = 0; index < coordinates.length; index++) {
    if (index % 4096 === 0) check();
    if (!Number.isFinite(coordinates[index]))
      throw new Error("Reduction coordinates must be finite.");
  }
  for (let index = 0; index < triangles.length; index++) {
    if (index % 4096 === 0) check();
    const id = triangles[index];
    if (!Number.isSafeInteger(id) || id < 0 || id >= coordinates.length / 3)
      throw new Error("Reduction triangle index is outside the vertex buffer.");
  }
  report(0, "Preparing native reduction");
  const state = prepareReductionMesh(coordinates, triangles, check);
  const positions = Float64Array.from(coordinates);
  let { faces, references } = state;
  const { vertices, minimum } = state;
  const original = faces.length;
  let deleted = 0;
  let work = 0;
  const checkpoint = () => {
    if (work++ % 4096 === 0) check();
  };
  const rebuild = () => {
    faces = faces.filter((face) => {
      checkpoint();
      return !face.deleted;
    });
    for (const vertex of vertices) {
      checkpoint();
      vertex.count = vertex.offset = 0;
    }
    for (const face of faces) {
      checkpoint();
      for (const id of face.vertices) vertices[id].count++;
    }
    let offset = 0;
    for (const vertex of vertices) {
      checkpoint();
      vertex.offset = offset;
      offset += vertex.count;
      vertex.count = 0;
    }
    references = new Array(faces.length * 3);
    for (let face = 0; face < faces.length; face++) {
      checkpoint();
      for (let corner = 0; corner < 3; corner++) {
        const vertex = vertices[faces[face].vertices[corner]];
        references[vertex.offset + vertex.count++] = { face, corner };
      }
    }
  };
  report(0.2, "Collapsing native mesh edges");
  for (let pass = 0; pass < 1000 && original - deleted > target; pass++) {
    report(
      0.2 + 0.7 * Math.max(pass / 1000, deleted / (original - target)),
      "Collapsing native mesh edges",
    );
    if (pass > 0 && pass % 20 === 0) rebuild();
    for (const face of faces) {
      checkpoint();
      face.dirty = false;
    }
    const threshold = Math.pow(pass + 3, 4) * 1e-9;
    if (minimum > threshold) continue;
    for (const face of faces) {
      checkpoint();
      if (face.deleted || face.dirty || face.errors[face.bestEdge] > threshold)
        continue;
      const [e0, e1, e2] = face.errors;
      const order =
        e1 <= e0
          ? e2 <= e0
            ? [1, 2, 0]
            : [1, 0, 2]
          : e2 <= e0
            ? [2, 0, 1]
            : e2 <= e1
              ? [0, 2, 1]
              : [0, 1, 2];
      for (const edge of order) {
        if (face.errors[edge] >= threshold) continue;
        const a = face.vertices[edge],
          b = face.vertices[(edge + 1) % 3];
        const left = vertices[a],
          right = vertices[b];
        if (left.boundary || right.boundary) continue;
        const { point } = reductionCandidate(left, right);
        const leftRefs = references.slice(
          left.offset,
          left.offset + left.count,
        );
        const rightRefs = references.slice(
          right.offset,
          right.offset + right.count,
        );
        const leftMask = new Uint32Array(Math.ceil(left.count / 32));
        const rightMask = new Uint32Array(Math.ceil(right.count / 32));
        if (
          rejectReductionCollapse(
            point,
            b,
            positions,
            faces,
            leftRefs,
            leftMask,
          )
        )
          continue;
        if (
          rejectReductionCollapse(
            point,
            a,
            positions,
            faces,
            rightRefs,
            rightMask,
          )
        )
          continue;
        left.point = point;
        positions.set(point, a * 3);
        const quadric = left.quadric as Float64Array;
        for (let entry = 0; entry < 10; entry++)
          quadric[entry] = right.quadric[entry] + quadric[entry];
        const start = references.length;
        const appended: ReductionReference[] = [];
        deleted = updateReductionFaces(
          a,
          vertices,
          faces,
          leftRefs,
          leftMask,
          appended,
          deleted,
        );
        deleted = updateReductionFaces(
          a,
          vertices,
          faces,
          rightRefs,
          rightMask,
          appended,
          deleted,
        );
        for (const reference of appended) references.push(reference);
        if (left.count < appended.length) left.offset = start;
        else
          for (let entry = 0; entry < appended.length; entry++)
            references[left.offset + entry] = appended[entry];
        left.count = appended.length;
        break;
      }
      if (original - deleted <= target) break;
    }
  }
  report(0.95, "Compacting reduced mesh");
  const result = compactReductionMesh(positions, faces, check);
  report(1, "Polygon reduction completed");
  return result;
}
