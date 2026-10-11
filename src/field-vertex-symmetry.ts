import type { FieldExclusionBits } from "./field-candidate-lists";

export interface AxisVertexSymmetry {
  /** False for empty input, before the native matching stage. */
  completed: boolean;
  partners: Int32Array;
  positiveSide: FieldExclusionBits;
  mappedVertexCount: number;
}

/** Recovered axis matcher over an explicitly supplied native vertex order. */
export function matchAxisVertexSymmetry(
  positions: Float32Array,
  axis: 0 | 1 | 2,
  planeCoordinate: number,
  tolerance: number,
  orderedVertices: Uint32Array,
): AxisVertexSymmetry {
  const f = Math.fround;
  const vertices = positions.length / 3;
  if (
    positions.length % 3 ||
    vertices > 0x7fffffff ||
    ![0, 1, 2].includes(axis) ||
    orderedVertices.length !== vertices ||
    !Number.isFinite(planeCoordinate) ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    throw new Error("Axis symmetry dimensions or settings are invalid.");
  for (const coordinate of positions)
    if (!Number.isFinite(coordinate))
      throw new Error("Axis symmetry positions must be finite.");
  const center = f(planeCoordinate);
  const radius = f(tolerance);
  const twiceCenter = f(center + center);
  const toleranceSquared = f(radius * radius);
  const earlySquared = f(toleranceSquared * f(0.000025));
  if (![center, radius, twiceCenter, toleranceSquared].every(Number.isFinite))
    throw new Error("Axis symmetry arithmetic overflow.");
  const seen = new Uint8Array(vertices);
  let previous = -Infinity;
  for (const vertex of orderedVertices) {
    if (vertex >= vertices || seen[vertex])
      throw new Error("Axis symmetry order must be a vertex permutation.");
    const coordinate = positions[vertex * 3 + axis];
    if (coordinate < previous)
      throw new Error("Axis symmetry order must be nondecreasing on its axis.");
    previous = coordinate;
    seen[vertex] = 1;
  }
  const partners = new Int32Array(vertices).fill(-1);
  const bits = new Uint8Array(Math.ceil(vertices / 8));
  let mappedVertexCount = 0;
  let cursor = vertices - 1;
  let positiveStart = -1;
  const pair = (source: number, target: number) => {
    partners[source] = target;
    if (source === target) mappedVertexCount++;
    else {
      partners[target] = source;
      mappedVertexCount += 2;
    }
  };
  for (let ordinal = 0; ordinal < vertices; ordinal++) {
    const source = orderedVertices[ordinal];
    const coordinate = positions[source * 3 + axis];
    if (coordinate > center) {
      if (positiveStart < 0) positiveStart = ordinal;
      if (partners[source] < 0) {
        if (coordinate <= f(center + radius)) pair(source, source);
        else break;
      }
    }
    if (partners[source] >= 0) continue;
    const reflected = f(twiceCenter - coordinate);
    const lower = f(reflected - radius);
    const upper = f(reflected + radius);
    if (![reflected, lower, upper].every(Number.isFinite))
      throw new Error("Axis symmetry arithmetic overflow.");
    let windowStart = -1;
    let closest = -1;
    let closestSquared = toleranceSquared;
    for (
      let candidateOrdinal = cursor;
      candidateOrdinal >= 0;
      candidateOrdinal--
    ) {
      const target = orderedVertices[candidateOrdinal];
      if (partners[target] >= 0) continue;
      const targetCoordinate = positions[target * 3 + axis];
      if (targetCoordinate > upper) continue;
      if (targetCoordinate < lower) break;
      if (windowStart < 0) windowStart = candidateOrdinal;
      const reflectedTarget = f(twiceCenter - targetCoordinate);
      const dx = f(
        positions[source * 3] -
          (axis === 0 ? reflectedTarget : positions[target * 3]),
      );
      const dy = f(
        positions[source * 3 + 1] -
          (axis === 1 ? reflectedTarget : positions[target * 3 + 1]),
      );
      const dz = f(
        positions[source * 3 + 2] -
          (axis === 2 ? reflectedTarget : positions[target * 3 + 2]),
      );
      const squared = f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
      if (!Number.isFinite(squared))
        throw new Error("Axis symmetry arithmetic overflow.");
      if (squared < earlySquared) {
        pair(source, target);
        break;
      }
      if (squared < closestSquared) {
        closestSquared = squared;
        closest = target;
      }
    }
    if (partners[source] < 0 && closest >= 0) pair(source, closest);
    if (windowStart >= 0) cursor = windowStart;
  }
  if (positiveStart >= 0)
    for (let ordinal = positiveStart; ordinal < vertices; ordinal++) {
      const vertex = orderedVertices[ordinal];
      bits[vertex >> 3] |= 1 << (vertex & 7);
    }
  return {
    completed: vertices > 0,
    partners,
    positiveSide: { bits, bitCount: vertices },
    mappedVertexCount,
  };
}
