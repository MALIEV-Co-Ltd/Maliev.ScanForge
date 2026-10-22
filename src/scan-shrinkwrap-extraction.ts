import { fitShrinkwrapContour } from "./scan-shrinkwrap-contours";
import type { MeshProcessingOptions } from "./mesh-processing";
import {
  sampleShrinkwrapGrid,
  closeReconstructionGrid,
} from "./scan-shrinkwrap-grid";
import { ReconstructionTopology } from "./scan-reconstruction-topology";
import {
  cubeContours,
  cubeContourSeparation,
  cubeCorners,
  cubeEdges,
} from "./scan-reconstruction-cubes";
import type { Positions } from "./types";

const RECONSTRUCTION_MAX_COORDINATES = 27_000_000;

type Options = Pick<MeshProcessingOptions, "signal" | "onProgress"> & {
  resolution?: number;
  gapFill: number;
  radius?: number;
  insideNode?: (point: number[]) => boolean;
  scalarValue?: (point: number[]) => number;
  transform: (
    key: number,
    expires: number,
    point: number[],
  ) => {
    point: number[];
    supported: boolean;
    normal?: number[];
    region?: number;
  };
  advance: (cell: number) => void;
  targets?: Positions[];
};
const MAX_CELLS = 1_000_000_000;
const MAX_OUTPUT = 16_000_000 * 9;
function checkpoint(o: Options, fraction: number, stage: string) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(fraction, stage);
}

/** Bounded capsule rasterization, optional oriented-node clipping, enclosed-void
 * closure, and shared-edge scalar extraction with streamed topology verification. */
