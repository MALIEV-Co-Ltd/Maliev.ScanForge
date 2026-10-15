# Alignment performance and full-scan multicore verification

The complete PLY 2 and PLY 3 scans from the supplied example folder match the
retained native PLY 1 registration results on both one physical thread and two
physical browser workers. Both modes retain two logical lanes, native reduction
order and persistent flags. Initial errors, accepted matrices, optimizer
parameters and final position/normal buffers agree exactly. Input coordinates,
indices and supplied normals remain unchanged.

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

## Bounded worker initialization

Shared-buffer origins can post both target initializations before waiting for
acknowledgements when a conservative five-tree-copy peak estimate fits the
existing 128 MiB pool budget. Otherwise initialization remains sequential.
The ordinary three-copy pool-admission estimate and all memory limits remain
unchanged. Barrier, cancellation, failure and memory-bound regressions verify
startup order and cleanup. Worker responses still reduce in logical lane order.

The actual PLY 1 target has 76,761 nodes and 720,056 ordered triangle memberships.
Its five-copy estimate is 147,617,870 bytes before source lanes, so these full-file
cases correctly retain sequential initialization. Two workers perform the query
phase. Copying each target tree costs roughly 80�130 ms in the observed runs,
with additional deserialization/setup time. Smaller admitted targets can overlap
startup. These observations do not establish an overall speed improvement on
the supplied full scans. Compact immutable tree transport and preparation reuse
remain the next performance work for this workload.

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
The test is opt-in and fails clearly when the supplied files, exact native hashes,
development modules or production worker bundle are unavailable.

## Validation

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
