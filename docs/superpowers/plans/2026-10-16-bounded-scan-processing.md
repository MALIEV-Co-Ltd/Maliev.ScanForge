# Bounded Scan Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`
> to implement this plan task-by-task. Steps use checkbox syntax for tracking.
> Execute directly in this session: the side-conversation boundary prohibits
> subagents, delegation and interaction with other agents.

**Goal:** Make polygon reduction adapt its resident working set and use local disk
for larger scans, while preserving numerical checks, original data and GUI/MCP parity.

**Architecture:** Immutable chunk sources feed one resource coordinator, bounded
reduction patches and a paged comparison index. Resident and OPFS stores implement
the same page contract; accepted geometry/history reference immutable manifests.
Keep disk-backed loading gated until rendering, acceptance, persistence and agent
transfers support those manifests end to end.

**Tech Stack:** TypeScript, existing React/Three.js frontend, existing reduction
kernel and signed-distance evaluator, Web Workers, OPFS, IndexedDB, Vitest and the
existing isolated Playwright/MCP harness. No new backend or paid dependencies.

**Spec:** [Approved design](../specs/2026-10-16-bounded-scan-processing-design.md).
Owner approval received in this conversation on 2026-10-16. This plan awaits review.

## Global Constraints

- "Display sampling must never silently become processing input."
- "Coordinates retain their existing precision and millimetre units."
- "Never start duplicate workers or lower a failed admission guard to obtain capacity."
- "Do not represent a file-backed scan as an empty `positions` array."
- "Do not introduce a GUI-only storage mode or silently change geometry contracts."
- "Each phase needs a separate buildable, validated commit boundary."
- No push, deployment or publication; preserve unrelated dirty files and index entries.
- Keep the existing app on port 5173. Isolated verification servers use owned ephemeral
  loopback ports and finite leases; never replace the user's active server to test a branch.
- Small recovered-path fixtures retain geometry bytes, sample order, signed-distance
  results and report semantics. Scalable-path ties use stable source-triangle IDs.
- GPU numerical processing is excluded from this plan; CPU correctness and bounded
  storage come first. No unsupported capabilities appear in discovery.

## Review Focus

1. Near-coincident vertices on opposite hash-cell boundaries must preserve the
   current 27-cell search and first-matching representative (Task 3).
2. A spatial cut through a healthy vertex fan must not classify the original scan
   as nonmanifold or retain an entire healthy patch (Task 4).
3. A closer triangle in an evicted neighboring chunk must still win comparison,
   including opposite winding and exact-distance ties (Task 5).
4. Reload or quota failure between page flush and manifest publication must preserve
   accepted/history/backup data and other jobs' temporary pages (Tasks 6 and 9).
5. Replayed upload chunks or display proxies must never duplicate source geometry,
   change its precision or silently become editable full-resolution input (Tasks 7–9).

## Execution and validation rules

This is one dependent pipeline, not independently enabled disk/render/storage
features. Each task has an internal testable deliverable; public capability gates
remain closed until its consumers exist. Do not claim beyond-RAM support after
the resident-only tasks.

Before execution, read `AGENTS.md` and the using-git-worktrees skill. Create an
isolated checkout for this work. Start from the approved design commit and apply
only the pending node-budget fix listed in Task 1, with an ownership/fingerprint
manifest. Do not copy the working tree wholesale: the main task is editing shared
types, import, normals, alignment, automation and UI files.

For every task:

1. Write its named regression tests, run them and record the expected failure.
2. Implement the listed contracts without unrelated refactoring.
3. After resource admission, run `npm run build` first; require zero errors and
   warnings. Then run its focused tests, `npm test`, touched-file Prettier checks,
   `git diff --check`, and its applicable integration/browser checks.
4. Record commands/results and resource ownership/cleanup in ignored `.resources`.
   Do not weaken limits or relabel skipped checks as passing. Serialize heavy jobs.
5. Commit only that task's reviewed files/hunks after those checks pass. Reinspect
   the index immediately before committing; never include another task's stage.

