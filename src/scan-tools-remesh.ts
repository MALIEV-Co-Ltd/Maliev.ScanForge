import { samplePointReconstructionGrid } from "./scan-reconstruction-point-grid";
import type { MeshProcessingOptions } from "./mesh-processing";
import {
  admitReconstructionRecords,
  type ReconstructionInput,
} from "./scan-reconstruction-input";
import {
  sampleReconstructionGrid,
  closeReconstructionGrid,
} from "./scan-reconstruction-grid";
import { ReconstructionTopology } from "./scan-reconstruction-topology";
import {
  cubeContours,
  cubeContourSeparation,
  cubeCorners,
  cubeEdges,
} from "./scan-reconstruction-cubes";
import type { Positions } from "./types";

type Options = Pick<MeshProcessingOptions, "signal" | "onProgress"> & {
  resolution?: number;
  targets?: Positions[];
  inputKind?: ReconstructionInput["kind"];
  targetInputs?: ReconstructionInput[];
};
const MAX_CELLS = 1_000_000_000;
const MAX_OUTPUT = 16_000_000 * 9;
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
  if (o.targets !== undefined && o.targetInputs !== undefined)
    throw Error("Use only one reconstruction target representation.");
  const records: ReconstructionInput[] = [
    { kind: o.inputKind ?? "triangles", positions },
    ...(o.targetInputs ??
      (o.targets ?? []).map((positions) => ({
        kind: "triangles" as const,
        positions,
      }))),
  ];
  const admission = admitReconstructionRecords(records);
  const inputs = records.map((r) => r.positions);
  const triangles = records
    .filter((r) => r.kind === "triangles")
    .map((r) => r.positions);
  const points = records
    .filter((r) => r.kind === "points")
    .map((r) => r.positions);
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
      "Reconstruction grid exceeds 1000 million points; increase point resolution.",
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
    if (resolution * cubeContourSeparation < 4 * ulp)
      throw new Error(
        "Point resolution is too fine for the mesh coordinate magnitude; move the mesh nearer the origin.",
      );
  }
  const [nx, ny, nz] = dimensions,
    slice = nx * ny;
  const progress = (f: number, stage: string) => checkpoint(o, f, stage);
  const triangleGrid = triangles.length
    ? sampleReconstructionGrid(
        triangles,
        start,
        dimensions,
        resolution,
        points.length ? (f, stage) => progress(f * 0.5, stage) : progress,
      )
    : undefined;
  const pointGrid = points.length
    ? samplePointReconstructionGrid(
        points,
        start,
        dimensions,
        resolution,
        triangleGrid ? (f, stage) => progress(0.3 + f * 0.5, stage) : progress,
        triangleGrid,
      )
    : undefined;
  const { occupancy, shellPoints, distanceTests, candidates } = (pointGrid ??
    triangleGrid)!;
  if (pointGrid && pointGrid.representedPoints !== pointGrid.processedPoints)
    throw Error("Reconstruction did not represent every input point.");
  if (!shellPoints)
    throw new Error("No surface samples found at this point resolution.");
  const filled = closeReconstructionGrid(occupancy, dimensions, progress),
    shellRadius = resolution * 0.75;
  const window = (i: number) => {
    const shift = i & 31,
      word = i >>> 5;
    return shift
      ? ((occupancy.words[word] >>> shift) |
          (occupancy.words[word + 1] << (32 - shift))) >>>
          0
      : occupancy.words[word];
  };
  const uniformWindow = (id: number, x: number) => {
    if (x + 32 >= nx) return false;
    const a = window(id),
      b = window(id + nx),
      c = window(id + slice),
      d = window(id + slice + nx);
    if (a !== b || a !== c || a !== d || (a !== 0 && a !== 0xffffffff))
      return false;
    const last = occupancy.get(id + 32);
    return (
      last === (a & 1) &&
      occupancy.get(id + nx + 32) === last &&
      occupancy.get(id + slice + 32) === last &&
      occupancy.get(id + slice + nx + 32) === last
    );
  };
  const cellMask = (id: number) => {
    let mask = 0;
    for (let k = 0; k < 8; k++) {
      const [dx, dy, dz] = cubeCorners[k];
      mask |= occupancy.get(id + dx + dy * nx + dz * slice) << k;
    }
    return mask;
  };
  // Count the same immutable contours before allocating their one contiguous output.
  let length = 0;
  checkpoint(o, 0.7, "Counting reconstructed triangles");
  for (let z = 0; z < nz - 1; z++)
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        const id = x + y * nx + z * slice;
        if (id % 2048 === 0)
          checkpoint(
            o,
            0.7 + (0.05 * id) / total,
            "Counting reconstructed triangles",
          );
        if (uniformWindow(id, x)) {
          x += 31;
          continue;
        }
        length += cubeContours[cellMask(id)].triangles.length * 9;
        if (length > MAX_OUTPUT)
          throw Error(
            "Reconstructed mesh exceeds the sixteen-million-triangle processing limit; increase resolution.",
          );
      }
  checkpoint(o, 0.75, "Extracting watertight surface");
  const result = new Float32Array(length);
  let written = 0;
  const verification = new ReconstructionTopology();
  const actual = new Float32Array(48),
    keys = new Float64Array(16),
    expires = new Float64Array(16);
  const triangle = new Float32Array(9),
    triangleKeys = new Float64Array(3),
    triangleExpires = new Float64Array(3);
  for (let z = 0; z < nz - 1; z++)
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        const id = x + y * nx + z * slice;
        if (id % 2048 === 0)
          checkpoint(
            o,
            0.75 + (0.15 * id) / total,
            "Extracting watertight surface",
          );
        if (uniformWindow(id, x)) {
          x += 31;
          continue;
        }
        const mask = cellMask(id);
        if (mask === 0 || mask === 255) continue;
        const template = cubeContours[mask];
        verification.advance(id);
        for (let v = 0; v < template.points.length; v++) {
          const p = template.points[v];
          for (let k = 0; k < 3; k++)
            actual[v * 3 + k] = start[k] + ([x, y, z][k] + p[k]) * resolution;
          if (v < 12) {
            const [a, b] = cubeEdges[v],
              u = cubeCorners[a],
              w = cubeCorners[b],
              axis = u.findIndex((c, k) => c !== w[k]);
            const gx = x + Math.min(u[0], w[0]),
              gy = y + Math.min(u[1], w[1]),
              gz = z + Math.min(u[2], w[2]);
            keys[v] = (gx + gy * nx + gz * slice) * 3 + axis + 1;
            expires[v] =
              Math.min(gx, nx - 2) +
              Math.min(gy, ny - 2) * nx +
              Math.min(gz, nz - 2) * slice;
          } else {
            keys[v] = -(id * 4 + v - 11);
            expires[v] = id;
          }
        }
        for (const t of template.triangles) {
          for (let j = 0; j < 3; j++) {
            triangleKeys[j] = keys[t[j]];
            triangleExpires[j] = expires[t[j]];
            for (let k = 0; k < 3; k++) {
              const value = actual[t[j] * 3 + k];
              triangle[j * 3 + k] = value;
              result[written++] = value;
            }
          }
          verification.addTriangle(triangleKeys, triangleExpires, triangle);
        }
      }
  if (
    written !== length ||
    !result.length ||
    result.some((v) => !Number.isFinite(v))
  )
    throw new Error("Reconstruction produced invalid geometry.");
  checkpoint(o, 0.92, "Verifying reconstructed topology");
  const tolerance = Math.min(1e-6, resolution / 1000);
  const topology = verification.finish();
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
      inputMeshes: triangles.length,
      inputPointClouds: points.length,
      inputPoints: admission.points,
      inputTriangles: admission.triangles,
      processedPoints: pointGrid?.processedPoints ?? 0,
      representedPoints: pointGrid?.representedPoints ?? 0,
      field: "unsigned-distance-occupancy-union",
      triangleRadius: triangles.length ? shellRadius : 0,
      pointRadius: points.length ? Math.sqrt(0.75) * resolution : 0,
      resolution,
      gridPoints: total,
      distanceTests,
      samplingCandidates: candidates,
      verification: "streamed-edge-pairing-and-vertex-fans",
      extraction: "face-consistent-cube-contours",
      peakTopologyFrontierEdges: verification.peakFrontierEdges,
      weldTolerance: tolerance,
      selfIntersectionsChecked: false,
    },
    summary: `Verified watertight voxel surface: ${topology.components} closed component${topology.components === 1 ? "" : "s"} at ${resolution} mm point resolution; ${filled} enclosed samples filled. Surface offset approximately ${points.length ? Math.sqrt(0.75) * resolution : shellRadius} mm. ${filled ? "Enclosed regions fused and filled." : "Open regions reconstructed as closed thick shells."}`,
  };
}
