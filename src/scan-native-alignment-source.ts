import type { MeshProcessingOptions } from "./mesh-processing";
import { noiseNormals } from "./scan-native-noise";
import {
  createNativeAlignmentSamplingState,
  nativeSampleAlignmentVertices,
} from "./scan-native-alignment-sample";
import type { AlignmentQueryVertex } from "./scan-native-alignment-query";

/** Prepare one native source mesh. The enclosing constructor owns cross-mesh sampling lifetime. */
export function prepareNativeAlignmentSource(
  mesh: {
    vertices: ArrayLike<number>;
    triangles: ArrayLike<number>;
    flags?: ArrayLike<number>;
    normals?: ArrayLike<number>;
  },
  sampleBudget: number,
  options: MeshProcessingOptions & {
    selectionOnly?: boolean;
    samplingState?: ReturnType<typeof createNativeAlignmentSamplingState>;
  } = {},
) {
  if (options.signal?.aborted)
    throw new DOMException("Alignment preparation cancelled.", "AbortError");
  const count = mesh.vertices.length / 3;
  if (
    !Number.isInteger(count) ||
    mesh.triangles.length % 3 ||
    (mesh.flags && mesh.flags.length !== count) ||
    (mesh.normals && mesh.normals.length !== mesh.vertices.length)
  )
    throw new Error("Invalid alignment source buffers.");
  const coordinates = Float64Array.from(mesh.vertices, Math.fround);
  if (!coordinates.every(Number.isFinite))
    throw new Error("Alignment source requires finite Float32 coordinates.");
  for (let offset = 0; offset < mesh.triangles.length; offset++) {
    const id = mesh.triangles[offset];
    if (!Number.isSafeInteger(id) || id < 0 || id >= count)
      throw new Error("Alignment source triangle index is outside the buffer.");
  }
  const normals = mesh.normals
    ? Float32Array.from(mesh.normals)
    : noiseNormals(
        { vertices: coordinates, triangles: Uint32Array.from(mesh.triangles) },
        options,
      );
  if (!normals.every(Number.isFinite))
    throw new Error("Alignment source normals require finite Float32 values.");
  const vertices: AlignmentQueryVertex[] = Array.from(
    { length: count },
    (_, id) => {
      const flag = mesh.flags?.[id] ?? 0;
      if (!Number.isSafeInteger(flag) || flag < 0 || flag > 0xffffffff)
        throw new Error("Alignment source flags must be unsigned integers.");
      const offset = id * 3;
      return {
        point: [
          coordinates[offset],
          coordinates[offset + 1],
          coordinates[offset + 2],
        ],
        normal: [normals[offset], normals[offset + 1], normals[offset + 2]],
        flags: options.selectionOnly ? flag : (flag | 4) >>> 0,
      };
    },
  );
  // Selection-only mode skips native sampling entirely, regardless of its budget.
  const sampling = options.selectionOnly
    ? {
        flags: vertices.map((vertex) => vertex.flags),
        levelCounts: [] as number[],
        nodes: 0,
      }
    : nativeSampleAlignmentVertices(vertices, sampleBudget, {
        signal: options.signal,
        state: options.samplingState,
      });
  for (let id = 0; id < count; id++) vertices[id].flags = sampling.flags[id];
  return { vertices, normals, sampling };
}

/** Prepare all source meshes with the constructor's shared sampling lifetime. */
export function prepareNativeAlignmentSources(
  meshes: readonly Parameters<typeof prepareNativeAlignmentSource>[0][],
  sampleBudget: number,
  options: MeshProcessingOptions & { selectionOnly?: boolean } = {},
) {
  const samplingState = createNativeAlignmentSamplingState();
  const results = meshes.map((mesh) =>
    prepareNativeAlignmentSource(mesh, sampleBudget, {
      ...options,
      samplingState,
    }),
  );
  // Later sampling calls may revisit nodes belonging to earlier source meshes.
  for (const result of results)
    for (let id = 0; id < result.vertices.length; id++)
      result.vertices[id].flags = result.sampling.flags[id];
  return results;
}

export function prepareNativeAlignmentSelectedSource(
  mesh: Parameters<typeof prepareNativeAlignmentSource>[0],
  options: MeshProcessingOptions = {},
): { vertices: AlignmentQueryVertex[] } {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Alignment preparation cancelled.", "AbortError");
  };
  check();
  const count = mesh.vertices.length / 3;
  if (
    !Number.isInteger(count) ||
    mesh.triangles.length % 3 ||
    (mesh.flags && mesh.flags.length !== count) ||
    (mesh.normals && mesh.normals.length !== mesh.vertices.length)
  )
    throw new Error("Invalid alignment source buffers.");
  // Validate even inactive records. With supplied scanner normals, no full-size
  // coordinate/normal copy or sampling records are needed for this path.
  for (let offset = 0; offset < mesh.vertices.length; offset++) {
    if (!(offset % 4096)) check();
    if (!Number.isFinite(Math.fround(mesh.vertices[offset])))
      throw new Error("Alignment source requires finite Float32 coordinates.");
  }
  for (let offset = 0; offset < mesh.triangles.length; offset++) {
    if (!(offset % 4096)) check();
    const id = mesh.triangles[offset];
    if (!Number.isSafeInteger(id) || id < 0 || id >= count)
      throw new Error("Alignment source triangle index is outside the buffer.");
  }
  const normals =
    mesh.normals ??
    noiseNormals(
      {
        vertices: Float64Array.from(mesh.vertices, Math.fround),
        triangles: Uint32Array.from(mesh.triangles),
      },
      options,
    );
  const vertices: AlignmentQueryVertex[] = [];
  for (let id = 0; id < count; id++) {
    if (!(id % 4096)) check();
    const offset = id * 3,
      flag = mesh.flags?.[id] ?? 0;
    if (!Number.isSafeInteger(flag) || flag < 0 || flag > 0xffffffff)
      throw new Error("Alignment source flags must be unsigned integers.");
    const nx = Math.fround(normals[offset]),
      ny = Math.fround(normals[offset + 1]),
      nz = Math.fround(normals[offset + 2]);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz))
      throw new Error(
        "Alignment source normals require finite Float32 values.",
      );
    if ((flag & 5) === 4)
      vertices.push({
        point: [
          Math.fround(mesh.vertices[offset]),
          Math.fround(mesh.vertices[offset + 1]),
          Math.fround(mesh.vertices[offset + 2]),
        ],
        normal: [nx, ny, nz],
        flags: flag,
      });
  }
  check();
  return { vertices };
}
