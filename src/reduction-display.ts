/** Bright blue/cyan/green/yellow/red display palette. Search radius is independent. */
export function reductionDisplayColor(
  distance: number,
  range: number,
): [number, number, number] {
  if (!Number.isFinite(distance)) return [50, 50, 50];
  const t = Math.min(4, Math.max(0, 2 + (2 * distance) / range));
  if (t <= 1) return [0, Math.round(255 * t), 255];
  if (t <= 2) return [0, 255, Math.round(255 * (2 - t))];
  if (t <= 3) return [Math.round(255 * (t - 2)), 255, 0];
  return [255, Math.round(255 * (4 - t)), 0];
}

export function toleranceAtPointer(
  y: number,
  top: number,
  height: number,
  range: number,
) {
  return (
    range * (1 - 2 * Math.min(1, Math.max(0, (y - top) / Math.max(1, height))))
  );
}

export function toleranceCoverage(
  distances: ArrayLike<number>,
  lower: number,
  upper: number,
) {
  let within = 0;
  for (let i = 0; i < distances.length; i++)
    if (
      Number.isFinite(distances[i]) &&
      distances[i] >= lower &&
      distances[i] <= upper
    )
      within++;
  return {
    within,
    percentage: distances.length ? (100 * within) / distances.length : 0,
  };
}
