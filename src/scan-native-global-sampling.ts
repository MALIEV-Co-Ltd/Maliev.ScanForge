/** Original CRT generator, with explicit per-cell state rather than shared
 * process/thread state. Clock inputs are environmental replay inputs. */
export class NativeGlobalRandom {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next() {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
  scaled(maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 0 || maximum > 0xffffffff)
      throw new Error("Native random bounds require uint32.");
    return maximum <= 0x7fff
      ? Math.trunc((this.next() * maximum) / 32767)
      : Math.trunc((this.next() * this.next() * maximum) / 1073676289);
  }
}
export interface NativeGlobalSamplingCell {
  points: readonly number[];
  flags: number;
  selected?: readonly number[];
}
/** Original spatial-cell sampler (0x140d61500). This consumes one angular
 * group's occupied spatial cells. The caller owns the outer angular quota.
 * The nominal budget is not an exact output limit: native ceil/correction
 * rules can produce more or fewer samples. A clock is read only for cells
 * that need subsampling, and each such cell reseeds its own CRT sequence. */
export function nativeGlobalSpatialSamples(
  cells: readonly NativeGlobalSamplingCell[],
  budget: number,
  clock: () => number,
) {
  if (!Number.isInteger(budget) || budget < 1 || budget > 1_000_000)
    throw new Error(
      "Global sampling budget must be an integer from 1 to 1000000.",
    );
  for (const cell of cells) {
    if (
      !Number.isInteger(cell.flags) ||
      cell.flags < 0 ||
      cell.flags > 0xff ||
      !cell.points.every((id) => Number.isSafeInteger(id) && id >= 0) ||
      (!cell.selected?.every((id) => Number.isSafeInteger(id) && id >= 0) &&
        cell.selected !== undefined)
    )
      throw new Error(
        "Global sampling requires byte flags and nonnegative point IDs.",
      );
  }
  const occupied = cells.filter(
    (cell) => cell.flags & 1 && cell.points.length,
  ).length;
  if (!occupied)
    return {
      total: 0,
      selections: cells.map((cell) => Array.from(cell.selected ?? [])),
    };
  let quota = Math.ceil(budget / occupied) >>> 0;
  if (quota > 1) {
    let estimated = 0;
    for (const cell of cells)
      if (cell.flags & 1)
        estimated = (estimated + Math.min(quota, cell.points.length)) >>> 0;
    const correction = Math.max(1, Math.trunc(budget / estimated + 0.5));
    quota = Math.imul(quota, correction) >>> 0;
  }
  let total = 0;
  const selections = cells.map((cell) => {
    const n = cell.points.length;
    if (!(cell.flags & 1) || !n) return [];
    if (n <= quota) {
      total = (total + n) >>> 0;
      return Array.from(cell.points);
    }
    const seed = clock();
    if (!Number.isInteger(seed) || seed < -0x80000000 || seed > 0xffffffff)
      throw new Error("Global sampling clock must produce a 32-bit seed.");
    const random = new NativeGlobalRandom(seed),
      start = random.scaled(n - 1),
      stride = Math.max(1, Math.floor(n / quota));
    const selected = Array.from(
      { length: quota },
      (_, i) => cell.points[((start + i * stride) >>> 0) % n],
    );
    total = (total + quota) >>> 0;
    return selected;
  });
  return { total, selections };
}