Focused tests use `npx vitest run <listed-tests> --maxWorkers=1 --exclude '**/.resources/**'`.
Expected result is zero failures; test counts are recorded from actual reports.
Use the existing build admission guard and the large-browser harness's unchanged
6,144 MiB admission requirement. Do not raise Node heaps without fresh capacity evidence.

## Shared interfaces and decisions

Define these contracts in Task 2; later tasks consume these names unchanged.
Import `ReductionStatistics` from the existing `src/reduction-report.ts`.

```ts
type ScanGeometryRef = { id: string; generation: number };
type ScanCoordinates = Float32Array | Float64Array;
type ScanBounds = readonly [number, number, number, number, number, number];
type ScanSourceMetadata = {
  ref: ScanGeometryRef;
  triangles: number; // safe integer; not a typed-array length ceiling
  bounds: ScanBounds;
  precision: "float32" | "float64";
  units: "mm";
};
type ScanTriangleChunk = {
  firstTriangle: number;
  triangleCount: number;
  positions: ScanCoordinates;
  release(): void;
};
interface ScanGeometrySource {
  readonly metadata: ScanSourceMetadata;
  readTriangles(
    first: number,
    count: number,
    signal?: AbortSignal,
  ): Promise<ScanTriangleChunk>;
}
type ScanPageRef = { id: string; bytes: number; sha256: string };
interface ScanPageStore {
  append(bytes: Uint8Array, signal?: AbortSignal): Promise<ScanPageRef>;
  read(
    ref: ScanPageRef,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; release(): void }>;
  remove(ref: ScanPageRef, signal?: AbortSignal): Promise<void>;
}
type ScanBudgetLease = { bytes: number; release(): void };
interface ScanBudget {
  reserve(
    owner: string,
    bytes: number,
    signal?: AbortSignal,
  ): Promise<ScanBudgetLease>;
  snapshot(): ScanBudgetSnapshot;
}
type ScanBudgetSnapshot = {
  capacityBytes: number;
  reservedBytes: number;
  peakBytes: number;
  residentProjectBytes: number;
  activeWorkers: number;
  spillBytes: number;
};
type ScanProcessingProgress = {
  phase: string;
  processed: number;
  total: number;
  mode: "resident" | "disk";
  budget: ScanBudgetSnapshot;
};
type ScanProcessingContext = {
  store: ScanPageStore;
  budget: ScanBudget;
  signal?: AbortSignal;
  progress(p: ScanProcessingProgress): void;
};
type ScanChunkDirectoryRef = {
  root: ScanPageRef;
  entries: number;
  levels: number;
};
type ScanReductionManifest = {
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
type ScanDistanceBatch = {
  firstSample: number;
  distances: Float64Array;
  triangleIds: Float64Array;
  release(): void;
};
type ScanComparisonManifest = {
  statistics: ReductionStatistics;
  distances: ScanChunkDirectoryRef;
  colors: ScanChunkDirectoryRef;
};
```

- Default incremental scratch budget: 128 MiB; default page size: 1 MiB; initial
  patch size: the existing 8,192 triangles; initial worker concurrency: one.
  These bound working sets, not total input. Tests inject smaller capacities.
- Oversized reservations fail before allocation; the planner splits work or uses
  disk, rather than relaxing admission. Claims waiting behind active leases apply
  cancellable backpressure. Count existing project/history buffers separately.
- Page cache leases and all transfer copies count toward the same coordinator.
  Borrowed authored buffers must never be detached. Preserve double-precision
  authored coordinates until the existing operation's Float32 conversion point.
- Safe global IDs and local Uint32 indices are distinct. Manifest IDs stay opaque;
  no caller-supplied filesystem paths or native worker handles enter the API.
- Preserve existing two-minute inactivity and fifteen-minute worker leases. Longer
  jobs checkpoint state and renew through a new admitted worker; no worker lives
  indefinitely. Accepted manifests are persistent data, never idle-worker cleanup.

