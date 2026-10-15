# Alignment performance and full-scan multicore verification

The complete PLY 2 and PLY 3 scans from the supplied example folder match the
retained native PLY 1 registration results on both one physical thread and two
physical browser workers. Both modes retain two logical lanes, native reduction
order and persistent flags. Initial errors, accepted matrices, optimizer
parameters and final position/normal buffers agree exactly. Input coordinates,
indices and supplied normals remain unchanged.

The following table retains the initial object-tree transport baseline. The
subsequent shared packed transport and its observations are described below.

| Moving scan |  Vertices | Triangles | Serial processing | Two-worker processing |
| ----------- | --------: | --------: | ----------------: | --------------------: |
| PLY 2       | 1,375,494 | 2,697,877 |           1.839 s |               2.233 s |
| PLY 3       | 1,865,848 | 3,691,133 |           2.395 s |               2.444 s |

These are individual diagnostic observations, not a demonstrated multicore
speedup. The kernel call includes preparation and processing, but excludes file
fetch/import, hashing and frontend interaction. The harness imports the current
shared kernel from the development server and executes its built production
query-worker bundle. It uses an isolated disposable page. Original native
capture wall times have different harness costs and are not compared here.
Full results and before/after observations are retained in
[evidence/owner-multicore-alignment.json](evidence/owner-multicore-alignment.json).

The captured three-landmark regions contain 1,773 and 1,877 active query
vertices respectively. All full-resolution vertices and normals are transformed
and hashed; these measurements concern native seeded point-pair refinement,
not whole-surface Fine align. Older generic-refinement captures regenerate
normals from XYZ-only input; their replay adapter explicitly omits scanner
normals to preserve that original capture contract. The scanner-normal-preserving
landmark path is checked independently.

## Shared packed query trees

The isolated-origin worker path now packs the immutable target tree into three
shared arrays: nine Float64 bounds/center values per node, eleven Uint32 link
and range values per node, and ordered Uint32 triangle memberships. Workers
query these arrays directly; they do not reconstruct object trees. Native child
priority, membership order, strict distance comparisons and signed winners are
preserved. Nonisolated origins retain the existing object-tree transport.

The unchanged 128 MiB admission includes the parent object tree, one shared
packed tree, owned target buffers and source lanes. It does not count shared
buffers once per worker or require transient object-tree clones. Both admitted
isolated workers can initialize together. Oversized targets still use the
existing serial fallback; the device-memory and cancellation guards remain.

For the supplied PLY 1 target, 76,761 nodes and 720,056 memberships occupy
11,784,500 packed bytes. The first packed replay observed target posting of
0.20-0.38 ms per worker and readiness around 12 ms, compared with roughly
80-130 ms posting plus setup for the earlier object transport. Full-call
observations were 1.543 s serial / 1.708 s two-worker for PLY 2 and
2.073 s serial / 1.859 s two-worker for PLY 3. These are individual observations,
not a statistical overall speedup claim. Preparation, tree construction and
full-buffer transforms still contribute to latency. These measurements concern
seeded refinement, not whole-surface Fine align or installed-native UI timing.

The native tree-query capture checks every winner and signed distance for 33
cases. The new and existing decoded queries also agree on complete triangle
callback order; that callback trace is not independently captured from native
execution. Pool tests run native captured objectives on both object and packed
transports. The full supplied-file replay checks unchanged
inputs and exact native output hashes. GUI and MCP use the same pool and
existing operations, with no new public tool or parameter required.

## Reproduce

Keep the development application running on loopback port 5173 and build its
production worker bundle first. The benchmark requires 3,072 MiB free before it
starts and uses a seven-minute lease. It serves only the three expected PLY
files through a temporary loopback reader, grants loopback permission to its
own disposable context, and closes browser workers and the reader in finally.

```powershell
$env:SCANFORGE_ALIGNMENT_EXAMPLES = 'B:\temp\alignment-example-files'
node --max-old-space-size=768 tests/alignment-owner-multicore.mjs
```

The readable receipt is `.resources/alignment-owner-multicore/validation.json`.
The packed replay and its retained native provenance are recorded in
[evidence/alignment-packed-tree-transport.json](evidence/alignment-packed-tree-transport.json).
The test is opt-in and fails clearly when the supplied files, exact native hashes,
development modules or production worker bundle are unavailable.

## Previous baseline validation

Build `scanforge-f9dd583201c63fd8` passed. The focused concurrency/native-math
checks passed 42 tests; the regenerated-normal owner regression passed 54 tests.
The complete suite with `SCANFORGE_ALIGNMENT_EXAMPLES` set passed all 28,245
tests across 365 files with no skips. Six older fixture-adapter failures were
resolved by matching their original XYZ-only/rebuilt-normal input contract;
no expected native values or production scanner-normal behavior were changed.
The isolated-origin GUI/MCP replay passed native STL import, seeded two-worker
alignment, exact CAD, visible-scene/empty-target/authoring-root behavior,
normal/topology retention and Undo. Resource receipts show workers, disposable
browser and loopback reader closed. Port 5173 retains the live application.

## Packed transport validation

Build `scanforge-4fd227083888fd39` passed. The focused tests passed 54 checks
across eight files. The complete suite with the supplied examples enabled passed
28,257 tests across 366 files with no skips. The isolated GUI/MCP replay passed,
including actual multicore seeded refinement, CAD, scene roots, persistence and
Undo. Two full supplied-PLY benchmark runs retained exact native matrices and
final coordinate/normal hashes in both serial and two-worker modes.

The repeated run observed 1.706 s serial / 2.234 s two-worker for PLY 2 and
2.207 s serial / 2.371 s two-worker for PLY 3. Target posting remained below
0.5 ms per worker, and workers became ready in 10-14 ms. This repeat reinforces
the distinction between reduced transport overhead and overall alignment speed:
the latter is still variable and is not consistently faster with two workers.
Temporary benchmark and GUI/MCP processes/listeners exited; port 5173 remains
live. Scoped formatting, syntax, whitespace and prohibited-token checks passed.
