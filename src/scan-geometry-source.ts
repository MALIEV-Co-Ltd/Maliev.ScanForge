import type { ReductionStatistics } from "./reduction-report";

export type ScanGeometryRef = Readonly<{ id: string; generation: number }>;
export type ScanCoordinates = Float32Array | Float64Array;
export type ScanBounds = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];
export type ScanSourceMetadata = Readonly<{
  ref: ScanGeometryRef;
  triangles: number;
  bounds: ScanBounds;
  precision: "float32" | "float64";
  units: "mm";
}>;
export type ScanTriangleChunk = {
  firstTriangle: number;
  triangleCount: number;
  positions: ScanCoordinates;
  release(): void;
};
export interface ScanGeometrySource {
  readonly metadata: ScanSourceMetadata;
  readTriangles(
    first: number,
    count: number,
    signal?: AbortSignal,
  ): Promise<ScanTriangleChunk>;
}
export type ScanPageRef = Readonly<{
  id: string;
  bytes: number;
  sha256: string;
}>;
export interface ScanPageStore {
  append(bytes: Uint8Array, signal?: AbortSignal): Promise<ScanPageRef>;
  read(
    ref: ScanPageRef,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; release(): void }>;
  remove(ref: ScanPageRef, signal?: AbortSignal): Promise<void>;
}
export type ScanBudgetLease = { readonly bytes: number; release(): void };
export interface ScanBudget {
  reserve(
    owner: string,
    bytes: number,
    signal?: AbortSignal,
  ): Promise<ScanBudgetLease>;
  snapshot(): ScanBudgetSnapshot;
}
export type ScanBudgetSnapshot = Readonly<{
  capacityBytes: number;
  reservedBytes: number;
  peakBytes: number;
  residentProjectBytes: number;
  activeWorkers: number;
  spillBytes: number;
}>;
export type ScanProcessingProgress = {
  phase: string;
  processed: number;
  total: number;
  mode: "resident" | "disk";
  budget: ScanBudgetSnapshot;
};
export type ScanProcessingContext = {
  store: ScanPageStore;
  budget: ScanBudget;
  signal?: AbortSignal;
  progress(p: ScanProcessingProgress): void;
};
export type ScanChunkDirectoryRef = {
  root: ScanPageRef;
  entries: number;
  levels: number;
};
export type ScanReductionManifest = {
  source: ScanGeometryRef;
  ref: ScanGeometryRef;
  chunks: ScanChunkDirectoryRef;
  triangles: number;
  targetTriangles: number;
  bounds: ScanBounds;
  precision: "float32" | "float64";
  protectedSourceTriangles: number;
  protectedPatches: number;
};
export type ScanDistanceBatch = {
  firstSample: number;
  distances: Float64Array;
  triangleIds: Float64Array;
  release(): void;
};
export type ScanComparisonManifest = {
  statistics: ReductionStatistics;
  distances: ScanChunkDirectoryRef;
  colors: ScanChunkDirectoryRef;
};
export const SCAN_DEFAULT_BUDGET_BYTES = 128 * 1024 * 1024;
export const SCAN_PAGE_BYTES = 1024 * 1024;

export function checkScanAbort(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

export function scanRange(first: number, count: number, length: number): void {
  if (
    ![first, count, length].every(Number.isSafeInteger) ||
    first < 0 ||
    count < 0 ||
    first > length ||
    count > length - first
  )
    throw new RangeError(
      "Scan range must contain safe integer indices within the source.",
    );
}

export async function scanChecksum(bytes: Uint8Array): Promise<string> {
  // append/read callers already own an admitted buffer; no whole-page copy here.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