## Task 1: Establish an isolated verified baseline

**Files:** Pending owned `src/scan-reduction-surface.ts`, `src/scan-reduction-comparison.ts`,
`src/scan-preview.ts`; `tests/scan-reduction-large-surface.test.ts`,
`tests/large-reduction-browser.mjs`; preserve tracked `tests/scan-reduction-surface.test.ts`.
Update only the matching comparison paragraph in `docs/AGENT_GUIDE.md`.

**Interfaces:** Consumes existing `ScanPreviewSession` and `runScanTool` contracts;
produces a validated baseline commit and input/result evidence for later comparisons.

- [ ] Fingerprint and copy only the listed owned changes into the isolated checkout;
      verify the original native-parity file is identical to HEAD, not overwritten.
- [ ] Run the exact node-budget reproducer and both native/scalable comparison files.
      Assert signed distances, strict radius, source immutability and preview index reuse.
- [ ] Run the standard build/suite/static gate and `node tests/large-reduction-browser.mjs`.
      Require GUI preview/compare/accept and direct MCP success with 1,152,000 input triangles.
- [ ] Preserve the measured baseline: GUI output 996,352 faces, approximately 26.9 s;
      subsequent MCP output 977,492 faces, approximately 21.3 s. Timings are observations,
      not universal budgets; the GUI output is above the requested 576,000-face target.
- [ ] Verify owned worker/port cleanup, commit the comparison fix and record the SHA.

## Task 2: Add the resource coordinator and resident chunk/page adapters

**Create:** `src/scan-geometry-source.ts`, `src/scan-resource-budget.ts`,
`src/scan-resident-source.ts`, `src/scan-memory-page-store.ts`.
**Test:** `tests/scan-resource-budget.test.ts`, `tests/scan-resident-source.test.ts`.

**Interfaces:** Produces the shared contracts above;
`residentScanSource(positions: Positions, ref: ScanGeometryRef, budget: ScanBudget): ScanGeometrySource`;
`createScanBudget(capacityBytes: number, residentProjectBytes: number): ScanBudget`;
`createMemoryPageStore(budget: ScanBudget, owner: string): ScanPageStore`.

- [ ] Add failing tests for overlapping reservations, double release, FIFO waiters,
      abort while queued, oversize claims, caller buffer retention and Float64 round trips.
      Pin `"reservations bound live scratch, not scan length"` with
      `expect(budget.snapshot().peakBytes).toBeLessThanOrEqual(65_536)` and
      `expect(budget.snapshot().reservedBytes).toBe(0)` after all leases are released.
- [ ] Implement range validation, leased bounded copies, memory-page ownership and
      deduplicated baseline accounting. Never allocate before a successful claim.
- [ ] Assert `peakBytes <= capacityBytes` with 64 KiB test budgets and verify a huge
      logical source can serve small ranges without a full-size array allocation.
- [ ] Run the standard gate and commit the internal adapters; no new UI capability yet.

## Task 3: Replace whole-original preview topology with canonical sample pages

**Create:** `src/scan-sample-directory.ts`, `src/scan-comparison-output.ts`.
**Modify:** `src/scan-preview.ts`, `src/scan-reduction-comparison.ts`.
**Test:** `tests/scan-sample-directory.test.ts`, `tests/scan-comparison-output.test.ts`,
`tests/scan-preview.test.ts`.

**Interfaces:**
`createScanSampleDirectory(source: ScanGeometrySource, store: ScanPageStore, budget: ScanBudget, signal?: AbortSignal): Promise<ScanSampleDirectory>`.
`ScanSampleDirectory.sampleCount: number` counts unique representatives;
`samples(signal?: AbortSignal)` yields bounded `{ firstSample: number, coordinates: ScanCoordinates, release(): void }` batches;
`corners(firstTriangle: number, count: number, signal?: AbortSignal)` returns
`Promise<{ sampleIds: Float64Array; release(): void }>`.
`writeComparisonPages(samples: ScanSampleDirectory, distances: AsyncIterable<ScanDistanceBatch>, tolerance: number, paletteThreshold: number, context: ScanProcessingContext): Promise<ScanComparisonManifest>`
produces the existing `ReductionStatistics` and paged distance/color output.

