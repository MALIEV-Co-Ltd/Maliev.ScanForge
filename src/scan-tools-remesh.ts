import { Vector3 } from "three";
import type { MeshProcessingOptions } from "./mesh-processing";
import { RECONSTRUCTION_MAX_COORDINATES } from "./scan-reconstruction-targets";
import {
  sampleReconstructionGrid,
  closeReconstructionGrid,
} from "./scan-reconstruction-grid";
import { verifyReconstructionTopology } from "./scan-reconstruction-topology";
import type { Positions } from "./types";

type Options = Pick<MeshProcessingOptions, "signal" | "onProgress"> & {
  resolution?: number;
  targets?: Positions[];
};
const MAX_CELLS = 128_000_000;
const MAX_OUTPUT = 8_000_000 * 9;
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
    positions.length > RECONSTRUCTION_MAX_COORDINATES
  )
    throw new Error("Expected complete triangles within the processing limit.");
  const inputs = [positions, ...(o.targets ?? [])];
  if (
    inputs.length > 33 ||
    inputs.some((p) => !p.length || p.length % 9) ||
    inputs.reduce((n, p) => n + p.length, 0) > RECONSTRUCTION_MAX_COORDINATES
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
      "Reconstruction grid exceeds 128 million points; increase point resolution.",
    );
  for (let i = 0; i < 3; i++) {
    const magnitude = Math.max(
      Math.abs(start[i]),
      Math.abs(start[i] + dimensions[i] * resolution),
    );
    const ulp = Math.max(
      2 ** -149,
      2 ** (Math.floor(Math.log2(magnitude)) - 23),
    );
    if (resolution / 2 < 2 * ulp)
      throw new Error(
        "Point resolution is too fine for the mesh coordinate magnitude; move the mesh nearer the origin.",
      );
  }
  const [nx, ny, nz] = dimensions,
    slice = nx * ny;
  const progress = (f: number, stage: string) => checkpoint(o, f, stage);
  const { occupancy, shellPoints, distanceTests, candidates } =
    sampleReconstructionGrid(inputs, start, dimensions, resolution, progress);
  if (!shellPoints)
    throw new Error("No surface samples found at this point resolution.");
  const filled = closeReconstructionGrid(occupancy, dimensions, progress),
    shellRadius = resolution * 0.75;
  const chunks: Float32Array[] = [];
  const CHUNK = 294_912; // Complete triangles, roughly one MiB each.
  let current = new Float32Array(CHUNK),
    used = 0,
    length = 0;
  const append = (value: number) => {
    if (length === MAX_OUTPUT)
      throw new Error(
        "Reconstructed mesh exceeds the eight-million-triangle processing limit; increase resolution.",
      );
    if (used === current.length) {
      chunks.push(current);
      current = new Float32Array(CHUNK);
      used = 0;
    }
    current[used++] = value;
    length++;
  };

  const emit = (a: Vector3, b: Vector3, c: Vector3, direction: Vector3) => {
    if (
      new Vector3()
        .crossVectors(b.clone().sub(a), c.clone().sub(a))
        .dot(direction) < 0
    )
      [b, c] = [c, b];
    for (const p of [a, b, c]) {
      append(p.x);
      append(p.y);
      append(p.z);
    }
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
        const first = occupancy.get(id);
        if (
          occupancy.get(id + 1) === first &&
          occupancy.get(id + nx) === first &&
          occupancy.get(id + nx + 1) === first &&
          occupancy.get(id + slice) === first &&
          occupancy.get(id + slice + 1) === first &&
          occupancy.get(id + slice + nx) === first &&
          occupancy.get(id + slice + nx + 1) === first
        )
          continue;
        const ids = corners.map(
          ([dx, dy, dz]) => id + dx + dy * nx + dz * slice,
        );
        const states = ids.map((i) => occupancy.get(i));
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
  const result = new Float32Array(length);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    checkpoint(o, 0.905, "Collecting reconstructed triangles");
    result.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  chunks.length = 0;
  result.set(current.subarray(0, used), offset);
  current = new Float32Array(0);
  if (!result.length || result.some((v) => !Number.isFinite(v)))
    throw new Error("Reconstruction produced invalid geometry.");
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  for (let i = 0; i < result.length; i += 9) {
    if (i % 9216 === 0) checkpoint(o, 0.91, "Checking reconstructed triangles");
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
  const topology = verifyReconstructionTopology(
    result,
    start,
    dimensions,
    resolution,
    (f, stage) => checkpoint(o, 0.92 + 0.08 * f, stage),
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
      gridPoints: total,
      distanceTests,
      samplingCandidates: candidates,
      verification: "typed-edge-pairing-and-vertex-fans",
      weldTolerance: tolerance,
      selfIntersectionsChecked: false,
    },
    summary: `Verified watertight voxel surface: ${topology.components} closed component${topology.components === 1 ? "" : "s"} at ${resolution} mm point resolution; ${filled} enclosed samples filled. Surface offset approximately ${shellRadius} mm. ${filled ? "Enclosed regions fused and filled." : "Open regions reconstructed as closed thick shells."}`,
  };
}
