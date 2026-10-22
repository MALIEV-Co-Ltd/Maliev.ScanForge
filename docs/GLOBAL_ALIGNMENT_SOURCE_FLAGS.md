# Global alignment source boundary flags

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
PLY base-mesh route; it does not capture live readiness, all edit invalidations,
or native final three-scan controller matrices and geometry. Derived mesh classes
can have a different virtual `+0x68` implementation.

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