- [ ] Add failing assertions that the sample representatives/corner mapping exactly
      match `analyzeMesh(..., {tolerance: 1e-6})` while no adjacency is constructed.
      In `"cross-page samples retain recovered weld order"`, assert
      `expect(actualRepresentativeBytes).toEqual(referenceRepresentativeBytes)` and
      `expect(actualCornerIds).toEqual(reference.triangles)` on bounded test fixtures.
- [ ] Test negative cells, representatives across chunk boundaries, the original
      first-coordinate origin, and competing matches in all 27 cells. Preserve existing
      dx/dy/dz candidate order and insertion order, not a new global-nearest weld rule.
- [ ] Implement paged hash buckets and sample/corner iterators. Compute reports over
      unique representatives; emit corner colors without materializing full topology.
- [ ] Keep the small recovered path; gate the new path until its complete store/pipeline
      is available. Test cancellation/recoloring and resident precision/source retention.
- [ ] Run the standard gate and commit; document sample counts and storage ownership.

## Task 4: Build valid bounded patches and stream reduced output

**Create:** `src/scan-edge-directory.ts`, `src/scan-reduction-order.ts`,
`src/scan-reduction-chunks.ts`.
**Modify:** `src/scan-reduction-partitions.ts`, `src/scan-tools-reduction.ts`.
**Test:** `tests/scan-reduction-chunks.test.ts`, `tests/scan-reduction-partitions.test.ts`.

**Interfaces:** `createScanEdgeDirectory(source, samples, store, budget, signal?)`
returns a `ScanEdgeDirectory` whose `classifyPatch(faceIds: readonly number[], signal?)`
distinguishes source-invalid edges/fans from cut-induced fans.
`reduceScanSource(source: ScanGeometrySource, operation, context: ScanProcessingContext): Promise<ScanReductionManifest>` consumes
`operation` is the existing `Extract<ScanToolOperation, {kind: "reducePolygons"}>`.
its ordered output directory and achieved/protected counts are defined above.

- [ ] Add a healthy curved-grid cut-fan regression plus genuine nonmanifold, duplicate,
      degenerate and inconsistent-winding controls; assert only artificial cuts are normalized.
- [ ] Implement stable Morton runs with `(code, sourceFaceId)` ordering and bounded
      merging. Build connected local fans; duplicate only cut-induced local representatives
      at identical coordinates so shared boundaries remain pinned by the existing kernel.
- [ ] Append output pages instead of allocating/slicing an input-sized result. Allocate
      fixed first-pass quotas with the existing global percentage rounding; reconcile
      residual counts in deterministic patch order against protected topology. First-pass
      quotas must not depend on worker completion order, preparing for Task 10.
- [ ] Assert shared seam coordinates are unchanged, output faces are finite/nondegenerate,
      and small native fixture bytes remain unchanged. The healthy 1,152,000-face panel must
      reach at most 576,000 faces without deleting or silently retaining healthy regions.
      Invalid-source fixtures may stop above target, with exact protected counts reported.
      Name the panel test `"healthy cut fans reach the requested global count"` and pin
      `expect(result.triangles).toBeLessThanOrEqual(576_000)` plus
      `expect(result.protectedSourceTriangles).toBe(0)` for that healthy fixture.
- [ ] Run the standard gate, compare count/quality/timing to Task 1 and commit.

## Task 5: Add bounded cross-chunk surface comparison

**Create:** `src/scan-paged-surface-index.ts`, `src/scan-source-comparison.ts`.
**Modify:** `src/scan-reduction-surface.ts`, `src/scan-reduction-comparison.ts`,
`src/scan-preview.ts`.
**Test:** `tests/scan-paged-surface-index.test.ts`, `tests/scan-source-comparison.test.ts`.