export function extractShrinkwrapScaffold(positions: Positions, o: Options) {
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
  const padding = 3 * resolution + 2 * (o.radius ?? o.gapFill);
  const start = min.map((v) => v - padding);
  const dimensions = max.map(
    (v, i) => Math.ceil((v - min[i] + 2 * padding) / resolution) + 1,
  );
  const total = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(total) || total > MAX_CELLS)
    throw new Error(
      "Reconstruction grid exceeds 1000 million points; increase point resolution.",
    );
  let maximumUlp = 0;
  for (let i = 0; i < 3; i++) {
    const magnitude = Math.max(
      Math.abs(start[i]),
      Math.abs(start[i] + dimensions[i] * resolution),
    );
    const ulp = Math.max(
      2 ** -149,
      2 ** (Math.floor(Math.log2(magnitude)) - 23),
    );
    maximumUlp = Math.max(maximumUlp, ulp);
    if (resolution * cubeContourSeparation < 4 * ulp)
      throw new Error(
        "Point resolution is too fine for the mesh coordinate magnitude; move the mesh nearer the origin.",
      );
  }
  const rootEpsilon = Math.max(0.001, (8 * maximumUlp) / resolution);
  if (o.scalarValue && rootEpsilon > 0.05)
    throw Error(
      "ShrinkWrap edge roots exceed Float32 precision; move the mesh nearer the origin.",
    );
  const [nx, ny, nz] = dimensions,
    slice = nx * ny;
  const progress = (f: number, stage: string) => checkpoint(o, f, stage);
  const { occupancy, shellPoints, distanceTests, candidates } =
    sampleShrinkwrapGrid(
      inputs,
      start,
      dimensions,
      resolution,
      o.radius ?? resolution * 0.75 + o.gapFill / 2,
      progress,
    );
  if (!shellPoints)
    throw new Error("No surface samples found at this point resolution.");
  let clippedPoints = 0;
  if (o.insideNode)
    for (let word = 0; word < occupancy.words.length; word++) {
      if (word % 8192 === 0)
        checkpoint(o, 0.6, "Clipping captured source fronts");
      let remaining = occupancy.words[word];
      while (remaining) {
        const bit = 31 - Math.clz32(remaining & -remaining),
          index = word * 32 + bit;
        remaining = (remaining & (remaining - 1)) >>> 0;
        const point = [
          start[0] + (index % nx) * resolution,
          start[1] + (Math.floor(index / nx) % ny) * resolution,
          start[2] + Math.floor(index / slice) * resolution,
        ];
        if (!o.insideNode(point)) {
          occupancy.words[word] &= ~(1 << bit);
          clippedPoints++;
        }
      }
    }
  const filled = closeReconstructionGrid(occupancy, dimensions, progress),
    shellRadius = resolution * 0.75;
  // Two slice caches bound scalar storage independently of total grid volume.
  if (slice > 8_000_000)
    throw Error(
      "ShrinkWrap scalar frontier exceeds bounded memory; split the mesh.",
    );
  const scalarPlanes = [
    new Float64Array(slice).fill(NaN),
    new Float64Array(slice).fill(NaN),
  ];
  let scalarQueries = 0,
    cacheZ = -1;
  const scalar = (gx: number, gy: number, gz: number) => {
    const index = gx + gy * nx,
      cache = scalarPlanes[gz & 1];
    if (Number.isNaN(cache[index])) {
      const raw = o.scalarValue!([
        start[0] + gx * resolution,
        start[1] + gy * resolution,
        start[2] + gz * resolution,
      ]);
      scalarQueries++;
      // Flood-filled enclosed voids remain interior; the exterior continuous zero is unchanged.
      cache[index] =
        (occupancy.get(index + gz * slice) ? -1 : 1) *
        Math.max(Math.abs(raw), resolution * 1e-12);
    }
    return cache[index];
  };
  const chunks: Float32Array[] = [];
  const CHUNK = 294_912; // Complete triangles, roughly one MiB each.
  let current = new Float32Array(CHUNK),
    used = 0,
    length = 0;
  const append = (value: number) => {
    if (length === MAX_OUTPUT)
      throw new Error(
        "Reconstructed mesh exceeds the sixteen-million-triangle processing limit; increase resolution.",
      );
    if (used === current.length) {
      chunks.push(current);
      current = new Float32Array(CHUNK);
      used = 0;
    }
    current[used++] = value;
    length++;
  };

  const verification = new ReconstructionTopology();
  const original = new Float32Array(48);
  const actual = new Float32Array(48),
    keys = new Float64Array(16),
    expires = new Float64Array(16);
  const support = new Uint8Array(16);
  const orientation = {
    normals: new Float32Array(48),
    regions: new Int8Array(16),
  };
  let supportedTriangles = 0,
    generatedTriangles = 0;
  const triangle = new Float32Array(9),
    triangleKeys = new Float64Array(3),
    triangleExpires = new Float64Array(3);
  const window = (i: number) => {
    const shift = i & 31,
      word = i >>> 5;
    return shift
      ? ((occupancy.words[word] >>> shift) |
          (occupancy.words[word + 1] << (32 - shift))) >>>
          0
      : occupancy.words[word];
  };
  for (let z = 0; z < nz - 1; z++)
    for (let y = 0; y < ny - 1; y++)
      for (let x = 0; x < nx - 1; x++) {
        const id = x + y * nx + z * slice;
        if (cacheZ !== z) {
          scalarPlanes[(z + 1) & 1].fill(NaN);
          cacheZ = z;
        }
        if (id % 2048 === 0)
          checkpoint(
            o,
            0.7 + (0.2 * id) / total,
            "Extracting watertight surface",
          );
        if (x + 32 < nx) {
          const a = window(id),
            b = window(id + nx),
            c = window(id + slice),
            d = window(id + slice + nx);
          if (a === b && a === c && a === d && (a === 0 || a === 0xffffffff)) {
            const last = occupancy.get(id + 32);
            if (
              last === (a & 1) &&
              occupancy.get(id + nx + 32) === last &&
              occupancy.get(id + slice + 32) === last &&
              occupancy.get(id + slice + nx + 32) === last
            ) {
              x += 31;
              continue;
            }
          }
        }
        let mask = 0;
        for (let k = 0; k < 8; k++) {
          const [dx, dy, dz] = cubeCorners[k];
          mask |= occupancy.get(id + dx + dy * nx + dz * slice) << k;
        }
        if (mask === 0 || mask === 255) continue;
        const template = cubeContours[mask];
        verification.advance(id);
        o.advance(id);
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
        original.set(actual);
        if (o.scalarValue) {
          const usedVertices = new Set(template.triangles.flat());
          for (const v of usedVertices) {
            if (v >= 12) continue;
            const [a, b] = cubeEdges[v],
              u = cubeCorners[a],
              w = cubeCorners[b];
            const fa = scalar(x + u[0], y + u[1], z + u[2]),
              fb = scalar(x + w[0], y + w[1], z + w[2]);
            // Interior edge roots avoid Float32 aliases at exact-zero grid corners.
            const epsilon = rootEpsilon;
            const t = Math.max(epsilon, Math.min(1 - epsilon, fa / (fa - fb)));
            for (let axis = 0; axis < 3; axis++)
              actual[v * 3 + axis] =
                start[axis] +
                ([x, y, z][axis] + u[axis] + t * (w[axis] - u[axis])) *
                  resolution;
          }
          for (const v of usedVertices) {
            if (v < 12) continue;
            const neighbors = new Set<number>();
            for (const t of template.triangles)
              if (t.includes(v))
                for (const q of t) if (q !== v) neighbors.add(q);
            for (let axis = 0; axis < 3; axis++)
              actual[v * 3 + axis] =
                Array.from(neighbors).reduce(
                  (sum, q) => sum + actual[q * 3 + axis],
                  0,
                ) / neighbors.size;
          }
        }

        let hasOrientation = true;
        for (const v of new Set(template.triangles.flat())) {
          const point = [actual[v * 3], actual[v * 3 + 1], actual[v * 3 + 2]];
          const fitted = o.transform(keys[v], expires[v], point);
          actual.set(fitted.point, v * 3);
          support[v] = fitted.supported ? 1 : 0;
          if (fitted.normal) orientation.normals.set(fitted.normal, v * 3);
          else hasOrientation = false;
          orientation.regions[v] = fitted.region ?? 0;
        }
        const fittedTriangles = fitShrinkwrapContour(
          template.triangles,
          original,
          actual,
          [x, y, z].map((c, axis) => [
            start[axis] + c * resolution,
            start[axis] + (c + 1) * resolution,
          ]),
          hasOrientation ? orientation : undefined,
        );
        for (const t of fittedTriangles) {
          if (t.every((v) => support[v])) supportedTriangles++;
          else generatedTriangles++;
          for (let j = 0; j < 3; j++) {
            triangleKeys[j] = keys[t[j]];
            triangleExpires[j] = expires[t[j]];
            for (let k = 0; k < 3; k++) {
              const value = actual[t[j] * 3 + k];
              triangle[j * 3 + k] = value;
              append(value);
            }
          }
          verification.addTriangle(triangleKeys, triangleExpires, triangle);
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
    throw new Error(
      "ShrinkWrap produced no resolvable surface or invalid geometry; decrease sample interval to resolve captured thin walls.",
    );
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
      supportedTriangles,
      generatedTriangles,
      inputMeshes: inputs.length,
      resolution,
      gridPoints: total,
      distanceTests,
      samplingCandidates: candidates,
      interpolationClampDistance: rootEpsilon * resolution,
      clippedPoints,
      scalarQueries,
      scalarCacheBytes: scalarPlanes[0].byteLength * 2,
      verification: "streamed-edge-pairing-and-vertex-fans",
      extraction: "face-consistent-cube-contours",
      peakTopologyFrontierEdges: verification.peakFrontierEdges,
      weldTolerance: tolerance,
      selfIntersectionsChecked: false,
    },
    summary: `Verified watertight reconstructed surface: ${topology.components} closed component${topology.components === 1 ? "" : "s"} at ${resolution} mm point resolution; ${filled} enclosed samples filled. Surface offset approximately ${shellRadius} mm. ${filled ? "Enclosed regions fused and filled." : "Open regions reconstructed as closed thick shells."}`,
  };
}
