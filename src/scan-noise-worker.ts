export interface NoiseRings {
  offsets: Uint32Array;
  neighbors: Uint32Array;
  boundary: Uint8Array;
}
export interface NoiseWorkerRequest {
  initialize?: { rings: NoiseRings; begin: number; end: number };
  job?: {
    id: number;
    vertices: Float64Array;
    means?: Float64Array;
    weights?: Float64Array;
    movable?: Uint8Array;
    applyBoundaryEdges?: boolean;
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
): Float64Array<ArrayBuffer> {
  const out = new Float64Array((end - begin) * 3);
  for (let id = begin; id < end; id++) {
    const count = rings.offsets[id + 1] - rings.offsets[id];
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
  let begin = 0,
    end = 0;
  let lease: ReturnType<typeof setTimeout>;
  scope.onmessage = ({ data }) => {
    clearTimeout(lease);
    lease = setTimeout(() => scope.close?.(), 120_000);
    if (data.initialize) {
      ({ rings, begin, end } = data.initialize);
      return;
    }
    if (!data.job) return;
    try {
      if (!rings) throw new Error("Noise worker is not initialized.");
      const job = data.job;
      const values = noiseRange(
        rings,
        begin,
        end,
        job.vertices,
        job.means,
        job.weights,
        job.movable,
        job.applyBoundaryEdges,
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
