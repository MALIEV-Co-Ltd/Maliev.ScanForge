export interface FieldResidualCandidate {
  id: number;
  residual: number;
}

/** The ordinary phase-one bucket pass; eligibility and linked-list traversal order are supplied. */
export function selectFieldResidualCandidates(
  connections: readonly FieldResidualCandidate[],
  nodes: readonly FieldResidualCandidate[],
  thresholdScale: number,
  budget: number,
  previousThreshold = 0,
): {
  connections: Uint32Array;
  nodes: Uint32Array;
  thresholds: Float64Array;
  nextThreshold: number;
  connectionBudgetUsed: number;
  nodeBudgetUsed: number;
} {
  if (
    !Number.isFinite(thresholdScale) ||
    thresholdScale < 0 ||
    !Number.isFinite(budget * 2) ||
    budget < 0 ||
    !Number.isFinite(previousThreshold) ||
    previousThreshold < 0
  )
    throw new Error(
      "Residual selection settings must be finite and nonnegative.",
    );
  const thresholds = Float64Array.from(
    [0.0001, 0.001, 0.01, 0.03, 0.07, 0.1, 0.25],
    (factor) => thresholdScale * factor,
  );
  const limits = new Float64Array(8);
  limits.set(thresholds);
  limits[7] = Number.MAX_VALUE;
  const buckets = (candidates: readonly FieldResidualCandidate[]) => {
    const result = Array.from(
      { length: 8 },
      () => [] as FieldResidualCandidate[],
    );
    const used = new Set<number>();
    for (const candidate of candidates) {
      if (
        !Number.isInteger(candidate.id) ||
        candidate.id < 0 ||
        candidate.id > 2147483647 ||
        used.has(candidate.id) ||
        !Number.isFinite(candidate.residual) ||
        candidate.residual < 0 ||
        candidate.residual > 0.5
      )
        throw new Error(
          "Residual candidates require unique valid IDs and rounding residuals.",
        );
      used.add(candidate.id);
      const index = limits.findIndex((limit) => candidate.residual < limit);
      result[index].push(candidate);
    }
    return result;
  };
  const edgeBuckets = buckets(connections);
  const nodeBuckets = buckets(nodes);
  const chosenEdges: number[] = [],
    chosenNodes: number[] = [];
  let connectionBudgetUsed = 0,
    nodeBudgetUsed = 0,
    nextThreshold = previousThreshold;
  for (const bucket of edgeBuckets) {
    const sum = bucket.reduce(
      (total, candidate) => total + candidate.residual,
      0,
    );
    if (connectionBudgetUsed + sum <= budget) {
      for (const candidate of bucket) chosenEdges.push(candidate.id);
      connectionBudgetUsed += sum;
      continue;
    }
    const remaining = new Set(bucket);
    while (remaining.size) {
      let nearest: FieldResidualCandidate | undefined;
      for (const candidate of remaining)
        if (!nearest || candidate.residual < nearest.residual)
          nearest = candidate;
      const candidate = nearest!;
      connectionBudgetUsed += candidate.residual;
      if (connectionBudgetUsed > budget) {
        if (chosenEdges.length === 0) chosenEdges.push(candidate.id);
        nextThreshold = candidate.residual;
        break;
      }
      chosenEdges.push(candidate.id);
      remaining.delete(candidate);
    }
    break;
  }
  for (const bucket of nodeBuckets) {
    for (const candidate of bucket) chosenNodes.push(candidate.id);
    nodeBudgetUsed += bucket.reduce(
      (total, candidate) => total + candidate.residual,
      0,
    );
    if (nodeBudgetUsed > budget + budget) break;
  }
  return {
    connections: Uint32Array.from(chosenEdges),
    nodes: Uint32Array.from(chosenNodes),
    thresholds: limits,
    nextThreshold,
    connectionBudgetUsed,
    nodeBudgetUsed,
  };
}
