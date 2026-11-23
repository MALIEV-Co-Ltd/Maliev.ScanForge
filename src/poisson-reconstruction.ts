import { normalizePoissonMesh } from "./poisson-mesh-cleanup";
import type { IndexedMesh, Positions } from "./types";

export const POISSON_MAX_POINTS = 500_000;
export const POISSON_MAX_VERTICES = 2_000_000;
export const POISSON_MAX_TRIANGLES = 4_000_000;
export const POISSON_MAX_HEAP_BYTES = 1024 * 1024 * 1024;
export interface PoissonInput {
  positions: Positions;
  normals: Positions;
  depth?: number;
  pointWeight?: number;
  samplesPerNode?: number;
  densityThreshold?: number;
}

/** Synchronous admission before loading or allocating the WASM engine. */
export function validatePoissonInput(input: PoissonInput) {
  const {
    positions,
    normals,
    depth = 8,
    pointWeight = 2,
    samplesPerNode = 1.5,
    densityThreshold = 0,
  } = input;
  const points = positions.length / 3;
  if (
    !Number.isSafeInteger(points) ||
    points < 3 ||
    points > POISSON_MAX_POINTS
  )
    throw Error(
      "Poisson reconstruction requires 3 to 500,000 points; reduce the cloud first.",
    );
  if (!normals || normals.length !== positions.length)
    throw Error("Poisson requires one oriented XYZ normal per point.");
  if (
    !Number.isInteger(depth) ||
    depth < 6 ||
    depth > 10 ||
    !Number.isFinite(pointWeight) ||
    pointWeight < 0 ||
    pointWeight > 100 ||
    !Number.isFinite(samplesPerNode) ||
    samplesPerNode < 0.1 ||
    samplesPerNode > 100 ||
    !Number.isFinite(densityThreshold) ||
    densityThreshold < 0 ||
    densityThreshold > 32
  )
    throw Error(
      "Invalid Poisson depth, point weight, samples per node or density threshold.",
    );
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = Math.fround(positions[i + a]);
      if (!Number.isFinite(v))
        throw Error("Poisson coordinates must be finite within Float32 range.");
      if (!Number.isFinite(normals[i + a]))
        throw Error("Poisson normals must be finite.");
      min[a] = Math.min(min[a], v);
      max[a] = Math.max(max[a], v);
    }
    if (!(Math.hypot(normals[i], normals[i + 1], normals[i + 2]) > 0))
      throw Error("Poisson normals must be nonzero and consistently oriented.");
  }
  if (!max.some((v, a) => v > min[a]))
    throw Error("Poisson requires spatially distinct points.");
  return { points, depth, pointWeight, samplesPerNode, densityThreshold };
}

interface PoissonModule {
  HEAPF32: Float32Array;
  HEAPU32: Uint32Array;
  _malloc: (bytes: number) => number;
  _free: (pointer: number) => void;
  UTF8ToString: (pointer: number) => string;
  _sf_poisson_reconstruct: (
    positions: number,
    normals: number,
    count: number,
    depth: number,
    weight: number,
    samples: number,
  ) => number;
  _sf_poisson_vertex_count: () => number;
  _sf_poisson_triangle_count: () => number;
  _sf_poisson_vertices: () => number;
  _sf_poisson_density: () => number;
  _sf_poisson_triangles: () => number;
  _sf_poisson_error: () => number;
  _sf_poisson_clear: () => void;
}
type ModuleFactory = (options: {
  print: (text: string) => void;
  printErr: (text: string) => void;
}) => Promise<PoissonModule>;