**Interfaces:** `preparePagedReductionSurface(manifest: ScanReductionManifest, store: ScanPageStore, budget: ScanBudget, signal?: AbortSignal): Promise<ScanSurfaceIndex>`;
`ScanSurfaceIndex.queryBatch(points: ScanCoordinates, radius: number, signal?): Promise<{distances: Float64Array; triangleIds: Float64Array}>`;
missing samples use NaN distance and triangle ID -1.
`compareScanSources(samples: ScanSampleDirectory, index: ScanSurfaceIndex, tolerance: number, paletteThreshold: number, context: ScanProcessingContext): Promise<ScanComparisonManifest>`.

- [ ] Add brute-force signed-distance comparisons where the closest facet is in another
      chunk, already evicted, at a chunk corner, or tied with opposite winding.
- [ ] Implement a paged spatial directory and leased local BVHs. Preserve strict search
      radius and native leaf arithmetic; merge equal distances by global source ID.
- [ ] Assert report/RGB equivalence across different page sizes and eviction orders;
      test wholly unmatched samples and tolerance-only recoloring without rerunning reduction.
      In `"evicted neighboring chunks still contain the closest facet"`, pin
      `expect(actual.distances).toEqual(bruteForce.distances)` and
      `expect(actual.triangleIds).toEqual(bruteForce.triangleIds)`; tie fixtures use the
      lowest stable source ID, while recovered small-path fixtures keep their original order.
- [ ] Bound index metadata, scratch and output page leases; do not retain every local BVH.
- [ ] Run the standard gate and commit. Keep disk-backed public loading gated.

## Task 6: Implement OPFS pages, manifest publication and recovery

**Create:** `src/scan-opfs-page-store.ts`, `src/scan-store-manifest.ts`,
`src/scan-store-recovery.ts`, `src/scan-store-worker.ts`, `src/scan-store-client.ts`.
**Test:** `tests/scan-store-manifest.test.ts`, `tests/scan-store-recovery.test.ts`,
`tests/scan-opfs-browser.mjs`.

**Interfaces:** `openScanDiskStore(ownerJobId: string, budget: ScanBudget, signal?): Promise<ScanPageStore>`;
`publishScanManifest(draft: ScanReductionManifest, expectedGeneration: number, signal?): Promise<ScanGeometryRef>`;
`retainScanGeometry(ref: ScanGeometryRef, owner: ScanGeometryOwner): Promise<void>` /
`releaseScanGeometry(ref: ScanGeometryRef, owner: ScanGeometryOwner): Promise<void>`;
`ScanGeometryOwner` is `{kind: "entity" | "history" | "backup" | "preview" | "job"; id: string}`;
`recoverScanStore(now: number, activeJobIds: ReadonlySet<string>, signal?): Promise<ScanRecoveryReport>`.
`ScanRecoveryReport` is `{reclaimedTemporaryBytes: number; reclaimedTemporaryPages: number; preservedManifests: number}`.

- [ ] Add quota, checksum, stale-generation, duplicate-ID and unsupported-OPFS tests.
      Inject crashes before flush, after flush and before/after metadata commit.
- [ ] Write and flush immutable OPFS pages before publishing the manifest/refcounts in
      one IndexedDB transaction. Keep temporary, accepted, history and backup ownership separate.
- [ ] Implement cancellable worker RPC, bounded leases/checkpoints and cleanup by exact
      job ownership. No broad origin-wide deletion or persistent-data cleanup on worker expiry.
- [ ] Run the OPFS browser harness: reload with live references, expire another job's
      unreferenced temporary pages, and assert accepted/history/backup pages survive.
      In `"crash before publication preserves the accepted generation"`, assert
      `expect(reopenedAcceptedRef).toEqual(originalAcceptedRef)` and
      `expect(await readAcceptedPage()).toEqual(originalAcceptedPage)` after recovery.
- [ ] Run the standard gate, verify handle/worker cleanup and commit the disk foundation.

## Task 7: Stream imports and expose explicit stored geometry

