import type { Positions } from "./types";
import { reindexPointColors, validatePointColors } from "./point-cloud-colors";

export interface PointCloudEditRequest {
  kind: "pointCloudEdit";
  positions: Positions;
  normals?: Positions;
  pointColors?: Uint8Array;
  selection?: Uint8Array;
  action:
    | "delete"
    | "extract"
    | "voxel"
    | "sampleCount"
    | "smooth"
    | "connectedSelection"
    | "grow"
    | "shrink";
  cellSize?: number;
  targetPoints?: number;
  neighborRadius?: number;
  iterations?: number;
  strength?: number;
  deviation?: number;
}

export interface PointCloudEditResult {
  positions?: Float32Array;
  normals?: Float32Array;
  pointColors?: Uint8Array;
  /** Original point slots retained by deletion, extraction and sampling. */
  sourceIndices?: Uint32Array;
  selection?: Uint8Array;
  diagnostics: Record<string, number | string | boolean>;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be positive and finite.`);
  return value;
}

/** Point masks index XYZ samples, never triangle facets. Runs inside the processing worker. */
export function editPointCloud(
  request: PointCloudEditRequest,
  progress: (fraction: number, stage: string) => void = () => {},
): PointCloudEditResult {
  const { positions, normals, selection, action } = request;
  const count = positions.length / 3;
  if (!Number.isInteger(count) || count === 0)
    throw new Error("Point cloud must contain XYZ samples.");
  validatePointColors(request.pointColors, count);
  if (positions.some((value) => !Number.isFinite(value)))
    throw new Error("Point coordinates must be finite.");
  if (
    normals &&
    (normals.length !== positions.length ||
      normals.some((value) => !Number.isFinite(value)))
  )
    throw new Error("Point normals must match the XYZ samples and be finite.");
  if (selection && selection.length !== count)
    throw new Error("Point selection must have one slot per point.");
  const selected = (index: number) => !!selection?.[index];
  const selectedCount =
    selection?.reduce((sum, value) => sum + (value ? 1 : 0), 0) ?? 0;
  const candidate = (index: number) => !selectedCount || selected(index);
  const diagnostics: PointCloudEditResult["diagnostics"] = {
    sourcePoints: count,
    selectedPoints: selectedCount,
    algorithm: `point-cloud-${action}`,
  };
  const retain = (indices: number[]): PointCloudEditResult => {
    const sourceIndices = Uint32Array.from(indices);
    const output = new Float32Array(indices.length * 3);
    const outputNormals = normals ? new Float32Array(output.length) : undefined;
    indices.forEach((source, index) => {
      for (let axis = 0; axis < 3; axis++) {
        output[index * 3 + axis] = positions[source * 3 + axis];
        if (outputNormals)
          outputNormals[index * 3 + axis] = normals![source * 3 + axis];
      }
    });
    progress(1, "Point cloud editing completed");
    return {
      positions: output,
      normals: outputNormals,
      sourceIndices,
      ...(request.pointColors
        ? {
            pointColors: reindexPointColors(
              request.pointColors,
              sourceIndices,
              count,
            ),
          }
        : {}),
      diagnostics: {
        ...diagnostics,
        points: indices.length,
        removedPoints: count - indices.length,
      },
    };
  };
  if (action === "delete" || action === "extract") {
    if (!selectedCount) throw new Error("Select points first.");
    return retain(
      Array.from({ length: count }, (_, index) => index).filter((index) =>
        action === "delete" ? !selected(index) : selected(index),
      ),
    );
  }
  if (action === "voxel" || action === "sampleCount") {
    const candidates: number[] = [],
      fixed: number[] = [];
    for (let index = 0; index < count; index++)
      (candidate(index) ? candidates : fixed).push(index);
    let kept: number[];
    if (action === "voxel") {
      const cellSize = positive(request.cellSize ?? 0.5, "Point resolution");
      const cells = new Set<string>();
      kept = candidates.filter((index) => {
        const offset = index * 3;
        const key = `${Math.floor(positions[offset] / cellSize)},${Math.floor(positions[offset + 1] / cellSize)},${Math.floor(positions[offset + 2] / cellSize)}`;
        if (cells.has(key)) return false;
        cells.add(key);
        return true;
      });
      diagnostics.cellSize = cellSize;
    } else {
      const target = request.targetPoints ?? Math.ceil(candidates.length / 2);
      if (!Number.isInteger(target) || target < 1 || target > candidates.length)
        throw new Error(
          "Target points must be an integer between 1 and the editable point count.",
        );
      kept = Array.from(
        { length: target },
        (_, index) =>
          candidates[Math.floor((index * candidates.length) / target)],
      );
      diagnostics.targetPoints = target;
    }
    return retain([...fixed, ...kept].sort((a, b) => a - b));
  }
  const radius = positive(request.neighborRadius ?? 0.5, "Neighbor radius");
  const radiusSquared = radius * radius;
  const hash = (values: Positions) => {
    const cells = new Map<string, number[]>();
    for (let index = 0; index < count; index++) {
      const offset = index * 3;
      const key = `${Math.floor(values[offset] / radius)},${Math.floor(values[offset + 1] / radius)},${Math.floor(values[offset + 2] / radius)}`;
      const cell = cells.get(key);
      if (cell) cell.push(index);
      else cells.set(key, [index]);
    }
    return cells;
  };
  let comparisons = 0;
  const neighbors = (
    index: number,
    values: Positions,
    cells: Map<string, number[]>,
  ) => {
    const offset = index * 3;
    const x = Math.floor(values[offset] / radius),
      y = Math.floor(values[offset + 1] / radius),
      z = Math.floor(values[offset + 2] / radius);
    const result: { index: number; distance: number }[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const other of cells.get(`${x + dx},${y + dy},${z + dz}`) ??
            []) {
            if (other === index) continue;
            if (++comparisons > 50_000_000)
              throw new Error(
                "Point neighborhood is too dense. Reduce the neighbor radius or simplify the cloud first.",
              );
            const distance =
              (values[offset] - values[other * 3]) ** 2 +
              (values[offset + 1] - values[other * 3 + 1]) ** 2 +
              (values[offset + 2] - values[other * 3 + 2]) ** 2;
            if (distance <= radiusSquared)
              result.push({ index: other, distance });
          }
        }
    return result;
  };
  diagnostics.neighborRadius = radius;
  if (action !== "smooth") {
    if (!selectedCount) throw new Error("Select points first.");
    const cells = hash(positions),
      mask = new Uint8Array(selection!);
    if (action === "connectedSelection") {
      const queue = Array.from({ length: count }, (_, index) => index).filter(
        selected,
      );
      for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const neighbor of neighbors(queue[cursor], positions, cells))
          if (!mask[neighbor.index]) {
            mask[neighbor.index] = 1;
            queue.push(neighbor.index);
          }
        if (cursor % 2048 === 0)
          progress(cursor / count, "Selecting connected points");
      }
    } else {
      for (let index = 0; index < count; index++) {
        if (action === "grow" && selected(index))
          for (const neighbor of neighbors(index, positions, cells))
            mask[neighbor.index] = 1;
        if (
          action === "shrink" &&
          selected(index) &&
          neighbors(index, positions, cells).some(
            (neighbor) => !selected(neighbor.index),
          )
        )
          mask[index] = 0;
      }
    }
    progress(1, "Point selection completed");
    return {
      selection: mask,
      diagnostics: {
        ...diagnostics,
        selectedPoints: mask.reduce((sum, value) => sum + (value ? 1 : 0), 0),
      },
    };
  }
  const iterations = request.iterations ?? 2,
    strength = request.strength ?? 0.5,
    deviation = positive(request.deviation ?? 0.05, "Maximum deviation");
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100)
    throw new Error("Smooth iterations must be an integer between 1 and 100.");
  if (!Number.isFinite(strength) || strength < 0 || strength > 1)
    throw new Error("Smooth strength must be between 0 and 1.");
  let output = Float32Array.from(positions);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const cells = hash(output),
      next = output.slice();
    for (let index = 0; index < count; index++) {
      if (!candidate(index)) continue;
      const near = neighbors(index, output, cells)
        .sort((a, b) => a.distance - b.distance || a.index - b.index)
        .slice(0, 32);
      if (!near.length) continue;
      const offset = index * 3,
        delta = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const mean =
          near.reduce(
            (sum, neighbor) => sum + output[neighbor.index * 3 + axis],
            0,
          ) / near.length;
        delta[axis] =
          output[offset + axis] +
          strength * (mean - output[offset + axis]) -
          positions[offset + axis];
      }
      const length = Math.hypot(...delta),
        scale = length > deviation ? deviation / length : 1;
      for (let axis = 0; axis < 3; axis++)
        next[offset + axis] = positions[offset + axis] + delta[axis] * scale;
      if (index % 2048 === 0)
        progress((iteration + index / count) / iterations, "Smoothing points");
    }
    output = next;
  }
  progress(1, "Point smoothing completed");
  return {
    positions: output,
    normals: normals ? Float32Array.from(normals) : undefined,
    ...(request.pointColors ? { pointColors: request.pointColors } : {}),
    diagnostics: {
      ...diagnostics,
      points: count,
      iterations,
      deviation,
      normalsReestimated: false,
    },
  };
}
