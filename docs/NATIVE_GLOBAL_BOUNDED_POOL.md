# Bounded multicore global alignment

The private global controller now admits complete evaluator-only mesh sets through
an enforced allocation ledger instead of reserving for an intermediate object
tree that this path no longer builds. The existing 512 MiB limit remains intact.
Other inputs retain the previous admission path. No unsupported ribbon command
or MCP capability is enabled by this change.

## Allocation and ordering

The bounded route requires shared transport, two or more scans, explicit empty
raw-target record lists and mesh evaluator targets without hidden-face filtering.
It supports at most 32 scans, 64 mesh targets and 16,384 source samples per pose.
These structural limits bound coordinator and query metadata. Point-cloud and
mixed raw-record routes continue through the existing admission policy.

The ledger starts with unique authored and shared input backings, including
unused bytes behind subarrays. It reserves 16 MiB for coordinator/runtime metadata
and 16 MiB per physical query worker. These are allowances, not measurements or
operating-system RSS enforcement. Every variable-size target allocation and its
construction scratch is checked before allocating. Earlier retained targets,
the final contiguous index copy and validation scratch remain charged. The fixed
small bucket tree and query scratch are covered by the runtime allowance.

Preparation runs serially, largest target first. A typed counting partition
preserves ascending native spatial-bucket order, original face order within each
bucket, and the final cross-bucket fallback. A denser private directed-edge table
preserves first-record and consumed-record behavior while avoiding an oversized
power-of-two reserve. Ordinary full adjacency retains its prior load policy.
Exclusively owned scratch is detached before the next stage; authored buffers are
never detached. Runtimes without transfer support keep unreleased storage charged
and may conservatively reject preparation.

Targets use direct packed construction and compact triangle bounds. The first
worker prepares all immutable target data once. The second receives shared data,
validates it and attaches local query scratch. Its budget begins at the first
worker's retained live total. Ready reports must contain consistent finite integer
limits and counters. Allocation failure, malformed reports, cancellation and
timeout terminate every owned worker. Queries retain source/target ordering and
the selected numeric mode; only independent source samples run concurrently.

This ledger covers the query pool's typed input/target preparation plus runtime
allowances. It is not a cap on the complete application's JS heap, process RSS,
render buffers, GPU memory, authored display geometry or later transformed output.
Machine-memory guards remain separate and unchanged.

## Native three-scan comparison

The first complete preparation attempt correctly rejected an adjacency allocation
of 67,108,864 bytes with 495,485,231 bytes already live. That failed experiment is
retained outside the repository. Changing the private table layout, rather than
the ceiling, allowed the same input set to complete.

All three retained native scan carriers contain 3,121,976 vertices and 6,147,452
triangles. The explicit owner-data preparation test verifies all nine input
carrier hashes, complete native index hashes, facet-normal hashes and reciprocal
boundary-mask hashes. Its ledger recorded:

| Counter                             |       Bytes |
| ----------------------------------- | ----------: |
| Input backings and runtime reserves | 372,701,152 |
| Retained live total                 | 521,321,360 |
| Peak including construction scratch | 533,440,547 |
| Unchanged ceiling                   | 536,870,912 |

The peak is approximately 508.7 MiB. The snapshot records accounted allocations,
not sampled process RSS. Preparation and hash verification took approximately
17.65 seconds in the final recorded run; earlier runs took roughly 11 seconds.
These durations vary with host load and are not a throughput guarantee.

The full browser replay uses `refineGlobalScanSet`, physical scene/query workers
and the staged geometry application workers. It matches all 19 original native
pass snapshots, final states and six matrix commands exactly. The port issued
439 query batches and 57 local refinements; the individual native query-batch
count was not independently captured. Two physical query workers share the target preparation. They
close before two geometry workers transform all three complete entities. All five
worker handles terminated, with no page errors, and the disposable browser closed.

The final controller replay took 171.32 seconds, including 7.34 seconds loading
and expanding the retained carriers. Main-page JS heap samples peaked at
23,210,924 bytes over 57 checkpoints. Those samples exclude worker heaps, typed
backing storage and GPU memory; the diagnostic did not render these meshes in the
editor viewport. Neither these samples nor this duration prove fast navigation or
acceptable production alignment latency. The query stage remains a performance
target.

The captured native identity-start result is non-converged. Matching it proves
fidelity for that captured case, not successful registration within tolerance.
Original native clocks and complete numeric functions were replayed through the
retained oracle; the original reader, UI and OS scheduler were not executed in
this browser check. Native setter commands were compared; original full-entity
setter output was not independently recaptured for these final poses.

GUI/MCP preview, Apply, undo/redo and timeline verification for this global
controller, successful coarse-to-fine registration, real STL/PLY/ASC import
coverage and combining the scans remain separate requirements. The existing
shared operations and MCP schemas are unchanged; there is no GUI-only algorithm.

The optional `scan-global-bounded-owner.test.ts` requires
`SCANFORGE_BOUNDED_OWNER_TARGETS` to point at the verified retained carrier folder.
It remains skipped in ordinary suites so large owner data is only loaded after
explicit resource admission.

## Validation and cleanup

The final isolated production build passed without warnings or errors, with
fingerprint `scanforge-8a48b496b670cec4`. Focused validation passed 701 tests across
13 files. The complete affected suite passed 46,438 tests with 54 optional skips
and zero failures (469 passed files, 16 skipped) in 257.20 seconds. Owned source
and tests matched the validation snapshot; unrelated working-tree edits were
preserved and excluded.

The first full-suite run caught a cleanup regression when a runtime exposes
`ArrayBuffer.transfer` but throws on invocation. The fallback now leaves that
storage charged and lets logical directory disposal finish. Its regression and
existing directory-lifetime tests pass. Complete target hashes, the controller
replay, geometry application and cancellation were rerun on the final revision.

Cancellation after the first refinement pass completed without changing any of
the 55,327,068 displayed coordinate values. All three active scene/query workers
terminated; no geometry application worker started. The disposable browser
closed. This checks the shared controller boundary, not editor undo or preview
publication.

The smaller physical-browser regression also passed 64 native query comparisons,
two changed-pose comparisons, two single-worker fallback comparisons and the
synthetic registration case. All 71 owned worker handles terminated, with no page
errors. Formatting and whitespace checks passed. The repository branding audit
removed two remaining references from an existing document while preserving its
artifact hashes and evidence IDs.

The [evidence record](evidence/native-global-bounded-pool.json) records validation
scope, source identities, accounted storage and resource cleanup. No push,
release publication or deployment was performed. The live development server on
loopback port 5173 remains available with the latest source.
