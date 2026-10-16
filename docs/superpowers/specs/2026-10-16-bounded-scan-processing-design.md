# Bounded-memory polygon reduction and disk-backed scans

Date: 2026-10-16
Status: Owner approved on 2026-10-16. Plan execution approved; implementation is in progress.

## Outcome

Polygon reduction should adapt its working set to available resources rather than
reject valid scans at an arbitrary triangle or index-node ceiling. Scans larger
than the resident processing budget should use local disk storage and bounded
workers. Preview, comparison, acceptance, undo, save and MCP must use the same full
source geometry. Display sampling must never silently become processing input.

This is not a promise of infinite capacity: browser storage quotas, disk space,
coordinate validity and representable IDs remain real constraints. A shortage
must preserve the original, release temporary resources and give a specific,
recoverable error. Increasing a failed memory guard is not the implementation.

## Current evidence and gaps

- `scan-reduction-partitions.ts` limits local topology to 8,192-triangle patches,
  but still keeps global spatial-order arrays, an input-sized output buffer and
  another compacted output buffer in memory.
- `scan-preview.ts` calls `analyzeMesh` on the complete original before reduction,
  retaining object-rich topology for comparison and original-corner colors.
- The pending comparison fix uses a BVH for large reduced surfaces and retains
  the recovered numerical distance kernel. Its buffers still scale with the
  complete reduced mesh; it is not an out-of-core implementation.
- `Entity.positions`, processing requests and rendering expect resident arrays.
  `Revision` retains entity snapshots. Spilling only one algorithm cannot make
  import, history or final rendering work beyond RAM.
- Browser-local disk-backed geometry is not implemented in the inspected source.
- The isolated 600 x 300 mm curved-panel replay completed GUI preview, comparison
  and acceptance for 1,152,000 input triangles in 26.9 seconds, producing 996,352
  triangles. A subsequent direct MCP reduction/comparison produced 977,492
  triangles in 21.3 seconds. Preview retained the original and no browser errors
  occurred. This verifies completion of the node-budget fix, not 50% target
  attainment, unlimited size, or native parity of the scalable path.

## Options and recommendation

1. **Resident bounded processing first, then browser-local disk backing.** Keep
   existing small-scan behavior, remove global topology from reduction previews,
   and introduce a common chunk interface before adding disk storage. This is
   recommended: it improves current scans and establishes measurable gates for
   the larger storage change without requiring a server.
2. **Backend processing service.** This can support server disks and larger jobs,
   but requires infrastructure, upload policy, authentication, costs and another
   deployment. Those are outside the current frontend-only authorization.
3. **Raise limits and rely on the browser heap.** Reject this approach: it merely
   moves the failure and makes the UI less reliable under memory pressure.

## Boundaries and contracts

### Immutable chunked geometry

Introduce a `ScanGeometrySource` interface with immutable identity, generation,
units, full-resolution counts, bounds, a chunk directory and cancellable range
reads. Provide resident-array and OPFS-backed implementations. Local triangle
indices remain 32-bit; stable global IDs use safe integers across chunks.
Coordinates retain their existing precision and millimetre units.

Do not represent a file-backed scan as an empty `positions` array. Add an explicit
geometry reference and migrate consumers through adapters. Existing array-backed
entities and saved project formats must remain readable. File-backed geometry
references are application-owned opaque IDs, never arbitrary caller paths.

### One resource coordinator

Use one aggregate working-set budget for geometry caches, processing scratch,
comparison pages and concurrent workers. Admission must account for source and
result copies, native working records, render staging and transfer buffers.
Browser device-memory hints are coarse; they are not measurements of free RAM.
Start conservatively, measure actual allocation high-water marks, and admit more
workers only when both CPU capacity and the aggregate memory estimate allow it.
Report already-resident project/history storage separately from incremental
scratch. Phase 2 can bound additional processing allocations; it cannot claim to
bound total application memory while legacy source buffers remain resident.
After file-backed storage is enabled, resident geometry is an evictable cache.