/** Own this call in a disposable processing worker; termination cancels native work. */
export async function reconstructPoisson(
  input: PoissonInput,
  progress: (fraction: number, stage: string) => void = () => {},
) {
  const options = validatePoissonInput(input);
  progress(0.05, "Loading bounded Poisson reconstruction engine");
  if (typeof location === "undefined")
    throw Error("Poisson reconstruction requires a browser processing worker.");
  // Development src/ and production assets/ workers are one level below the application root.
  const poissonModuleUrl = new URL("../poisson/poisson.mjs", location.href)
    .href;
  const { default: createModule } = (await import(
    /* @vite-ignore */ poissonModuleUrl
  )) as {
    default: ModuleFactory;
  };
  const warnings: string[] = [];
  const module = await createModule({
    print: () => {},
    printErr: (text) => {
      if (warnings.length < 8) warnings.push(text);
    },
  });
  let positionsPointer = 0,
    normalsPointer = 0;
  try {
    const bytes = input.positions.length * 4;
    positionsPointer = module._malloc(bytes);
    normalsPointer = module._malloc(bytes);
    if (!positionsPointer || !normalsPointer)
      throw Error("Poisson input exceeds its one GiB WASM heap.");
    module.HEAPF32.set(input.positions, positionsPointer / 4);
    for (let i = 0; i < input.normals.length; i += 3) {
      const length = Math.hypot(
        input.normals[i],
        input.normals[i + 1],
        input.normals[i + 2],
      );
      for (let a = 0; a < 3; a++)
        module.HEAPF32[normalsPointer / 4 + i + a] =
          input.normals[i + a] / length;
    }
    progress(0.15, "Solving general 3D screened Poisson surface");
    const solved = module._sf_poisson_reconstruct(
      positionsPointer,
      normalsPointer,
      options.points,
      options.depth,
      options.pointWeight,
      options.samplesPerNode,
    );
    if (!solved)
      throw Error(
        module.UTF8ToString(module._sf_poisson_error()) ||
          "Poisson reconstruction failed.",
      );
    progress(0.8, "Validating Poisson mesh and density");
    const vertexCount = module._sf_poisson_vertex_count(),
      triangleCount = module._sf_poisson_triangle_count();
    if (
      !Number.isSafeInteger(vertexCount) ||
      vertexCount < 3 ||
      vertexCount > POISSON_MAX_VERTICES ||
      !Number.isSafeInteger(triangleCount) ||
      triangleCount < 1 ||
      triangleCount > POISSON_MAX_TRIANGLES
    )
      throw Error("Poisson output exceeds its bounded mesh limits.");
    let vertices = module.HEAPF32.slice(
      module._sf_poisson_vertices() / 4,
      module._sf_poisson_vertices() / 4 + vertexCount * 3,
    );
    let density = module.HEAPF32.slice(
      module._sf_poisson_density() / 4,
      module._sf_poisson_density() / 4 + vertexCount,
    );
    let triangles = module.HEAPU32.slice(
      module._sf_poisson_triangles() / 4,
      module._sf_poisson_triangles() / 4 + triangleCount * 3,
    );
    const sortedDensity = density.slice().sort();
    const normalized = normalizePoissonMesh(
      vertices,
      triangles,
      density,
      options.densityThreshold,
    );
    ({ vertices, triangles, density } = normalized);
    const output = new Float32Array(triangles.length * 3);
    for (let i = 0; i < triangles.length; i++)
      output.set(
        vertices.subarray(triangles[i] * 3, triangles[i] * 3 + 3),
        i * 3,
      );
    const indexedMesh: IndexedMesh = { vertices, triangles };
    progress(1, "General 3D Poisson reconstruction complete");
    return {
      positions: output,
      indexedMesh,
      density,
      diagnostics: {
        algorithm: "upstream-screened-poisson-18.76",
        engineCommit: "262b0f539d404057d1f36e1adc07fc9388678899",
        sourcePoints: options.points,
        depth: options.depth,
        pointWeight: options.pointWeight,
        samplesPerNode: options.samplesPerNode,
        densityThreshold: options.densityThreshold,
        femDegree: 2,
        boundary: "Neumann",
        scale: 1.1,
        threads: 1,
        vertices: vertices.length / 3,
        triangles: triangles.length / 3,
        untrimmedVertices: vertexCount,
        untrimmedTriangles: triangleCount,
        trimmedTriangles: normalized.trimmedTriangles,
        mergedVertices: normalized.mergedVertices,
        removedDegenerateTriangles: normalized.removedDegenerateTriangles,
        removedDuplicateTriangles: normalized.removedDuplicateTriangles,
        densityMinimum: sortedDensity[0],
        densityMedian: sortedDensity[Math.floor(sortedDensity.length / 2)],
        densityP95:
          sortedDensity[
            Math.min(
              sortedDensity.length - 1,
              Math.floor(sortedDensity.length * 0.95),
            )
          ],
        densityMaximum: sortedDensity.at(-1)!,
        wasmHeapBytes: module.HEAPF32.buffer.byteLength,
        warnings: warnings.join("\n"),
        summary: `Created ${triangles.length / 3} general 3D Poisson triangles; source cloud preserved.`,
      },
    };
  } finally {
    if (positionsPointer) module._free(positionsPointer);
    if (normalsPointer) module._free(normalsPointer);
    module._sf_poisson_clear();
  }
}
