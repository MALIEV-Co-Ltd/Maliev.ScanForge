import type { Entity } from "./types";
import { transformDatumCoordinates } from "./datum-transform-kernel";

type Placement = NonNullable<Entity["pointCloudPlacement"]>;
type World = { positions: Float32Array; normals?: Entity["normals"] };
const nativeEntities = new WeakSet<Entity>();
const views = new WeakMap<object, Placement>();
const weakCache = new WeakMap<
  Placement,
  {
    positions: WeakRef<Float32Array>;
    normals?: WeakRef<NonNullable<Entity["normals"]>>;
  }
>();
const latest = new WeakMap<object, World>();
const selectionSources = new WeakMap<Placement, Entity["positions"]>();

/** Original cloud helper multiplies incoming * stored without Float32 intermediates. */
export function composeCloudPose(a: readonly number[], b: readonly number[]) {
  if (
    a.length !== 12 ||
    b.length !== 12 ||
    ![...a, ...b].every(Number.isFinite)
  )
    throw new Error("Cloud poses require finite 3x4 frames.");
  const out = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    const i = r * 4;
    for (let c = 0; c < 3; c++)
      out[i + c] = a[i] * b[c] + a[i + 1] * b[c + 4] + a[i + 2] * b[c + 8];
    out[i + 3] = b[3] * a[i] + b[7] * a[i + 1] + b[11] * a[i + 2] + a[i + 3];
  }
  if (!out.every(Number.isFinite)) throw new Error("Cloud pose overflow.");
  return out;
}

export function cloudPoseBits(matrix: readonly number[]) {
  if (matrix.length !== 12 || !matrix.every(Number.isFinite))
    throw new Error("Cloud pose requires twelve finite values.");
  const bytes = new Uint8Array(96),
    view = new DataView(bytes.buffer);
  matrix.forEach((value, i) => view.setFloat64(i * 8, value, true));
  return Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
}

export function cloudPoseMatrix(bits: string) {
  if (typeof bits !== "string" || !/^[0-9a-f]{192}$/i.test(bits))
    throw new Error("Invalid cloud pose encoding.");
  const bytes = Uint8Array.from(bits.match(/../g)!, (v) => parseInt(v, 16));
  const view = new DataView(bytes.buffer);
  const matrix = Array.from({ length: 12 }, (_, i) =>
    view.getFloat64(i * 8, true),
  );
  if (!matrix.every(Number.isFinite)) throw new Error("Invalid cloud pose.");
  return matrix;
}

function world(placement: Placement): World {
  const cached = weakCache.get(placement);
  const positions = cached?.positions.deref(),
    normals = cached?.normals?.deref();
  if (positions && (!placement.sourceNormals || normals))
    return { positions, normals };
  const matrix = cloudPoseMatrix(placement.matrixBits);
  const result = {
    positions: transformDatumCoordinates(placement.sourcePositions, matrix),
    normals: placement.sourceNormals
      ? Array.from(
          transformDatumCoordinates(placement.sourceNormals, matrix, true),
        )
      : undefined,
  };
  seedCloudWorld(placement, result);
  return result;
}

export function seedCloudWorld(placement: Placement, result: World) {
  views.set(result.positions, placement);
  if (result.normals) views.set(result.normals, placement);
  weakCache.set(placement, {
    positions: new WeakRef(result.positions),
    normals: result.normals ? new WeakRef(result.normals) : undefined,
  });
  // A single strong derived view per local buffer; historical poses retain only weak views.
  latest.set(placement.sourcePositions, result);
}

/** Geometry edits producing new buffers invalidate inherited placement metadata. */
export function cloudPlacement(entity: Entity): Placement | undefined {
  const p = entity.pointCloudPlacement;
  if (entity.kind !== "pointcloud" || !p) return undefined;
  if (nativeEntities.has(entity)) return p;
  if (views.get(entity.positions) !== p) return undefined;
  if (entity.normals && views.get(entity.normals) !== p) return undefined;
  if (!!entity.normals !== !!p.sourceNormals) return undefined;
  return p;
}

