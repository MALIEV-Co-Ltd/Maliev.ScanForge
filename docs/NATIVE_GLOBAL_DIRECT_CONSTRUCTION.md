# Direct packed evaluator construction

The internal `packedNodes: true` policy now builds typed node metadata and
ordered triangle memberships directly, instead of building an object tree and
then flattening it. The graph policy remains the default. No public command,
GUI/MCP schema or production admission limit changes in this slice.

Both builders share indexed geometry validation and native root construction.
The direct path preserves Double node geometry, Float32 triangle bounds, native
child ordering, the eager eight root children, subdivision thresholds and depth
limits. Per-triangle child masks are computed once; typed child lists are filled
in source order and processed in depth-first child order. Leaf memberships are
stored in bounded blocks before the final contiguous immutable handoff buffers.
Shared input produces shared final buffers, with local query scratch per worker.

The allocator checks live owned typed storage before every allocation, including
final output copies. It releases owned parent lists and masks before recursion,
and releases remaining scratch in `finally` on success, cancellation and failure.
Authored geometry is never detached or modified. Where ArrayBuffer transfer is
unavailable, unreleased storage remains charged until construction ends rather
than silently lowering the accounting. The internal 512 MiB construction ceiling
is not whole-scene admission: inputs, caller-owned normal/bound caches, other
retained targets, JavaScript overhead, worker processes and rendering are outside
this allocator. Production query-pool admission remains unchanged.

## Native and memory verification

Ten regressions first failed with a trap on the old object-tree constructor. They
now pass in both cached and compact modes and compare complete packed output to
the native-verified graph builder. Allocation-budget, partial-allocation cleanup,
cancellation/retry, remapping and older-runtime accounting regressions also pass.

Fresh-process measurements retained all three canonical owner meshes and their
shared evaluator/restored descriptors. Each run matched complete original index
and facet-normal hashes and 198 original Double query controls. Coordinate and
connectivity carrier hashes were checked. Original source files were not freshly
rehashed, and the original reader/UI/OS scheduler did not run in these measurements.

The parent comparison uses the surface implementation from commit `8b51fd4` with
current common geometry/root-validation and query helpers. This isolates graph
construction from direct packed construction; it is not a complete historical
application build. No collection was forced. Checkpoints sampled at roughly
100 ms can miss short-lived peaks.

| Sample                              | Parent cached | Direct cached | Direct compact |
| ----------------------------------- | ------------: | ------------: | -------------: |
| Retained input/evaluator data bytes |   512,477,876 |   512,477,876 |    364,939,028 |
| Sampled maximum heap bytes          |   220,509,648 |    26,209,016 |     26,785,280 |
| Sampled maximum RSS bytes           |   854,933,504 |   624,300,032 |    473,948,160 |
| Sampled maximum ArrayBuffer bytes   |   512,505,653 |   513,739,779 |    366,200,931 |

Restoration aliases were excluded from retained-data accounting only after
verifying every cloned typed backing was shared. An earlier wrapper-counting
variant double-counted these aliases and is retained separately, not used as a
physical-storage result. Query scratch and other hidden runtime allocations are
not part of the retained-data sum.

The cached direct path sharply reduced sampled heap/RSS, but its final contiguous
copy still created a typed-buffer peak. No claim is made that every memory metric
improved or that these measurements establish whole-scene production admission.
The three elapsed measurement durations were 12.78 / 12.27 / 12.49 seconds and
include query verification and accounting. They are not a throughput benchmark.

The native [controller comparison](NATIVE_GLOBAL_CANONICAL_CONTROLLER.md), large
owner physical-worker workflow, production admission, successful registration
within tolerance and GUI/MCP Apply/cancellation/history remain distinct checks.
GUI and agents continue through shared application operations; this slice adds no
separate agent-only or GUI-only algorithm.

The final accounting revision passed the complete cached controller replay: all
19 native pass snapshots, final states and six matrix commands matched, with 439
queries and 57 local refinements. The native identity-start outcome remains
non-converged. This replay uses direct kernels, not production pool admission or
GUI/MCP setters. Its elapsed time is recorded in the evidence; observed timings
varied substantially between runs and are not a throughput guarantee.

Physical-browser replay passed 64 native comparisons, two pose checks and two
single-worker fallback checks across two physical query workers. Its independent
synthetic registration reached zero gap after five queries. All 71 owned worker
handles terminated and the disposable browser closed. The final build and 492
focused tests passed, including caller-owned validation-scratch accounting and
rejection of scratch that aliases immutable metadata.

The final full default suite passed 46,416 tests with 53 optional skips and zero
failures (467 passed files, 15 skipped) in 232.71 seconds. Large owner measurements
and the controller replay were explicitly executed separately. Validation was
serialized in an isolated snapshot of committed application code plus this slice;
unrelated working-tree changes were preserved and excluded. The production build
passed with fingerprint `scanforge-4cfd5eaea0a6d8a9`. Formatting, whitespace and
source/snapshot identity checks cover all owned files. The small six-value scratch
and caller-owned visited-node scratch are both charged to construction admission.
