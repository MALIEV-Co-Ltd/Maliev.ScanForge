export interface NoiseRings {
  offsets: Uint32Array;
  neighbors: Uint32Array;
  boundary: Uint8Array;
}
export interface NoiseWorkerRequest {
  initialize?: { rings: NoiseRings; begin: number; end: number };
  operation?: {
    weights: Float64Array;
    movable: Uint8Array;
    applyBoundaryEdges: boolean;
    neededMeans?: Uint8Array;
  };
  job?: {
    id: number;
    vertices: Float64Array;
    means?: Float64Array;
  };
}
export type NoiseWorkerResponse =
  { id: number; values: Float64Array } | { id: number; error: string };

/** Independent vertex sums retain the original ordered, repeated edge entries. */
export function noiseRange(
  rings: NoiseRings,
  begin: number,
  end: number,
  vertices: Float64Array,
  means?: Float64Array,
  weights?: Float64Array,
  movable?: Uint8Array,
  applyBoundaryEdges = true,
  neededMeans?: Uint8Array,
): Float64Array<ArrayBuffer> {
  const out = new Float64Array((end - begin) * 3);
  // Preserve unchanged coordinates in one typed-array copy. Selection-only
  // corrections need no arithmetic for unmarked or boundary-locked vertices.
  if (means) out.set(vertices.subarray(begin * 3, end * 3));
  for (let id = begin; id < end; id++) {
    if (!means && neededMeans && !neededMeans[id]) continue;
    const count = rings.offsets[id + 1] - rings.offsets[id];
    if (
      means &&
      (!count || !movable?.[id] || (!applyBoundaryEdges && rings.boundary[id]))
    )
      continue;
    for (let axis = 0; axis < 3; axis++) {
      const index = id * 3 + axis;
      let value = 0;
      if (!means) {
        for (
          let entry = rings.offsets[id];
          entry < rings.offsets[id + 1];
          entry++
        )
          value += vertices[rings.neighbors[entry] * 3 + axis];
        if (count) value *= 1 / count;
      } else {
        value = vertices[index];
        if (
          count &&
          movable?.[id] &&
          (applyBoundaryEdges || !rings.boundary[id])
        ) {
          let residual = 0;
          for (
            let entry = rings.offsets[id];
            entry < rings.offsets[id + 1];
            entry++
          ) {
            const neighbor = rings.neighbors[entry] * 3 + axis;
            residual += means[neighbor] - vertices[neighbor];
          }
          const weight = weights![id];
          value = Math.fround(
            means[index] -
              (means[index] - vertices[index]) * weight +
              (1 - weight) * (residual * (1 / count)),
          );
          if (!Number.isFinite(value))
            throw new Error(
              "Noise reduction exceeds coordinate precision; original mesh retained.",
            );
        }
      }
      out[(id - begin) * 3 + axis] = value;
    }
  }
  return out;
}

const scope = globalThis as unknown as {
  document?: unknown;
  postMessage?: (data: NoiseWorkerResponse, transfer: ArrayBuffer[]) => void;
  onmessage?: (event: MessageEvent<NoiseWorkerRequest>) => void;
  close?: () => void;
};
// Importing the kernel in the parent worker must not replace its message handler.
if (typeof scope.postMessage === "function" && scope.close && !scope.document) {
  let rings: NoiseRings | undefined;
  let operation: NoiseWorkerRequest["operation"];
  let begin = 0,
    end = 0;
  let lease: ReturnType<typeof setTimeout>;
  scope.onmessage = ({ data }) => {
    clearTimeout(lease);
    lease = setTimeout(() => scope.close?.(), 120_000);
    if (data.initialize) {
      ({ rings, begin, end } = data.initialize);
      operation = undefined;
      return;
    }
    if (data.operation) {
      operation = data.operation;
      return;
    }
    if (!data.job) return;
    try {
      if (!rings) throw new Error("Noise worker is not initialized.");
      if (!operation) throw new Error("Noise operation is not initialized.");
      const job = data.job;
      const values = noiseRange(
        rings,
        begin,
        end,
        job.vertices,
        job.means,
        operation.weights,
        operation.movable,
        operation.applyBoundaryEdges,
        operation.neededMeans,
      );
      scope.postMessage?.({ id: job.id, values }, [values.buffer]);
    } catch (error) {
      scope.postMessage?.(
        {
          id: data.job.id,
          error: error instanceof Error ? error.message : String(error),
        },
        [],
      );
    }
  };
}
