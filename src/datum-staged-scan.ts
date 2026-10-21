import { yieldScanTask } from "./scan-task";
import type { Entity, IndexedMesh, Positions } from "./types";
import { datumFeatureMetadata } from "./scan-native-datum-primitive";
import { cacheScanRenderData, prepareScanRenderData } from "./scan-render-data";
import {
  cloudPoseMatrix,
  nextCloudPlacementStages,
  placedCloud,
} from "./point-cloud-placement";
const CHUNK = 65536;
async function visit(
  length: number,
  fn: (first: number, end: number) => boolean,
  check: () => void,
) {
  for (let first = 0; first < length; first += CHUNK) {
    check();
    if (!fn(first, Math.min(length, first + CHUNK))) return false;
    if (first + CHUNK < length) await yieldScanTask();
  }
  check();
  return true;
}
/** Same indexed/render identity contract as indexedMeshMatches, with bounded UI tasks. */
async function indexedScan(
  entity: Entity,
  check: () => void,
): Promise<IndexedMesh | undefined> {
  const indexed = entity.indexedMesh;
  if (!indexed || entity.kind !== "mesh") return undefined;
  const { vertices, triangles, normals } = indexed;
  if (
    !(Array.isArray(vertices) || vertices instanceof Float32Array) ||
    !(Array.isArray(triangles) || triangles instanceof Uint32Array) ||
    !vertices.length ||
    vertices.length % 3 ||
    !triangles.length ||
    triangles.length % 3 ||
    triangles.length * 3 !== entity.positions.length ||
    (normals !== undefined &&
      (!(Array.isArray(normals) || normals instanceof Float32Array) ||
        normals.length !== vertices.length))
  )
    return undefined;
  const finite = async (values: Positions) =>
    visit(
      values.length,
      (first, end) => {
        for (let i = first; i < end; i++)
          if (!Number.isFinite(values[i])) return false;
        return true;
      },
      check,
    );
  if (!(await finite(vertices)) || (normals && !(await finite(normals))))
    return undefined;
  const matches = await visit(
    triangles.length,
    (first, end) => {
      for (let slot = first; slot < end; slot++) {
        const id = triangles[slot];
        if (!Number.isSafeInteger(id) || id < 0 || id * 3 >= vertices.length)
          return false;
        for (let axis = 0; axis < 3; axis++)
          if (vertices[id * 3 + axis] !== entity.positions[slot * 3 + axis])
            return false;
      }
      return true;
    },
    check,
  );
  return matches ? indexed : undefined;
}
async function normalArray(input: Float32Array, check: () => void) {
  const result = new Array<number>(input.length);
  await visit(
    input.length,
    (first, end) => {
      for (let i = first; i < end; i++) result[i] = input[i];
      return true;
    },
    check,
  );
  return result;
}
interface TransformResult {
  output: Float32Array;
  bounds: { min: number[]; max: number[] };
  execution: {
    physicalWorkers: number;
    chunkVertices: number;
    fallbackReason: string | undefined;
  };
}
type Transform = (
  input: Positions,
  matrices: readonly (readonly number[])[],
  vector?: boolean,
) => Promise<TransformResult>;
/** Geometry remains private until every stream and metadata stage succeeds. */
export async function transformDatumScanStages(
  entity: Entity,
  matrices: readonly (readonly number[])[],
  transform: Transform,
  check: () => void,
  options: { typedNormals?: boolean } = {},
) {
  check();
  if (
    !matrices.length ||
    matrices.length > 16 ||
    matrices.some((m) => m.length !== 12 || !m.every(Number.isFinite))
  )
    throw new Error(
      "Alignment transform requires one to 16 finite 3x4 matrices.",
    );
  const frames = matrices.map((m) => Array.from(m));
  if (!entity.positions.length)
    throw new Error("An empty scan cannot be aligned.");
  if (entity.locked) throw new Error("Unlock the scan before aligning it.");
  if (
    entity.kernelId ||
    entity.parametric ||
    !["mesh", "pointcloud"].includes(entity.kind)
  )
    throw new Error(
      "Coordinate scan alignment requires a mesh or point cloud; exact CAD targets are not supported yet.",
    );
  let metadata = { fit: entity.fit, planeFrame: entity.planeFrame };
  for (const frame of frames) metadata = datumFeatureMetadata(metadata, frame);
  const indexed = await indexedScan(entity, check);
  const placement =
    entity.kind === "pointcloud"
      ? nextCloudPlacementStages(entity, frames)
      : undefined;
  const coordinateFrames = placement
    ? [cloudPoseMatrix(placement.matrixBits)]
    : frames;
  const positions = await transform(
    placement?.sourcePositions ?? entity.positions,
    coordinateFrames,
  );
  const vertices = indexed
    ? await transform(indexed.vertices, frames)
    : undefined;
  const indexedNormals = indexed?.normals
    ? await transform(indexed.normals, frames, true)
    : undefined;
  const sourceNormals = placement ? placement.sourceNormals : entity.normals;
  const normals = sourceNormals
    ? await transform(sourceNormals, coordinateFrames, true)
    : undefined;
  const normalValues = normals
    ? options.typedNormals
      ? normals.output
      : await normalArray(normals.output, check)
    : undefined;
  check();
  const output: Entity = {
    ...entity,
    positions: positions.output,
    normals: normalValues,
    indexedMesh: indexed
      ? {
          vertices: vertices!.output,
          triangles: indexed.triangles,
          ...(indexedNormals ? { normals: indexedNormals.output } : {}),
        }
      : undefined,
    edgePositions: undefined,
    surfacePatch: undefined,
    surfaceScanId: undefined,
    ...metadata,
  };
  if (output.kind === "mesh" && output.indexedMesh) {
    await yieldScanTask();
    check();
    const renderData = prepareScanRenderData(
      positions.output,
      output.indexedMesh,
    );
    check();
    cacheScanRenderData(output.positions, renderData);
  }
  return {
    entity: placement
      ? placedCloud(output, placement, {
          positions: positions.output,
          normals: normalValues,
        })
      : output,
    bounds: positions.bounds,
    execution: {
      ...positions.execution,
      ...(placement
        ? { localBuffersRetained: true, poseBits: placement.matrixBits }
        : {}),
    },
  };
}
