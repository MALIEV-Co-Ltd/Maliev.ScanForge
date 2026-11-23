export type ExperimentalPointOrder = {
  ranks: Map<string, number>;
  ambiguous: Set<string>;
};

export function makeExperimentalPointOrder(
  points: Iterable<readonly number[]>,
  maxEntries: number,
  check: () => void,
): ExperimentalPointOrder {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 0)
    throw new Error("Finite point-order budget is invalid.");
  const ranks = new Map<string, number>();
  const first = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const point of points) {
    check();
    const key = JSON.stringify(point.map(Math.fround));
    const precise = JSON.stringify(point);
    if (!ranks.has(key)) {
      if (ranks.size >= maxEntries)
        throw new Error("Finite point-order budget exceeded.");
      ranks.set(key, ranks.size);
      first.set(key, precise);
    } else if (first.get(key) !== precise) ambiguous.add(key);
  }
  return { ranks, ambiguous };
}