Bounded processing is not a new total-scan-size ceiling. Backpressure pauses chunk
production while consumers or disk writes catch up. Never start duplicate workers
or lower a failed admission guard to obtain capacity.

### Reduction and comparison

- Reuse the existing verified reduction kernel inside admitted patches. Preserve
  deterministic spatial ordering, source IDs and patch-boundary ownership.
- Make partitions connectivity-aware. Distinguish fans disconnected by an
  artificial spatial cut from genuinely invalid source topology, and avoid
  retaining an entire healthy patch because of that cut. Any local fan separation
  must keep shared positions fixed and prove unchanged seams; never silently
  repair genuinely invalid source geometry. Measure achieved/global target counts
  on the curved-panel fixture, not only successful job completion.
- Replace global ordering arrays with bounded sorted runs and a stable external
  merge for disk-backed input. Append reduced output chunks instead of allocating
  an input-sized output buffer and slicing it afterward.
- Sample the original for comparison through a source iterator; do not build full
  original adjacency just to calculate distances or colors. Preserve current
  unique-vertex statistics by streaming a deterministic vertex directory, rather
  than changing the report to count triangle corners.
- Use a top-level spatial directory over reduced chunks, local BVHs, bounded LRU
  pages and query batches ordered for locality. Index metadata must also support
  paging if it exceeds its budget. Do not split comparison into independent local
  nearest-neighbor searches that omit closer triangles in adjacent chunks.
- Keep the existing signed triangle-distance evaluator, tolerance rounding,
  palette/search-radius rules and unmatched-sample accounting. Preserve the
  existing small-scan recovered traversal path. For the scalable BVH path, resolve
  equal-distance candidates by stable global source-triangle order, matching its
  current documented policy across worker and page boundaries.
- Actual achieved counts and protected topology remain explicit. Topological
  constraints may prevent an exact requested count; do not report a target as
  achieved when it was not, discard unsafe regions, or fabricate statistics.

### Preview, rendering and history

A preview owns a provisional geometry manifest and derived comparison pages.
The original stays immutable. Accept publishes a validated manifest atomically;
Cancel deletes only that preview's unreferenced temporary data. Undo and redo
retain immutable geometry references with reference counts instead of requiring
every version to remain resident.

Render from a bounded chunk cache with view-dependent detail. Display counts must
distinguish rendered detail from full-resolution source and accepted counts.
Picking and selection must resolve to stable original IDs. Editing uses source
chunks, never the displayed approximation. Grid bounds and summary statistics
come from validated metadata, without rescanning all geometry during navigation.

Operations not yet migrated to chunk access must advertise their storage
prerequisites through the shared command-availability contract. Do not let them
silently operate on a display proxy. Enable file-backed import only when the
advertised initial workflow can load, reduce, compare, accept, save and undo it.

### Local storage, persistence and recovery

Use OPFS in dedicated workers when supported. Keep temporary job data separate
from accepted geometry, user projects and backups. Check storage estimates before
large writes, handle quota errors during every write and never delete another job
or persistent user data to make room.

Manifests track owner/job ID, geometry generation, chunk checksums, state, leases
and references. Use renewable worker leases and a supervisor deadline; progress
messages renew active work. Cancellation closes handles and terminates exact
owned workers after cooperative shutdown. Startup recovery removes only expired,
unreferenced temporary chunks and preserves accepted/history/backup references.

Project export and backup must stream geometry pages and include their contents,
not machine-local OPFS handles. Import/restore must validate checksums and rebuild
storage references. Preserve compatibility with existing saved projects.
Browsers without the necessary storage capabilities retain the resident path and
return an actionable capability/resource error for workloads that exceed it.

### GUI and MCP parity

Keep GUI Reduce polygons and `mesh_process` on one operation implementation.
Retain revision checks, retry protection, cancellation, locks and history behavior.
Expose structured phase, processed/total work, working-set estimate/budget,
resident/disk mode, spill usage, achieved count and failure category through job
inspection. GUI shows concise progress and Cancel; it needs no extra menu entries
for individual storage pages or worker mechanics.