**Create:** `src/scan-stored-source.ts`, `src/scan-stream-import.ts`,
`src/entity-geometry.ts`, `src/scan-source-registry.ts`.
**Modify:** `src/types.ts`, `src/io.ts`, `src/scan-source.ts`,
`src/automation/operations.ts`, `src/ui/App.tsx`.
**Test:** `tests/scan-stream-import.test.ts`, `tests/entity-geometry.test.ts`,
`tests/automation-operations.test.ts`.

**Interfaces:** `openStoredScanSource(ref: ScanGeometryRef, budget: ScanBudget, signal?): Promise<ScanGeometrySource>`;
`importScanStream(input: ScanImportInput, context: ScanProcessingContext): Promise<ScanGeometryRef>`;
`ScanImportInput` is `{name: string; stream: ReadableStream<Uint8Array>; bytes: number; format: "stl" | "ply" | "asc"}`;
`entityGeometrySource(entity: Entity, context: ScanProcessingContext): Promise<ScanGeometrySource>`.
Make geometry storage an explicit discriminated union: existing resident entities
retain `positions`; paged mesh/point-cloud entities carry `scanGeometry` and have no
`positions`. Never use an empty buffer, lazy numeric proxy or unchecked cast as a substitute.

- [ ] Add format fixtures spanning stream boundaries for binary/ASCII STL, indexed PLY
      and ASC; preserve existing accepted/source counts, scanner normals and precision.
- [ ] Implement streaming format adapters and incremental validation with bounded pages.
      Keep raw source, accepted full resolution and display counts distinct.
- [ ] Use compiler errors plus `rg -l '\bEntity\b' src` to create and review the exact
      consumer migration list before editing consumers. Preserve each legacy resident
      operation; route stored-capable operations through the shared accessor and explicitly
      disable unsupported storage prerequisites in both GUI and `command_get`.
- [ ] Keep public disk import gated until Tasks 8–9 pass. Add tests proving no code path
      interprets missing resident arrays as zero triangles or uses a sampled proxy for editing.
      Pin `"stored scans retain full source counts"` with
      `expect(source.metadata.triangles).toBe(fullResolutionCount)` and
      `expect(renderedTriangleCount).toBeLessThan(fullResolutionCount)` on a stored fixture;
      processing input must still contain every accepted source facet.
- [ ] Run the standard gate and commit the typed source/consumer migration.

## Task 8: Complete preview, renderer, selection and timeline references

**Create:** `src/scan-chunk-display.ts`, `src/scan-preview-manifest.ts`.
**Modify:** `src/scan-preview.ts`, `src/processing-client.ts`, `src/processing-worker.ts`,
`src/processing-session.ts`, `src/viewport.ts`, `src/history.ts`, `src/ui/App.tsx`.
**Test:** `tests/scan-preview-manifest.test.ts`, `tests/scan-chunk-display.test.ts`,
`tests/scan-stored-timeline.test.ts`, `tests/scan-stored-preview-browser.mjs`.

**Interfaces:** `ScanPreviewManifest` retains source/output refs and optional comparison
manifest; `acceptScanPreview(preview, expectedRevision, context): Promise<ScanGeometryRef>`
publishes atomically; `discardScanPreview(preview, context): Promise<void>` releases
only provisional ownership. Add optional `detail: ScanProcessingProgress` to progress
messages/callbacks while preserving existing fraction/stage consumers.

- [ ] Add preview-original immutability, stale revision, cancellation, active history
      seek and source-refcount tests before wiring acceptance.
- [ ] Implement leased chunk rendering with bounded detail/cache. Return stable source
      IDs from picks; source counts, bounds and operations must not depend on visible detail.
- [ ] Replace array-identity-only processing cache keys with ref/generation ownership
      for stored scans, retaining the existing resident session route and finite worker leases.
