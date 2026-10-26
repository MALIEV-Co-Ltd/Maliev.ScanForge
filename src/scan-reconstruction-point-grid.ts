import { GridBits, type GridProgress } from "./scan-reconstruction-grid";
import type { Positions } from "./types";

export function samplePointReconstructionGrid(
  inputs: readonly Positions[],
  start: readonly number[],
  dimensions: readonly number[],
  resolution: number,
  progress: GridProgress,
  prior?: {
    occupancy: GridBits;
    shellPoints: number;
    distanceTests: number;
    candidates: number;
  },
) {
  progress(0, "Validating point reconstruction");
  // The squared half-cell diagonal includes a point exactly at a cell center.
  const radiusSquared = 0.75 * resolution * resolution;
  if (
    !Number.isFinite(resolution) ||
    resolution <= 0 ||
    !Number.isFinite(radiusSquared) ||
    radiusSquared <= 0
  )
    throw Error("Point resolution must have a positive finite squared radius.");
  if (start.length !== 3 || start.some((v) => !Number.isFinite(v)))
    throw Error(
      "Point reconstruction grid origin must contain three finite coordinates.",
    );
  const total = dimensions.reduce((a, b) => a * b, 1);
  if (
    dimensions.length !== 3 ||
    dimensions.some((v) => !Number.isSafeInteger(v) || v <= 0) ||
    !Number.isSafeInteger(total) ||
    total > 1_000_000_000 ||
    dimensions.some((v, i) => !Number.isFinite(start[i] + (v - 1) * resolution))
  )
    throw Error(
      "Point reconstruction grid exceeds its valid dimensions or 1000 million points.",
    );
  if (
    prior &&
    (!(prior.occupancy instanceof GridBits) ||
      prior.occupancy.length !== total ||
      [prior.shellPoints, prior.distanceTests, prior.candidates].some(
        (v) => !Number.isSafeInteger(v) || v < 0,
      ) ||
      prior.shellPoints > total ||
      prior.distanceTests > prior.candidates ||
      prior.candidates > 500_000_000)
  )
    throw Error("Invalid prior reconstruction grid or counters.");
  if (!inputs.length || inputs.length > 33)
    throw Error("Point reconstruction requires one to 33 point inputs.");
  let coordinates = 0;
  for (const points of inputs) {
    if (
      !(Array.isArray(points) || points instanceof Float32Array) ||
      !Number.isSafeInteger(points.length) ||
      !points.length ||
      points.length % 3
    )
      throw Error("Point reconstruction requires complete XYZ point records.");
    if (points.length > 500_000_000 - coordinates)
      throw Error(
        "Point reconstruction exceeds 500 million input coordinates.",
      );
    coordinates += points.length;
  }
  for (const points of inputs)
    for (let i = 0; i < points.length; i++) {
      if (i % 8192 === 0) progress(0, "Validating point reconstruction");
      if (
        !Number.isFinite(points[i]) ||
        !Number.isFinite(Math.fround(points[i]))
      )
        throw Error("Point coordinates must fit finite Float32 values.");
    }
  const occupancy = prior?.occupancy ?? new GridBits(total);
  let shellPoints = prior?.shellPoints ?? 0,
    distanceTests = prior?.distanceTests ?? 0,
    candidates = prior?.candidates ?? 0,
    processedPoints = 0,
    representedPoints = 0;
  const radius = Math.sqrt(radiusSquared),
    [nx, ny] = dimensions;
  for (const points of inputs)
    for (let i = 0; i < points.length; i += 3) {
      if (processedPoints % 2048 === 0)
        progress(
          0.05 + (0.55 * processedPoints) / (coordinates / 3),
          "Sampling point distance",
        );
      const low = [0, 1, 2].map((axis) =>
        Math.max(
          0,
          Math.ceil((points[i + axis] - radius - start[axis]) / resolution),
        ),
      );
      const high = [0, 1, 2].map((axis) =>
        Math.min(
          dimensions[axis] - 1,
          Math.floor((points[i + axis] + radius - start[axis]) / resolution),
        ),
      );
      let represented = false;
      for (let z = low[2]; z <= high[2]; z++)
        for (let y = low[1]; y <= high[1]; y++)
          for (let x = low[0]; x <= high[0]; x++) {
            if (++candidates > 500_000_000)
              throw Error(
                "Reconstruction sampling exceeds its bounded work limit; increase point resolution.",
              );
            if (candidates % 65536 === 0)
              progress(
                0.05 + (0.55 * processedPoints) / (coordinates / 3),
                "Sampling point distance",
              );
            distanceTests++;
            const d2 =
              (start[0] + x * resolution - points[i]) ** 2 +
              (start[1] + y * resolution - points[i + 1]) ** 2 +
              (start[2] + z * resolution - points[i + 2]) ** 2;
            if (d2 <= radiusSquared) {
              represented = true;
              const id = x + y * nx + z * nx * ny;
              if (!occupancy.get(id)) {
                occupancy.set(id);
                shellPoints++;
              }
            }
          }
      processedPoints++;
      representedPoints += Number(represented);
    }
  progress(0.6, "Point distance sampling complete");
  return {
    occupancy,
    shellPoints,
    distanceTests,
    candidates,
    processedPoints,
    representedPoints,
  };
}
