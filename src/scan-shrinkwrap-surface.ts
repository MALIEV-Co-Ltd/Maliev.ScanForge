import {
  BufferAttribute,
  BufferGeometry,
  Vector3,
  Ray,
  DoubleSide,
} from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { Positions } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";

/** CPU-only nearest-facet index. The indirect index retains source facet identity. */
export class ShrinkwrapSurface {
  private geometry = new BufferGeometry();
  private tree: MeshBVH;
  private queryPoint = new Vector3();
  private hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  constructor(
    readonly coordinates: Float32Array,
    options: MeshProcessingOptions,
  ) {
    this.geometry.setAttribute("position", new BufferAttribute(coordinates, 3));
    this.tree = new MeshBVH(this.geometry, {
      indirect: true,
      targetLeafSize: 12,
      onProgress: () => {
        if (options.signal?.aborted)
          throw new DOMException("Mesh operation cancelled.", "AbortError");
      },
    });
  }
  distance(p: ArrayLike<number>) {
    this.queryPoint.set(p[0], p[1], p[2]);
    return this.tree.closestPointToPoint(this.queryPoint, this.hit)!.distance;
  }
  signedDistance(p: ArrayLike<number>) {
    this.queryPoint.set(p[0], p[1], p[2]);
    const hit = this.tree.closestPointToPoint(this.queryPoint, this.hit)!;
    const i = hit.faceIndex * 9,
      a = this.coordinates;
    const ux = a[i + 3] - a[i],
      uy = a[i + 4] - a[i + 1],
      uz = a[i + 5] - a[i + 2];
    const vx = a[i + 6] - a[i],
      vy = a[i + 7] - a[i + 1],
      vz = a[i + 8] - a[i + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    return (
      Math.sign(
        (p[0] - hit.point.x) * nx +
          (p[1] - hit.point.y) * ny +
          (p[2] - hit.point.z) * nz,
      ) * hit.distance
    );
  }
  nearest(p: ArrayLike<number>, radius = Infinity) {
    this.queryPoint.set(p[0], p[1], p[2]);
    const hit = this.tree.closestPointToPoint(
      this.queryPoint,
      this.hit,
      0,
      radius,
    );
    if (!hit) return undefined;
    const i = hit.faceIndex * 9,
      a = this.coordinates;
    const ux = a[i + 3] - a[i],
      uy = a[i + 4] - a[i + 1],
      uz = a[i + 5] - a[i + 2];
    const vx = a[i + 6] - a[i],
      vy = a[i + 7] - a[i + 1],
      vz = a[i + 8] - a[i + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (!length) return undefined;
    return {
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [nx / length, ny / length, nz / length],
      distance: hit.distance,
      face: hit.faceIndex,
    };
  }
  /** An outward ray distinguishes captured opposing sheets from a single thin
   * wall: the latter's outward normals point away from its opposite face. */
  measureCapturedGaps(
    sampleInterval: number,
    gapFill: number,
    extraThickness: number,
    options: MeshProcessingOptions,
  ) {
    const a = this.coordinates,
      stride = Math.max(1, Math.ceil(a.length / 9 / 4096));
    let magnitude = 0;
    for (let i = 0; i < a.length; i++)
      magnitude = Math.max(magnitude, Math.abs(a[i]));
    const coordinateUlp = Math.max(
      2 ** -149,
      2 ** (Math.floor(Math.log2(magnitude || 1)) - 23),
    );
    const epsilon = Math.max(sampleInterval * 1e-5, coordinateUlp * 8),
      band = 1.5 * sampleInterval + gapFill + 2 * extraThickness;
    const ray = new Ray();
    let checked = 0,
      deliberateGapSamples = 0;
    for (let face = 0; face < a.length / 9; face += stride) {
      if (options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      const i = face * 9;
      const ux = a[i + 3] - a[i],
        uy = a[i + 4] - a[i + 1],
        uz = a[i + 5] - a[i + 2],
        vx = a[i + 6] - a[i],
        vy = a[i + 7] - a[i + 1],
        vz = a[i + 8] - a[i + 2];
      ray.direction.set(
        uy * vz - uz * vy,
        uz * vx - ux * vz,
        ux * vy - uy * vx,
      );
      if (!ray.direction.lengthSq()) continue;
      ray.direction.normalize();
      ray.origin
        .set(
          (a[i] + a[i + 3] + a[i + 6]) / 3,
          (a[i + 1] + a[i + 4] + a[i + 7]) / 3,
          (a[i + 2] + a[i + 5] + a[i + 8]) / 3,
        )
        .addScaledVector(ray.direction, epsilon);
      checked++;
      const hit = this.tree.raycastFirst(ray, DoubleSide, 0, band);
      if (hit && hit.faceIndex !== face) {
        const hitOffset = hit.faceIndex! * 9;
        let adjacent = false;
        for (let corner = 0; corner < 3; corner++)
          for (let other = 0; other < 3; other++)
            if (
              [0, 1, 2].every(
                (axis) =>
                  a[i + corner * 3 + axis] === a[hitOffset + other * 3 + axis],
              )
            )
              adjacent = true;
        // Rays can re-enter a noisy, concave neighboring source facet. This
        // does not establish a separate captured sheet or permission to merge it.
        if (adjacent || hit.distance <= epsilon) continue;
        const hu = new Vector3(
          a[hitOffset + 3] - a[hitOffset],
          a[hitOffset + 4] - a[hitOffset + 1],
          a[hitOffset + 5] - a[hitOffset + 2],
        );
        const hv = new Vector3(
          a[hitOffset + 6] - a[hitOffset],
          a[hitOffset + 7] - a[hitOffset + 1],
          a[hitOffset + 8] - a[hitOffset + 2],
        );
        const hitNormal = hu.cross(hv).normalize();
        if (Math.abs(hitNormal.dot(ray.direction)) < 0.8) continue;
        const distance = hit.distance + epsilon;
        if (distance > gapFill + 2 * extraThickness + epsilon * 2)
          throw Error(
            `ShrinkWrap would merge a captured gap between separate sheets (${distance.toPrecision(5)} mm) outside the requested gap fill/offset; decrease sample interval or explicitly increase gap fill.`,
          );
        deliberateGapSamples++;
      }
    }
    return {
      captureGapSamples: checked,
      deliberateGapSamples,
      captureGapCheckCertified: false,
      captureGapCheckMethod:
        "stratified near-parallel source-facet rays; shared-corner facets and contacts within eight Float32 ULPs excluded",
    };
  }
  dispose() {
    this.geometry.dispose();
  }
}

export function collectShrinkwrapInputs(
  inputs: Positions[],
  options: MeshProcessingOptions,
) {
  const length = inputs.reduce((n, p) => n + p.length, 0);
  if (
    inputs.length > 33 ||
    inputs.some((p) => !p.length || p.length % 9) ||
    length > 27_000_000
  )
    throw Error(
      "Expected complete triangles within the combined three-million-triangle processing limit.",
    );
  const coordinates = new Float32Array(length);
  let offset = 0;
  for (const input of inputs) {
    for (let i = 0; i < input.length; i++) {
      if ((i & 8191) === 0 && options.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      if (!Number.isFinite(input[i]) || !Number.isFinite(Math.fround(input[i])))
        throw Error("Mesh coordinates must fit finite Float32 values.");
      coordinates[offset + i] = input[i];
    }
    offset += input.length;
  }
  return coordinates;
}