- [ ] Verify memory/disk previews, accept/cancel, selection mapping and undo/redo through
      the same shared operations. Do not evict active history or another preview's source.
      Pin `"cancel leaves original history and source unchanged"` with
      `expect(afterCancel.ref).toEqual(before.ref)` and
      `expect(afterCancel.history).toEqual(before.history)`; after Accept then Undo, require
      `expect(restoredGeometryBytes).toEqual(originalGeometryBytes)` on bounded fixtures.
- [ ] Run the standard gate and browser harness, verify cleanup and commit.

## Task 9: Stream projects, backups and MCP artifacts; enable the complete disk path

**Create:** `src/scan-project-stream.ts`, `src/automation/stream-artifacts.ts`.
**Modify:** `src/project-file.ts`, `src/project-file-codec.ts`,
`src/project-encoding-client.ts`, `src/project-decoding-client.ts`,
`src/project-backup.ts`, `src/automation/api.ts`, `src/automation/catalog.json`,
`src/automation/operations.ts`, `docs/AGENT_GUIDE.md`, `docs/MCP_ARCHITECTURE.md`.
**Test:** `tests/scan-project-stream.test.ts`, `tests/stream-artifacts.test.ts`,
`tests/scan-disk-workflow-browser.mjs`.

**Interfaces:** `writeScanProject(session, sink: WritableStream<Uint8Array>, context): Promise<void>`;
`readScanProject(source: ReadableStream<Uint8Array>, context): Promise<ProjectSession>`.
Version the new streamed project container while retaining all existing format readers.
Expose `artifact_stream_begin`, `artifact_stream_append`, `artifact_stream_finish`,
`artifact_stream_read`, `artifact_stream_cancel` through the authenticated shared API.
Use opaque stream IDs, byte offsets, per-chunk SHA-256 and at most 1 MiB decoded chunks;
keep existing message bounds and the existing 64 MiB transient pool unchanged.

- [ ] Add round-trip tests with old projects and stored geometry/history, including
      failed save, abort, missing/corrupt pages and a file larger than the transient pool.
- [ ] Implement page-based project/backup encoding and staged restore. Persist file
      contents, not local handles; pin referenced pages for the duration of save/export.
      Preserve the existing `encodeProjectFile` Blob result with a disk-backed File snapshot
      when using OPFS, rather than rebuilding an in-memory array of the whole project.
- [ ] Add stream schemas with exact offsets/checksums and ownership/expiry rules.
      Replayed identical writes succeed once; changed reuse/overlap/wrong offsets fail
      without duplicate bytes. Stream metadata stays small; geometry lives in page storage.
      Pin `"identical chunk replay is idempotent"` with
      `expect(receiptAfterRetry).toEqual(firstReceipt)` and
      `expect(finalExportBytes).toEqual(originalImportBytes)`; changed content at the same
      offset must fail without changing the committed length or accepted source.
- [ ] Expose structured resource/progress diagnostics in `job_get` and concise GUI
      progress/Cancel. Verify lock/revision/retry behavior, then enable disk loading only
      after complete load/reduce/compare/accept/undo/save/restore passes in GUI and MCP.
- [ ] Force a small budget and exceed it with full-resolution input. Assert bounded
      live bytes, real spill, unchanged data across restart and no source-proxy editing.
      Run the standard gate plus browser/contract checks; commit the enabled disk workflow.

## Task 10: Add deterministic admitted multicore execution

**Create:** `src/scan-processing-pool.ts`, `src/scan-processing-task-worker.ts`.
**Modify:** `src/scan-reduction-chunks.ts`, `src/scan-source-comparison.ts`,
`src/processing-client.ts`, `src/ui/App.tsx`, `src/automation/catalog.json`, `docs/AGENT_GUIDE.md`.
**Test:** `tests/scan-processing-pool.test.ts`, `tests/scan-multicore-browser.mjs`.

