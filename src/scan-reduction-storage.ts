import type { ReductionVertex } from "./scan-reduction-candidate";

export const COMPACT_REDUCTION_BUDGET_BYTES = 1536 * 1024 * 1024;
export const REDUCTION_REFERENCE_CHUNK = 65536;

export class ReductionBudgetError extends Error {
  constructor() {
    super(
      "Polygon reduction exceeds the current working-memory budget; original mesh retained.",
    );
    this.name = "ReductionBudgetError";
  }
}

export class ReductionMemoryBudget {
  private used = 0;
  constructor(readonly capacityBytes: number) {
    if (!Number.isSafeInteger(capacityBytes) || capacityBytes <= 0)
      throw new RangeError(
        "Reduction memory capacity must be a positive safe integer.",
      );
  }
  get usedBytes() {
    return this.used;
  }
  reserve(bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError("Invalid reduction allocation size.");
    if (bytes > this.capacityBytes - this.used)
      throw new ReductionBudgetError();
    this.used += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.used -= bytes;
    };
  }
}

export function reductionWords(memory: ReductionMemoryBudget, count: number) {
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff)
    throw new RangeError("Invalid reduction word count.");
  const release = memory.reserve(count * 4);
  try {
    return { values: new Uint32Array(count), release };
  } catch (error) {
    release();
    throw error;
  }
}

/** Encoded face/corner references; snapshots never alias capacity reused by reset. */
export class ReductionReferences {
  private chunks: Uint32Array[] = [];
  private leases: Array<() => void> = [];
  private count = 0;
  constructor(
    private readonly memory: ReductionMemoryBudget,
    private readonly chunkEntries = REDUCTION_REFERENCE_CHUNK,
  ) {
    if (
      !Number.isSafeInteger(chunkEntries) ||
      chunkEntries <= 0 ||
      chunkEntries > 0xffffffff
    )
      throw new RangeError("Invalid reduction reference chunk size.");
  }
  get length() {
    return this.count;
  }
  private capacity(count: number, checkpoint?: () => void) {
    const needed = Math.ceil(count / this.chunkEntries) - this.chunks.length;
    if (needed <= 0) return;
    const release = this.memory.reserve(needed * this.chunkEntries * 4);
    try {
      const added: Uint32Array[] = [];
      for (let index = 0; index < needed; index++) {
        checkpoint?.();
        added.push(new Uint32Array(this.chunkEntries));
      }
      this.chunks.push(...added);
      this.leases.push(release);
    } catch (error) {
      release();
      throw error;
    }
  }
  resize(count: number, checkpoint?: () => void) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff)
      throw new RangeError("Invalid reduction reference count.");
    this.capacity(count, checkpoint);
    this.count = count;
  }
  get(index: number) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count)
      throw new RangeError("Reduction reference index is outside its range.");
    return this.chunks[Math.floor(index / this.chunkEntries)][
      index % this.chunkEntries
    ];
  }
  push(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new RangeError("Invalid encoded reduction reference.");
    if (this.count === 0xffffffff) throw new ReductionBudgetError();
    this.capacity(this.count + 1);
    const chunk = Math.floor(this.count / this.chunkEntries);
    this.chunks[chunk][this.count % this.chunkEntries] = value;
    this.count++;
  }
  set(index: number, value: number) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.count ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 0xffffffff
    )
      throw new RangeError("Invalid reduction reference write.");
    this.chunks[Math.floor(index / this.chunkEntries)][
      index % this.chunkEntries
    ] = value;
  }
  snapshot(start: number, end: number, checkpoint?: () => void) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.count
    )
      throw new RangeError(
        "Reduction snapshot is outside its reference range.",
      );
    const lease = reductionWords(this.memory, end - start);
    try {
      for (let index = start; index < end; index++) {
        if ((index - start) % 4096 === 0) checkpoint?.();
        lease.values[index - start] = this.get(index);
      }
      checkpoint?.();
      return lease;
    } catch (error) {
      lease.release();
      throw error;
    }
  }
  reset() {
    this.count = 0;
  }
  dispose() {
    this.chunks = [];
    for (const release of this.leases) release();
    this.leases = [];
    this.count = 0;
  }
}

