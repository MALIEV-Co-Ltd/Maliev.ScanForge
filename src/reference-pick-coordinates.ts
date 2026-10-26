import type { Entity, Vec3 } from "./types";
import { cloudPlacement, cloudPoseMatrix } from "./point-cloud-placement";
import { transformDatumCoordinates } from "./datum-transform-kernel";

/** Native picked-field exchange: double -> general decimal (15 digits) -> double.
 * R10 accepted QSF and R11's exact positive halfway acquisition bind this stage.
 * Keep it separate from float acquisition and the fixed-six editor initializer.
 */
export function roundTripNativePickedCoordinate(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9
  )
    throw new Error(
      "Picked coordinate requires a finite number within +/-1e9 mm.",
    );
  return value === 0 ? value : Number(value.toPrecision(15));
}

/** Structural lookup only; the shared operation owns source pickability checks. */
export function resolveReferenceCoordinatePoint(
  scene: readonly Entity[],
  entityId: string,
  pointIndex: number,
): Vec3 {
  if (!Array.isArray(scene) || typeof entityId !== "string")
    throw new Error("Invalid point-cloud source identity.");
  const identities = new Set<string>();
  let source: Entity | undefined;
  for (const entity of scene) {
    if (!entity || typeof entity.id !== "string")
      throw new Error("Invalid point-cloud source identity.");
    if (identities.has(entity.id))
      throw new Error("Duplicate point-cloud source identity.");
    identities.add(entity.id);
    if (entity.id === entityId) source = entity;
  }
  if (!source) throw new Error("Point-cloud source is missing.");
  if (source.kind !== "pointcloud")
    throw new Error("Picked coordinate source must be a point cloud.");
  // Native placed clouds expose their validated local carrier without invoking
  // the lazy world positions/normals getters. Stale inherited poses are ignored.
  const placement = cloudPlacement(source);
  const positions = placement ? placement.sourcePositions : source.positions;
  if (
    !(Array.isArray(positions) || positions instanceof Float32Array) ||
    positions.length === 0 ||
    positions.length % 3 !== 0
  )
    throw new Error("Point-cloud coordinates require complete XYZ triples.");
  if (
    !Number.isSafeInteger(pointIndex) ||
    pointIndex < 0 ||
    pointIndex >= positions.length / 3
  )
    throw new Error(
      "Point-cloud point index must be a safe integer within the source range.",
    );
  const offset = pointIndex * 3;
  const point: Vec3 = [
    positions[offset],
    positions[offset + 1],
    positions[offset + 2],
  ];
  if (
    point.some((value) => typeof value !== "number" || !Number.isFinite(value))
  )
    throw new Error("Selected point-cloud coordinates must be finite.");
  const world = placement
    ? transformDatumCoordinates(point, cloudPoseMatrix(placement.matrixBits))
    : point;
  if (world.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9))
    throw new Error("Picked world coordinates exceed +/-1e9 mm.");
  return [world[0], world[1], world[2]];
}

/** Recovered float-pick controller conversion for startup millimetres/N6 only. */
export function bakeNativeMillimetreFloatPick(
  world: readonly [number, number, number],
): Vec3 {
  if (
    !Array.isArray(world) ||
    world.length !== 3 ||
    Array.from(world).some(
      (value) =>
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9,
    )
  )
    throw new Error(
      "Picked coordinates require three finite values within +/-1e9 mm.",
    );
  const coordinate = (input: number) => {
    const value = Math.fround(input);
    const sign = value <= -(2 ** -23) ? -1 : 1;
    // The multiply, half addition, integer conversion and division are binary64.
    // The world bound keeps the truncated integer safely below 2^53 (and int64).
    const integer = Math.trunc(Math.abs(value) * 1e6 + 0.5);
    return Math.fround((integer / 1e6) * sign);
  };
  return [coordinate(world[0]), coordinate(world[1]), coordinate(world[2])];
}