**Interfaces:** `runScanTasks<T>(tasks: AsyncIterable<ScanTask>, policy: ScanWorkerPolicy, context): AsyncIterable<ScanTaskResult<T>>`;
`ScanTask` contains `jobId: string`, `sequence: number`,
`kind: "reducePatch" | "compareBatch"`, `source: ScanGeometryRef`,
`inputPages: readonly ScanPageRef[]`, `payload: Uint8Array`, `estimatedBytes: number`;
`ScanTaskResult<T>` contains `sequence: number` and `value: T`.
`ScanWorkerPolicy` contains `maxWorkers: number` and `parallel: boolean`.
Merge in logical task order. Worker completion order must not set reduction targets
or comparison tie order. Tasks dependent on previous achieved counts remain ordered.

- [ ] Add one/two/four-worker equality tests with shuffled completions, forced page
      eviction, one failing worker, queued abort and insufficient aggregate reservations.
      Pin `"worker completion order does not change reduction or comparison"` with
      `expect(parallel.geometryBytes).toEqual(serial.geometryBytes)` and
      `expect(parallel.statistics).toEqual(serial.statistics)`; also assert the shared
      budget peak never exceeds its capacity after failures or cancellation.
- [ ] Implement central admission/backpressure, no per-worker duplicate full input,
      finite leases/checkpoint renewal and exact ownership cleanup. Never multiply the
      budget by worker count; retain a serial path when parallelism is not admitted.
- [ ] Add matching Settings controls and `settings_set` properties
      `processingParallel: boolean` and `processingWorkers: integer` (1–4). Defaults
      are true and four as a maximum; actual concurrency is additionally bounded by
      reported CPU capacity and memory admission. With no useful CPU hint use one;
      otherwise cap at `max(1, hardwareConcurrency - 2)` and the configured maximum.
      These settings schedule the same algorithm; they do not change geometry quality.
- [ ] Compare output bytes/statistics, total/peak bytes, spill and wall times on identical
      inputs. Turn parallelism on only when it improves measured workloads within budget.
- [ ] Run the standard gate and GUI/MCP browser equality checks, then commit.

## Task 11: Final integration, release gates and handoff

**Files:** Actual touched-file manifest, all new contracts/tests, agent documentation
and `tests/large-reduction-browser.mjs` (include input hash and per-phase metrics).

**Interfaces:** Consumes the validated branch and its recorded evidence; produces
reviewed integrated commit SHAs and the completion report. No new API is introduced.

- [ ] Review the full branch against the approved spec and the five Review Focus items.
      Confirm every exposed capability has GUI/MCP coverage and no casts bypass stored types.
- [ ] Run clean build, complete suite, formatting/static/contract checks and the full
      failure matrix: quota, crash/reload, cancellation, unsupported storage, concurrent
      ownership, retry, stale revision and failed persistence. Record actual counts/SHAs.
- [ ] Run the 1.15-million-face panel and available real scans with source hashes;
      report requested/achieved counts, quality constraints, stage timings, working-set
      peaks, disk usage and viewport responsiveness. Keep unlimited-size/native-parity
      claims bounded by the evidence actually obtained.
- [ ] Integrate only reviewed source commits into the active checkout after checking
      its changed files/HEAD again. Resolve shared-type/automation/UI changes explicitly;
      do not overwrite the main task or discard its dirty work. Keep port 5173 healthy.
- [ ] Verify every disposable worker/port/handle exited and temporary unreferenced
      storage is absent. Preserve accepted/history/backup data and evidence. Report local
      commit SHAs, all remaining limits and any skipped checks; do not push or deploy.

## Self-review and handoff

Spec coverage: resource/source contracts → Task 2; canonical samples → Task 3;
partition quality/output ordering → Task 4; cross-page signed comparison → Task 5;
OPFS/ownership/recovery → Task 6; stored imports/types → Task 7; preview/rendering/
history/selection → Task 8; projects/backups/MCP streaming → Task 9; multicore →
Task 10; independent baseline and final validation → Tasks 1 and 11.

No capability can be presented as shipped solely because its foundation exists.
Plan execution requires owner review of this document. Use direct inline execution;
do not offer or start subagents in this side conversation. Subsequent tasks may
proceed without another routine permission request once this plan is approved;
pause only for a material design change, new external authority or a real blocker.
