# Global alignment source eligibility

## Corrected group-command preparation (2026-10-23)

The shared GUI/MCP command now uses source mask **0** and retains boundary
vertices in sampling. Its disposable input worker returns a zeroed Uint32 flag
carrier without computing boundary adjacency. Imported topology, positions and
scanner normals remain authored data. Existing worker response validation,
resource admission, cancellation, stale checks, cached Apply and history remain
shared by the panel and `global_alignment_preview`. The existing state and
preview responses report `inputSummary.mask: 0`; no additional tool is needed.

The earlier mask-1 interpretation below was incorrect. Controller constructor
`0x140af88b0` initializes source mask `+0xa8` to zero. Preparation
`0x140aead00` copies it to `+0x60`. Command entry `0x140af89d0` copies settings
only to `+0x68..+0x87`; the value one at `+0x80` is the raw target index stride,
not the source mask.

A later passive GUI capture observed all three preparation tasks, each with
marker mask zero. At the actual mesh-interface return site `0x140aeb049`, every
temporary group returned null. The conditional path that clears flags and calls
the boundary marker was therefore skipped. Each group was bound to its unique
original owner through a checked one-member list. The observer read 464 metadata
bytes, called no native functions, read no geometry payloads, completed all three
returns and verified restored code anchors after detaching. Its bounded mock
suite passed 24 cases. This capture is a separate run from the numerical replay.

Using mask zero and preserved captured owner flags, the full-size first-run
numerical replay matches all 96 angular sample counts, consumes all 3,901
recorded sampler clocks and reproduces all 45 ordered query results: 31,463
records with identical source/target coordinates, distance bits and active
state. Sample totals are 1,394, 1,446 and 1,625. All 6,663,164 reconstructed
facet normals also match. The previous mask-1 preparation failed this comparison.

The [evidence record](evidence/global-fine-source-mask-query-replay-20261023.json)
separates static field checks, the later live preparation observation and the
earlier numerical replay. The replay uses captured native vertex normals,
recorded clocks and query-entry poses. It exercises the scene/query cores, not
the public worker coordinator, normal derivation or complete GUI/MCP workflow.
It took 14,445 ms and peaked at 526,028,800 bytes across its owned Job under the
unchanged 4 GiB cap and 25% CPU quota. Owned processes exited and handles closed.
These measurements are not a browser memory bound or full alignment acceptance.

An additional connected replay uses the actual input-preparation core's derived
normals and zero flags, supplying no captured labels to scene preparation. All
45 queries and 31,463 records still match exactly. A separate full input-core
comparison checks all 10,144,365 vertex-normal Float32 values with zero differing
words and unchanged input buffers. The connected run took 15,761 ms and peaked
at 524,152,832 bytes under the same owned Job limits. Recorded clocks and query
poses remain environmental inputs; public scheduling and rendering are excluded.

Application regression tests cover zero flags across the 33 retained topology
cases, boundary inclusion in the real sampler, exact flag-storage admission,
unchanged authored buffers and actual shared input preparation through the MCP
operation/state contract. Before correction, 36 focused tests failed on the
expected behavior. After correction, all 114 focused tests and 47,709 full-suite
tests passed, with 64 skips. Production build `scanforge-2de97bc109bac489` and CAD
smoke passed. The MCP unit transport harness executes the worker core but mocks
worker transport and the outer solver. Rendered GUI/MCP comparison
for this correction remains outstanding; this candidate is not complete or
ready to commit under repository parity requirements.

## Historical boundary-mask implementation (superseded)

The following sections retain the earlier implementation and its validation
history. Their source-mask and group-dispatch interpretation is superseded by
the evidence above. The adjacency fixtures still establish the generic builder's
behavior; they do not establish that this group command invokes that builder.

Shared GUI/MCP Global Fine Align input preparation now supplies the source
exclusion flags already supported by the scene sampler. Previously omitted
flags made every indexed vertex eligible for mask-1 sampling, including native
boundary endpoints. Imported topology, positions and scanner normals remain
authored data; flags belong only to the disposable command input.

## Native preparation evidence

The retained PLY import dispatcher `0x1402f67e0` constructs owner `0x14088aac0`,
reads into its existing geometry, and schedules the point evaluator through
`0x1407bafd0` after publication. Current-image analysis of the owner constructor
confirms base geometry `0x140b353e0` at owner offset `+0x160`.

Evaluator worker `0x1407b9950` conditionally calls geometry virtual `+0x68`
before building the evaluator. The base table resolves this slot to adjacency
builder `0x140b38e30`; its readiness byte is initially clear and becomes set
after construction. The Global command `0x14080bd60` waits for the existing
evaluator's completion before preparing its groups and controller.

Controller preparation `0x140aead00` clears command-mask and bit-4 vertex flags
and calls geometry virtual `+0x70`. The base table resolves this to `0x1401dfed0`,
which marks both endpoints of each null facet-neighbor slot with the command
mask. The public command uses mask 1. Rebuilding adjacency first matters: freshly
inserted facets have null neighbor pointers even on closed surfaces.

