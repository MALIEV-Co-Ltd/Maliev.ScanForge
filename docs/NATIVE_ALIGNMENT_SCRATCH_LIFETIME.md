# Release alignment adjacency scratch after construction

The native-compatible directed-edge directory is needed only while linking
adjacency. Its final key/value buffers previously became unreachable after the
builder returned, leaving their release to garbage collection. Rehashing already
released retired tables, but completion did not release the current table.

The directory now has idempotent disposal. The full adjacency builder,
neighbor-mask builder and individual bucket path release the directory in
`finally`, including cancellation and failure. Compact private buffers detach
with `ArrayBuffer.transfer(0)` when supported; otherwise references are dropped
for normal collection. The wider-key Map fallback clears its records. Reads and
writes after disposal reject instead of probing an empty table. Authored
geometry and returned adjacency/mask buffers never detach.

This does not change bucket ordering, fallback linking, first-edge consumption,
record counts, masks, normals or evaluator arithmetic. The shared kernel path
serves the existing application and agent operation dependencies; public tool
schemas and command gating are unchanged.

## Three-target resident comparison

The [recorded measurements](evidence/native-alignment-scratch-lifetime.json)
retain all three canonical owner mesh targets together. They verify complete
native index, facet-normal and neighbor-mask hashes, then compare 99 native
queries through both original and restored descriptors. Cached and compact
modes each pass 198 comparisons, for 396 after the change.

| Bound policy    | Retained typed storage | ArrayBuffers just after preparation, before |      After | Difference |
| --------------- | ---------------------: | ------------------------------------------: | ---------: | ---------: |
| Cached, default |             468.17 MiB |                                  570.82 MiB | 474.82 MiB |    -96 MiB |
| Compact, opt-in |             327.47 MiB |                                  430.11 MiB | 334.11 MiB |    -96 MiB |

These totals include authored canonical buffers and shared copies. SharedArrayBuffer
cloning creates new JS wrappers over the same storage, which is counted once.
Two descriptor graphs are retained in one Node process. Source sampling normals,
raw indexes, physical worker process overhead, browser rendering and GPU storage
are excluded, as are expanded display positions/normals, project history and
project-decoding intermediates. Retained carrier hashes are checked; original source files are not
freshly rehashed.

The table is still required during construction. In cached mode, sampled peak
ArrayBuffer usage during preparation was unchanged. A single RSS sample series
is not a universal peak or speed guarantee. These measurements establish earlier
scratch retirement, not resolution of the separate project-load heap spike.
The production 512 MiB admission remains unchanged; full large-scan registration
and its public workflow gate remain unverified.

## Validation

Seven new lifetime regressions failed before the change. The final build passed
without warnings or errors (`scanforge-c36d853822814a50`) and 295 focused tests
passed. Browser correspondence replay passed 64 native case comparisons, two
pose and two fallback comparisons, two actual query workers, and cleanup of all
71 worker handles. The synthetic registration retained zero plane gap after
five query batches. This is not an original full-controller capture of the
three owner scans.

The fixed validation snapshot used the previous packed-target implementation
plus this slice's source and tests. Its full suite passed 45,973 tests with 49
optional tests skipped and no failures. The resident comparisons were enabled
separately; their native oracle checks passed in both bound modes. Formatting,
whitespace and source/snapshot identity checks passed for this slice.