function recordBytes(vertices: number, faces: number) {
  if (
    !Number.isSafeInteger(vertices) ||
    vertices < 0 ||
    vertices > 0xffffffff ||
    !Number.isSafeInteger(faces) ||
    faces < 0 ||
    faces * 3 > 0xffffffff
  )
    throw new RangeError("Invalid compact reduction dimensions.");
  // Columns plus source/widening, preparation scratch and worst-case export.
  return vertices * 198 + faces * 126;
}

export function compactReductionBytes(vertices: number, faces: number) {
  return (
    recordBytes(vertices, faces) +
    Math.ceil((faces * 3) / REDUCTION_REFERENCE_CHUNK) *
      REDUCTION_REFERENCE_CHUNK *
      4
  );
}

/** Structure-of-arrays state; no permanent object or typed-array view per record. */
export class CompactReductionState {
  readonly memory: ReductionMemoryBudget;
  readonly references: ReductionReferences;
  readonly vertexCount: number;
  readonly originalFaces: number;
  faceCount: number;
  minimum = 3.4028234663852886e38;
  points = new Float64Array();
  quadrics = new Float64Array();
  offsets = new Uint32Array();
  counts = new Uint32Array();
  boundary = new Uint8Array();
  triangles = new Uint32Array();
  normals = new Float64Array();
  errors = new Float64Array();
  best = new Uint8Array();
  flags = new Uint8Array();
  order = new Uint32Array();
  private releaseBase: () => void = () => {};
  private disposed = false;
  constructor(
    coordinates: ArrayLike<number>,
    triangles: ArrayLike<number>,
    checkpoint?: () => void,
    limitBytes = COMPACT_REDUCTION_BUDGET_BYTES,
  ) {
    checkpoint?.();
    this.vertexCount = coordinates.length / 3;
    this.faceCount = this.originalFaces = triangles.length / 3;
    this.memory = new ReductionMemoryBudget(limitBytes);
    this.references = new ReductionReferences(this.memory);
    if (
      compactReductionBytes(this.vertexCount, this.originalFaces) > limitBytes
    )
      throw new ReductionBudgetError();
    this.releaseBase = this.memory.reserve(
      recordBytes(this.vertexCount, this.originalFaces),
    );
    try {
      this.points = Float64Array.from(coordinates);
      this.quadrics = new Float64Array(this.vertexCount * 10);
      this.offsets = new Uint32Array(this.vertexCount);
      this.counts = new Uint32Array(this.vertexCount);
      this.boundary = new Uint8Array(this.vertexCount);
      this.triangles = Uint32Array.from(triangles);
      this.normals = new Float64Array(this.originalFaces * 3);
      this.errors = new Float64Array(this.originalFaces * 3);
      this.best = new Uint8Array(this.originalFaces);
      this.flags = new Uint8Array(this.originalFaces);
      this.order = new Uint32Array(this.originalFaces);
      for (let face = 0; face < this.originalFaces; face++) {
        if (face % 4096 === 0) checkpoint?.();
        this.order[face] = face;
      }
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  vertex(id: number): ReductionVertex {
    if (
      this.disposed ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      id >= this.vertexCount
    )
      throw new RangeError("Invalid compact reduction vertex.");
    return {
      point: [
        this.points[id * 3],
        this.points[id * 3 + 1],
        this.points[id * 3 + 2],
      ],
      quadric: this.quadrics.subarray(id * 10, id * 10 + 10),
      boundary: Boolean(this.boundary[id]),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.references.dispose();
    this.releaseBase();
    this.points =
      this.quadrics =
      this.normals =
      this.errors =
        new Float64Array();
    this.offsets =
      this.counts =
      this.triangles =
      this.order =
        new Uint32Array();
    this.boundary = this.best = this.flags = new Uint8Array();
  }
}