The native pointer-presence fixtures independently constrain the existing
`nativeBuildAlignmentNeighbourMasks` builder. The source flags use those exact
directed slots, including spatial bucket order, cross-bucket fallback and the
first reverse-edge record's single consumption. Ordinary undirected edge counts
would give different results for duplicate and non-manifold faces. Unused
vertices remain unflagged.

This combines retained import-path evidence with current-image constructor,
readiness, adjacency, command and flag bodies. It establishes the static ordinary
PLY base-mesh route. That earlier capture did not establish live readiness,
all edit invalidations, or native final three-scan controller matrices and
geometry. Derived mesh classes
can have a different virtual `+0x68` implementation.

## Current native readiness snapshot

A later passive metadata check on the installed version verifies the three
loaded ordinary PLY owners, their base geometry tables, exact vertex/facet
counts, and geometry byte `+0x108`. That byte is `1` on all three meshes in
two matching reads. Geometry virtual `+0x68` resolves to `0x140b38e30`, and
virtual `+0x70` resolves to `0x1401dfed0`, matching the static route above.

Fresh REA analysis of the adjacency builder confirms its write of `1` to
`+0x108`; direct instruction checks bind the incoming mesh pointer to that
store. The vertex clear helper performs `flags &= ~requestedMask`. The base
boundary marker then ORs its requested mask into both endpoints of null
facet-neighbor slots. These operations do not convert hidden vertex bit `8`
into sampling mask `1`. The marker's bytes were decoded directly; this
Ghidra import did not recover that entry as a procedure.

The [sanitized evidence](evidence/global-alignment-current-readiness.json)
pins the static and installed executable hashes, two REA records, passive
receipt/helper hashes, ten instruction anchors and two virtual-table slots.
Two mutated instruction controls and four invalid metadata controls are
rejected. All 276 sampled code bytes match the saved image. The metadata
helper made 68 region queries, peaked at 14.58 MiB under its 4 GiB/25% CPU
Job, and closed both handles. It did not assign the target to a Job, call
native functions, or read vertex/facet buffers. The analysis provider was
closed after exporting its evidence.

This establishes live readiness only for the observed current state. It
does not establish readiness invalidation after every edit, a starting-geometry
baseline, per-setter matrices, clock/query inputs, or full solver equivalence.
Shared GUI/MCP preparation behavior and schemas are unchanged. No build,
unit/CAD suite or browser replay was rerun for this evidence-only update.

## Ownership and limits

The finite-lived preparation worker returns a separate Uint32 flag array,
four bytes per indexed vertex. ArrayBuffer outputs transfer; shared outputs
remain shared. Response validation requires one flag per vertex. Existing
preview cancellation, stale-source checks, cleanup, history and cached Apply
semantics serve both GUI and MCP.

The existing 512 MiB metadata estimate includes returned flags. A synchronous
allocation scope checks actual neighbor-mask, partition and edge-directory
allocations and growth overlap, plus returned flags, before allocation. Existing
authored carriers, earlier outputs, current normal output, copied inputs and
a 1 MiB runtime reserve form the baseline; future derived outputs are excluded.
The fixed bucket tree uses the runtime reserve. Temporary mask storage remains
charged until worker teardown. These are logical buffer limits, not process
RSS/heap limits or a garbage-collection guarantee.

## Validation

Build passed (`scanforge-e2abf5fe62a6e7be`) with 1,845 identical compiler inputs
before and after. Focused checks passed 115 tests in six files. The full suite
passed 47,542 tests, with 61 existing skips. Regressions compare source flags with
all 33 captured native neighbor-pointer cases, preserve source buffers, exercise
storage failure, reject missing worker flags, check sequential reservations and
connect prepared flags to the real source sampler.

The original-three public browser replay imported all 6,663,164 faces, completed
GUI Global Fine Align Preview and cached MCP Apply, and verified complete authored
geometry digests and Undo/Redo. GUI and MCP reconstruction at 0.5 mm produced
identical geometry hashes, topology and diagnostics: 328,542 faces and seven closed
components, with no boundary, non-manifold, winding, duplicate or degenerate
defects. Targets stayed unchanged; Undo restored all 15 aligned authored carriers.

The unchanged 4 GiB Windows Job cap admitted the full run. Peak committed memory
was 2,941,894,656 bytes (2,805.61 MiB). All 17 owned processes exited, the Job
reached zero active processes, handles closed, and cleanup/capture errors were
empty. This is a measured run, not a universal peak bound or a controlled memory
comparison with a previous run.

The controller stopped stable after three passes but reported `converged:false`.
Its mean diagnostics were approximately 0.07087, 0.02310 and 0.02976 mm. These
are not independent accuracy measurements. Sampling uses clocks, so successive
runs do not establish numerical A/B causality. Seven closed components do not
establish one solid; self-intersections are not certified. Reconstruction remains
an independent voxel implementation. Final native controller/geometry parity and
native GUI capture remain open; this correction does not close the milestone.