export function placedCloud(
  entity: Entity,
  placement: Placement,
  cached?: World,
): Entity {
  if (entity.kind !== "pointcloud")
    throw new Error("Only point clouds support a cloud pose.");
  cloudPoseMatrix(placement.matrixBits);
  if (!placement.sourcePositions.length || placement.sourcePositions.length % 3)
    throw new Error("Invalid local cloud coordinates.");
  if (
    placement.sourceNormals &&
    placement.sourceNormals.length !== placement.sourcePositions.length
  )
    throw new Error("Invalid local cloud normals.");
  const result: Entity = { ...entity, pointCloudPlacement: placement };
  if (cached) seedCloudWorld(placement, cached);
  Object.defineProperties(result, {
    positions: {
      enumerable: true,
      configurable: true,
      get: () => world(placement).positions,
    },
    normals: {
      enumerable: true,
      configurable: true,
      get: () => world(placement).normals,
    },
  });
  nativeEntities.add(result);
  return result;
}

/** Restore lazy accessors after metadata-only spreads; discard stale poses after edits. */
export function canonicalCloud(entity: Entity): Entity {
  if (!entity.pointCloudPlacement || nativeEntities.has(entity)) return entity;
  const p = cloudPlacement(entity);
  if (p)
    return placedCloud(entity, p, {
      positions: entity.positions as Float32Array,
      normals: entity.normals,
    });
  const { pointCloudPlacement: _stale, ...ordinary } = entity;
  return ordinary;
}

/** Compose native setters in order without baking world views or precomposing deltas. */
export function nextCloudPlacementStages(
  entity: Entity,
  matrices: readonly (readonly number[])[],
): Placement {
  if (
    !matrices.length ||
    matrices.length > 16 ||
    matrices.some(
      (matrix) => matrix.length !== 12 || !matrix.every(Number.isFinite),
    )
  )
    throw new Error("Cloud poses require one to 16 finite 3x4 frames.");
  const first = nextCloudPlacement(entity, matrices[0]);
  let pose = cloudPoseMatrix(first.matrixBits);
  for (let i = 1; i < matrices.length; i++)
    pose = composeCloudPose(matrices[i], pose);
  const result = { ...first, matrixBits: cloudPoseBits(pose) };
  selectionSources.set(result, selectionSources.get(first)!);
  return result;
}

export function nextCloudPlacement(
  entity: Entity,
  matrix: readonly number[],
): Placement {
  const old = cloudPlacement(entity);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const placement: Placement = {
    matrixBits: cloudPoseBits(
      composeCloudPose(
        matrix,
        old ? cloudPoseMatrix(old.matrixBits) : identity,
      ),
    ),
    sourcePositions:
      old?.sourcePositions ??
      (entity.positions instanceof Float32Array
        ? entity.positions
        : new Float32Array(entity.positions)),
    sourceNormals: old?.sourceNormals ?? entity.normals,
  };
  selectionSources.set(
    placement,
    old ? (selectionSources.get(old) ?? old.sourcePositions) : entity.positions,
  );
  return placement;
}

/** Array-to-Float32 normalization changes storage, but preserves point identities. */
export function cloudSelectionSource(entity: Entity) {
  const placement = cloudPlacement(entity);
  return placement
    ? (selectionSources.get(placement) ?? placement.sourcePositions)
    : entity.positions;
}

/** JSON retains a world-space compatibility view and restores the local representation. */
export function cloudPlacementJson(entity: Entity) {
  const p = cloudPlacement(entity);
  return p
    ? {
        matrixBits: p.matrixBits,
        sourcePositions: Array.from(p.sourcePositions),
        sourceNormals:
          p.sourceNormals instanceof Float32Array
            ? Array.from(p.sourceNormals)
            : p.sourceNormals,
      }
    : undefined;
}
