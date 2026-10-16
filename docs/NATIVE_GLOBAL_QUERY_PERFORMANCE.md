# Bounded repeated-triangle suppression

Global alignment indexes store a triangle in multiple intersected leaves. A
profile of the three complete retained scan carriers attributed approximately
60% of query time to leaf evaluation, 24% to triangle distance and 12% to node
traversal. An instrumented baseline counted 45,579,330 leaf evaluations across
46,020 per-target queries, including warmup. A 1,024-slot visited table found
9,705,750 repeated visits (21.3%). Instrumentation timing is not a benchmark.

The packed traversal now accepts an optional query-local visited table. The
immutable triangle provider owns one 4 KiB block, allocated through the active
native storage ledger. Each query clears it. Hash collisions evict entries;
they cannot equate different triangle IDs. Mesh size does not increase its
storage requirement. The maximum admitted 64 mesh targets require 256 KiB per
physical query worker. Immutable shared target data does not include the memo.

For a fixed query point and immutable geometry, a previously evaluated triangle
cannot become a better result at a smaller winning radius:

- A rejected box remains rejected when its radius decreases.
- A clipped plane remains clipped. At ordinary radii, its Float32 cutoff value
  cannot win the strict nearest-hit comparison.
- A computed distance that failed to win cannot win at a smaller radius.
- A winning distance becomes the new radius, so its repeat cannot win a strict
  comparison against that radius or a smaller one.

Skipping the repeated callback therefore preserves the winning triangle,
distance, projection, edge flags and native tie order. It does not rearrange
node traversal or floating-point arithmetic. Queries require exclusive,
non-aliasing scratch and an immutable query point. The ordinary record traversal
and callers that do not opt in retain their existing callbacks.

There is a necessary exception: above the Float32 cutoff, a later clipped value
can itself become a winner. The memo is disabled for that route. A regression
reproduces this radius-dependent behavior and compares its result with the
uncached traversal, including stale projection scratch.

Additional regressions cover repeated memberships, query resets, hidden-face
filter changes, colliding IDs, exact native fixture bits and allocation limits.
The memo does not retain caller scratch references or allocate per query.

This is an internal change to the shared global-registration kernel. Public
GUI/MCP schemas and command gates are unchanged. Successful coarse-to-fine
alignment, the remaining seeded native comparison, GUI/MCP preview and Apply,
history, mixed input imports and combining scans remain open requirements.

## Verification

The final isolated build passed without warnings or errors. Focused validation
passed 2,166 tests in 17 files. The full affected suite passed 46,444 tests with
54 optional skips and no failures in 220.63 seconds. The optional owner-data
preparation check passed all nine retained input hashes and all three complete
native index, facet-normal and neighbor-mask hashes. Its peak accounted storage
was 527,923,964 bytes under the unchanged 536,870,912-byte limit. Source and
regression bytes matched the isolated validation snapshot; unrelated changes
were excluded.

The coarse-seeded port preparation also passed with its additional memo storage:
peak accounted bytes were 535,893,636 under the same 536,870,912-byte limit. Its
target hashes are retained for the pending seeded native comparison; this
preparation run does not constitute that comparison.

A final paired benchmark prepared the targets once and alternated four original
and four optimized query rounds in one process. Each round queried all three
sources. Mean times were 722.129 ms and 632.050 ms, respectively: a 12.47%
reduction. Every returned result matched. A separate instrumented replay counted
35,873,580 leaf evaluations instead of 45,579,330, with identical results and
the same 46,020 target queries. These timings exclude preparation and vary with
host load; they do not measure viewport navigation or the complete user workflow.

The physical browser replay uses the current `refineGlobalScanSet` controller,
two query workers and the staged application workers. All 19 native pass
snapshots, final states and six matrix commands match the committed native
fixture exactly. It issued 439 query batches and 57 local refinements and staged
all three complete entities. The replay took 143.98 seconds. All five worker
handles terminated, the disposable browser and its listener exited, and no page
errors were recorded. Main-page heap samples peaked at 23,085,124 bytes over 48
observations; these exclude worker heaps, typed backing buffers and GPU memory.
The diagnostic did not render the loaded meshes in the editor viewport.

The original native case remains non-converged. This is a fidelity check of
that case, not proof of successful registration. Original reader/UI behavior,
the original OS scheduler and complete native geometry-setter output were not
captured by this browser check. Original source files were not freshly rehashed;
the retained carriers were verified against their recorded identities.

The [evidence record](evidence/native-global-query-performance.json) pins the
source and fixture hashes, timings, allocation reports and worker cleanup.
