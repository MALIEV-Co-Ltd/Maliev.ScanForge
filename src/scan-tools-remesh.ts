import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import {
  analyzeMesh,
  sheetSummary,
  type MeshProcessingOptions,
} from "./mesh-processing";
import { RECONSTRUCTION_MAX_COORDINATES } from "./scan-reconstruction-targets";
import type { Positions } from "./types";

type Options = Pick<MeshProcessingOptions, "signal" | "onProgress"> & {
  resolution?: number;
  targets?: Positions[];
};
const MAX_CELLS = 1_000_000;
const MAX_OUTPUT = RECONSTRUCTION_MAX_COORDINATES;
const corners = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
// Every cube uses the same body diagonal, including matching diagonals on shared faces.
const tetrahedra = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];
function checkpoint(o: Options, fraction: number, stage: string) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(fraction, stage);
}

/** Reconstruct a fused watertight surface from a voxel shell, filling enclosed voids.
 * Features and gaps below approximately 1.5 * resolution merge. Open scans become
 * closed thick shells; this is an offset reconstruction, not exact CAD repair.
 */
export function repolygonizeScanMesh(positions: Positions, o: Options = {}) {
  checkpoint(o, 0, "Validating reconstruction");
  const resolution = o.resolution ?? 0.5;
  if (!Number.isFinite(resolution) || resolution <= 0)
    throw new Error("Point resolution must be positive and finite.");
  if (
    !positions.length ||
    positions.length % 9 ||
    positions.length > MAX_OUTPUT
  )
    throw new Error("Expected complete triangles within the processing limit.");
  const inputs = [positions, ...(o.targets ?? [])];
  if (
    inputs.length > 33 ||
    inputs.some((p) => !p.length || p.length % 9) ||
    inputs.reduce((n, p) => n + p.length, 0) > MAX_OUTPUT
  )
    throw new Error(
      "Expected complete triangles within the combined reconstruction processing limit (up to 32 additional meshes).",
    );
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const input of inputs)
    for (let i = 0; i < input.length; i++) {
      if (i % 8192 === 0) checkpoint(o, 0, "Validating reconstruction");
      const value = input[i],
        axis = i % 3;
      if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
        throw new Error("Mesh coordinates must fit finite Float32 values.");
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  const start = min.map((v) => v - 3 * resolution);
  const dimensions = max.map(
    (v, i) => Math.ceil((v - min[i]) / resolution) + 7,
  );
  const total = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(total) || total > MAX_CELLS)
    throw new Error(
      "Reconstruction grid exceeds 1 million points; increase point resolution.",
    );
  for (let i = 0; i < 3; i++)
    if (Math.fround(start[i] + resolution) === Math.fround(start[i]))
      throw new Error(
        "Point resolution is too fine for the mesh coordinate magnitude.",
      );
  const [nx, ny, nz] = dimensions,
    slice = nx * ny;
  const occupancy = new Uint8Array(total),
    outside = new Uint8Array(total),
    queue = new Uint32Array(total);
  const geometry = new BufferGeometry();
  try {
    const combined = new Float32Array(inputs.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const input of inputs) {
      for (let i = 0; i < input.length; i += 8192) {
        checkpoint(o, 0.01, "Combining reconstruction meshes");
        combined.set(
          ArrayBuffer.isView(input)
            ? (input as Float32Array).subarray(i, i + 8192)
            : input.slice(i, i + 8192),
          offset + i,
        );
      }
      offset += input.length;
    }
    geometry.setAttribute("position", new BufferAttribute(combined, 3));
    checkpoint(o, 0.02, "Indexing scan surface");
    const tree = new MeshBVH(geometry),
      point = new Vector3(),
      shellRadius = resolution * 0.75;
    let shellPoints = 0;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const id = x + y * nx + z * slice;
          if (id % 2048 === 0)
            checkpoint(
              o,
              0.05 + (0.55 * id) / total,
              "Sampling surface distance",
            );
          point.set(
            start[0] + x * resolution,
            start[1] + y * resolution,
            start[2] + z * resolution,
          );
          const hit = tree.closestPointToPoint(
            point,
            undefined,
            0,
            shellRadius,
          );
          if (hit && hit.distance <= shellRadius) {
            occupancy[id] = 1;
            shellPoints++;
          }
        }
    if (!shellPoints)
      throw new Error("No surface samples found at this point resolution.");
    checkpoint(o, 0.6, "Closing enclosed holes and fusing regions");
    let head = 0,
      tail = 0;
    const visit = (id: number) => {
      if (!occupancy[id] && !outside[id]) {
        outside[id] = 1;
        queue[tail++] = id;
      }
    };
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++) {
        visit(y * nx + z * slice);
        visit(nx - 1 + y * nx + z * slice);
      }
    for (let z = 0; z < nz; z++)
      for (let x = 0; x < nx; x++) {
        visit(x + z * slice);
        visit(x + (ny - 1) * nx + z * slice);
      }
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        visit(x + y * nx);
        visit(x + y * nx + (nz - 1) * slice);
      }
    while (head < tail) {
      if (head % 4096 === 0)
        checkpoint(o, 0.6 + (0.1 * head) / total, "Flooding exterior");
      const id = queue[head++],
        x = id % nx,
        y = Math.floor(id / nx) % ny,
        z = Math.floor(id / slice);
      if (x > 0) visit(id - 1);
      if (x < nx - 1) visit(id + 1);
      if (y > 0) visit(id - nx);
      if (y < ny - 1) visit(id + nx);
      if (z > 0) visit(id - slice);
      if (z < nz - 1) visit(id + slice);
    }
    let filled = 0;
    for (let i = 0; i < total; i++)
      if (!outside[i] && !occupancy[i]) {
        occupancy[i] = 1;
        filled++;
      }
    const output: number[] = [];
    const emit = (a: Vector3, b: Vector3, c: Vector3, direction: Vector3) => {
      if (
        new Vector3()
          .crossVectors(b.clone().sub(a), c.clone().sub(a))
          .dot(direction) < 0
      )
        [b, c] = [c, b];
      output.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      if (output.length > MAX_OUTPUT)
        throw new Error(
          "Reconstructed mesh exceeds the triangle processing limit; increase resolution.",
        );
    };
    for (let z = 0; z < nz - 1; z++)
      for (let y = 0; y < ny - 1; y++)
        for (let x = 0; x < nx - 1; x++) {
          const id = x + y * nx + z * slice;
          if (id % 2048 === 0)
            checkpoint(
              o,
              0.7 + (0.2 * id) / total,
              "Extracting watertight surface",
            );
          const ids = corners.map(
            ([dx, dy, dz]) => id + dx + dy * nx + dz * slice,
          );
          const states = ids.map((i) => occupancy[i]);
          if (states.every((v) => v === states[0])) continue;
          const vertices = corners.map(
            ([dx, dy, dz]) =>
              new Vector3(
                start[0] + (x + dx) * resolution,
                start[1] + (y + dy) * resolution,
                start[2] + (z + dz) * resolution,
              ),
          );
          for (const tetra of tetrahedra) {
            const inside = tetra.filter((i) => states[i]),
              outsideIds = tetra.filter((i) => !states[i]);
            if (!inside.length || !outsideIds.length) continue;
            const direction = new Vector3();
            outsideIds.forEach((i) =>
              direction.addScaledVector(vertices[i], 1 / outsideIds.length),
            );
            inside.forEach((i) =>
              direction.addScaledVector(vertices[i], -1 / inside.length),
            );
            const midpoint = (a: number, b: number) =>
              vertices[a].clone().add(vertices[b]).multiplyScalar(0.5);
            if (inside.length === 1) {
              const a = inside[0];
              emit(
                midpoint(a, outsideIds[0]),
                midpoint(a, outsideIds[1]),
                midpoint(a, outsideIds[2]),
                direction,
              );
            } else if (inside.length === 3) {
              const a = outsideIds[0];
              emit(
                midpoint(a, inside[0]),
                midpoint(a, inside[1]),
                midpoint(a, inside[2]),
                direction,
              );
            } else {
              const [a, b] = inside,
                [c, d] = outsideIds,
                p = midpoint(a, c),
                q = midpoint(a, d),
                r = midpoint(b, d),
                s = midpoint(b, c);
              emit(p, q, r, direction);
              emit(p, r, s, direction);
            }
          }
        }
    const result = new Float32Array(output);
    if (!result.length || result.some((v) => !Number.isFinite(v)))
      throw new Error("Reconstruction produced invalid geometry.");
    const a = new Vector3(),
      b = new Vector3(),
      c = new Vector3();
    for (let i = 0; i < result.length; i += 9) {
      if (i % 9216 === 0)
        checkpoint(o, 0.91, "Checking reconstructed triangles");
      a.fromArray(result, i);
      b.fromArray(result, i + 3).sub(a);
      c.fromArray(result, i + 6).sub(a);
      if (new Vector3().crossVectors(b, c).lengthSq() === 0)
        throw new Error(
          "Reconstruction collapses at Float32 precision; increase point resolution or move the mesh nearer the origin.",
        );
    }
    checkpoint(o, 0.92, "Verifying reconstructed topology");
    const tolerance = Math.min(1e-6, resolution / 1000);
    const topology = sheetSummary(
      analyzeMesh(result, {
        tolerance,
        signal: o.signal,
        onProgress: (f) =>
          checkpoint(o, 0.92 + 0.08 * f, "Verifying reconstructed topology"),
      }),
    );
    if (!topology.watertight)
      throw new Error(
        "Reconstructed surface failed watertight topology verification; increase point resolution or move the mesh nearer the origin.",
      );
    checkpoint(o, 1, "Complete");
    return {
      positions: result,
      topology,
      diagnostics: {
        watertight: topology.watertight,
        inputMeshes: inputs.length,
        resolution,
        weldTolerance: tolerance,
        selfIntersectionsChecked: false,
      },
      summary: `Verified watertight voxel surface: ${topology.components} closed component${topology.components === 1 ? "" : "s"} at ${resolution} mm point resolution; ${filled} enclosed samples filled. Surface offset approximately ${shellRadius} mm. ${filled ? "Enclosed regions fused and filled." : "Open regions reconstructed as closed thick shells."}`,
    };
  } finally {
    geometry.dispose();
  }
}