If a new storage capability or processing policy becomes caller-configurable,
update the shared schema, discovery, GUI control and agent documentation together.
Do not introduce a GUI-only storage mode or silently change geometry contracts.

The existing transient-artifact pool has a 64 MiB aggregate limit. Large MCP
imports/exports therefore need manifest-backed streaming artifact sessions and
bounded range transfers, not a larger in-memory pool or one giant base64 message.
Retain current authenticated-origin checks and request-size bounds. Use ordered,
idempotent chunk receipts, checksums, job ownership, quotas and cancellation so a
retry cannot duplicate or corrupt data. The GUI file path and MCP streaming path
must converge on the same validated geometry source and import semantics.

## Delivery sequence and review gates

1. **Preserve the current reduction bug verification.** Original native comparison
   tests are restored, large-surface regressions are separate, and the exact
   node-budget regression plus 1.15-million-triangle GUI/MCP replay have completed.
   Keep these gates when changing storage or partitioning. The achieved count on
   the panel remains above its 50% target and is an explicit next-phase issue.
2. **Bound processing of already-loaded scans.** Add allocation accounting and the
   resident chunk adapter; remove full-original adjacency from reduction preview,
   stream unique sample statistics/colors, and bound output assembly. Measure
   source, preview, index and renderer peaks separately. This phase alone must not
   be advertised as loading scans larger than RAM.
3. **Add the disk-backed geometry foundation.** Implement OPFS ownership,
   manifests, quota handling, reference lifetimes, recovery, streaming import and
   explicit file-backed entity adapters. Keep this mode gated until phase 4.
4. **Complete the disk-backed workflow.** Connect external patch ordering,
   reduction, paged comparison, bounded rendering/selection, atomic acceptance,
   history and streamed project/backup save and restore. Enable only after GUI
   and MCP end-to-end checks pass.
5. **Add measured multicore scheduling.** Parallelize independent admitted patches
   and comparison batches with deterministic merging. GPU compute is a later
   optional lane, gated by numerical tests; it is not needed for correctness or
   the disk-backed fallback.

The main task is currently editing shared geometry types and processing-related
files. Product implementation must use an isolated checkout or explicitly
coordinated file ownership; do not overwrite or commit its unrelated work.
Each phase needs a separate buildable, validated commit boundary.

## Acceptance and validation

- Small/native fixtures retain current geometry bytes, distance results, colors,
  rounding and reported statistics. Test ties, open boundaries, invalid facets,
  repeated coordinates and unmatched samples explicitly.
- Resident and disk implementations produce equivalent results for identical
  chunk layouts and logical worker counts. Scheduler concurrency and cache
  eviction must not change output ordering, global target calculation or ties.
- Force a small processing budget in tests so many source/index/output pages must
  spill. Instrument live bytes and assert bounded high-water marks as scan size
  grows; reducing the displayed mesh is not evidence of bounded full-resolution
  processing. Include a real workload beyond the chosen resident budget.
- Verify GUI preview leaves original geometry unchanged, comparison completes,
  Accept publishes a smaller valid scan, Cancel releases temporary files, and
  undo/redo/save/restore preserve the full geometry. Compare the same operation
  through MCP, including progress, cancellation and failures.
- Exercise quota exhaustion, abort during each phase, worker crash, reload,
  expired-job cleanup, unsupported storage, concurrent jobs and failed saves.
  Persistent geometry and other jobs' data must survive every case.
- Record hardware, input hashes/counts, time per phase, allocation peaks, disk
  usage and navigation responsiveness. Keep the app on port 5173; isolated test
  browsers and helpers get finite leases and verified cleanup.
- Build first, then focused tests, affected suite, static/contract checks and
  browser verification for each coherent product change. Do not publish a
  capability or claim native parity based solely on a proposed design.

## Approval record

The owner approved this design and its resident-first, browser-local OPFS direction
on 2026-10-16. The owner also approved the implementation plan for direct execution in this
session; subagents are prohibited by the side-conversation boundary.
No backend deployment, production publication or unbounded resource use is
included in this proposal.
