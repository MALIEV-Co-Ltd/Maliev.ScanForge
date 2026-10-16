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

## Target preparation order

Target preparation now finishes adjacency before constructing the evaluator.
The retained controlled native mesh harness calls adjacency (`0x140b38e30`), facet normals
(`0x140b35d90`), then the target builder (`0x140a7f470`) in that order. The
sequence is established for that harness; it does not prove the original GUI's
complete preparation sequence. Offline image inspection also resolves the
conditional virtual call in evaluator lifecycle `0x1407b9950`: base mesh table
`0x140ebfcf0` slot `+0x68` points to adjacency `0x140b38e30`. The lifecycle checks
an interface predicate and conditionally invokes this slot before its evaluator
builder. The interface table at `mesh +0xf8` resolves its predicate slot `+0x10`
to `0x1401ddb90`, which returns the byte at `interface +0x10` (`mesh +0x108`).
The base constructor clears that byte; adjacency construction sets it to one.
This statically establishes the readiness guard used to skip repeated adjacency
construction. Geometry-edit invalidation paths have not all been traced here.
Derived table `0x141155e60` instead points to `0x140166530`, whose body
returns success without work. Thus the original lifecycle supports conditional
preparation, not an unconditional adjacency rebuild for every mesh. The concrete
class and live readiness state used by the original GUI remain unobserved. The
previous application order constructed the evaluator before adjacency. As a
result, the current target's completed tree could coexist with the temporary
edge directory. The directory's existing `finally` disposal now runs before
the evaluator starts. Previously prepared targets remain resident.

Both GUI and MCP alignment use this shared target-preparation path. This changes
neither correspondence arithmetic nor the public schema or memory admission.
Only fully prepared targets enter the identity cache; a failed preparation can
be retried. Preparation-order regressions exercise the real builders and cache,
with injected adjacency/evaluator failures. A measured reduction of the complete
three-scan registration peak remains unverified.

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

The subsequent preparation-order change passed an isolated production build
(`scanforge-cd1e69942faa6828`), 277 focused tests, and the full isolated suite:
46,382 passed, 52 optional tests skipped, zero failures. Its three new
regressions cover adjacency completion before evaluator construction, identity
cache reuse, and retries after adjacency or evaluator failure. These checks do
not measure the complete owner-scan memory peak or establish full registration
parity. The snapshot uses committed base `fa3810d` plus this change's source and
test, excluding unrelated working-tree changes.
After host capacity recovered, the physical browser replay passed all 64 native
correspondence comparisons, two pose and two fallback comparisons, with two
physical query workers and shared packed preparation. All 71 worker handles were
terminated; the owned browser and runner processes exited. The synthetic
registration retained zero plane gap after five query batches. No browser errors
were recorded. This replay used the live kernel on port 5173 and retained its
results/cleanup ledger in the isolated snapshot's
`.resources/global-mesh-query-browser/` directory. It does not establish full
three-scan native controller parity or the owner scans' peak memory reduction.
