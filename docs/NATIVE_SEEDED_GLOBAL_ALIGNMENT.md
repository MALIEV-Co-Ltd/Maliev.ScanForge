# Seeded three-scan controller verification

The complete seeded numerical alignment controller now matches original native
execution through a fresh browser replay of the application implementation.
[The evidence record](evidence/native-seeded-global-alignment.json) retains input,
probe, native result, browser result and source hashes, all 19 native pass
snapshots, final states, six matrix commands, storage reports and cleanup receipts.

The three retained STL-derived inputs contain 3,121,976 vertices and 6,147,452
triangles. Nine position, normal and triangle carriers were freshly hash-checked.
Original scan files were not freshly rehashed. The application supplied the
previously retained PCA/trimmed-ICP coarse poses; this capture does not establish
native coarse-alignment parity. Radius is 5 mm, local tolerance is Float32 0.001,
coverage tolerance is Float32 0.05, and the controlled outer clock is 424242.

## Exact comparisons

The native outer controller at `0x140af8cb0`, its original local/query routines
and complete scene preparation ran on all three inputs. The fresh browser used
the private shared application controller and physical query/application workers.

| Compared output                                                   | Result |
| ----------------------------------------------------------------- | ------ |
| Pass count and all 19 ordered pass snapshots                      | Exact  |
| Three final poses, means, coverage and state flags                | Exact  |
| Six ordered matrix application commands                           | Exact  |
| Three complete index hashes, node and membership counts           | Exact  |
| Three complete facet-normal hashes and three neighbor-mask hashes | Exact  |
| Nine retained input carrier hashes                                | Exact  |

The browser performed 476 query batches and 57 local refinements with two physical
query workers, then staged all three full scan entities. All five workers
terminated, authored source references were preserved, and browser errors were
empty. A separate fresh preparation check compared every complete target index,
normal and mask hash against the new native capture. The first two inputs retain
canonical pre-placement index metadata; that metadata was not used as the oracle
for their transformed geometry.

## Alignment quality remains distinct from numerical parity

Both implementations report non-convergence and instability for all three scans
with these supplied coarse poses:

| Scan |   Mean distance, mm | Coverage below Float32 0.05 mm |
| ---- | ------------------: | -----------------------------: |
| 1    |   0.958862667124237 |                             3% |
| 2    | 0.24321795321229028 |                            25% |
| 3    | 0.27829953515564104 |                             9% |

No numerical difference was found to fix in this replay. The result does not
establish a successful final alignment or an accurately combined mesh. Initial
placement and public workflow verification remain necessary. A subsequent
[complete native setter comparison](NATIVE_SEEDED_GLOBAL_SETTERS.md) verifies
the indexed and expanded render positions and normals for all six captured
matrix applications; it does not establish successful final alignment.

## Resources and validation

The native run completed its iterative controller in 84.21 seconds after scene
preparation. Peak tracked native allocation was 1,576,567,260 bytes under the
unchanged 1,610,612,736-byte cap. Native admission required 6 GiB headroom; the
original 4 GiB host and 1 GiB runtime guards remained intact. Native allocations,
exception handlers and helper mappings were released, with zero retained bytes.

The fresh browser controller completed in 147.55 seconds. Its query workers
reported peaks of 535,893,636 and 527,834,577 bytes under their respective
536,870,912-byte target-storage caps. Those caps do not bound the whole browser.
Main-page heap peaked at 25,617,216 bytes over 49 samples; that excludes worker
heaps, typed-array backing stores and GPU storage. These timings have different
measurement scopes and are single observations, not a native/browser speed claim.

Capture parents, the native process and the dedicated browser process were
independently absent after completion. The temporary browser listener was closed.
The user-facing application remained on port 5173.

The associated coverage-default correction passed an isolated build with zero
warnings/errors, 73 focused tests with 3 skips, and 46,461 full-suite tests with
54 skips and zero failures. The additional complete seeded-target comparison
passed separately. This evidence-only capture adds no application code or public
schema; its validation is the native/browser comparison and retained-artifact
readback, not another application build.

## Remaining boundaries

Native allocator, iterator, metadata and serial OS scheduling adapters were
controlled. Original importers, installed UI and the original OS scheduler were
not executed. Native geometry setters were recording adapters during this
controller capture. The subsequent [setter capture](NATIVE_SEEDED_GLOBAL_SETTERS.md)
executed the actual native geometry setters with the original concurrency runtime
and compared their complete position/normal output with the current application
staging kernels. Its installed-UI, scheduling and import limits are documented
separately.

Meshes were staged through private operations and were not rendered in the
editor. Public GUI/MCP Preview, Apply, cancellation, undo/redo and timeline
verification remain outstanding, as do mixed STL/PLY/ASC import workflows,
combining/exporting scans and successful final alignment against an independent
reference. This numerical milestone does not complete the broader application goal.
