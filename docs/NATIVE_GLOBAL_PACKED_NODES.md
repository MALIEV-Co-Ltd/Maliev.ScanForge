# Shared packed evaluator nodes

An internal `packedNodes: true` policy stores evaluator node metadata in two typed
buffers: twelve Doubles for bounds, center and inverse, and twelve uints for
child links, membership range, depth and mode. This uses 144 bytes per node.
Ordered memberships borrow the existing contiguous membership buffer when
possible. Shared input geometry produces shared metadata buffers.

The prepared carrier omits the node graph. A receiving worker validates dimensions,
finite coordinates, inverse values, face and child ranges, depth, reachability
and repeated nodes before attaching local numeric query scratch. It queries
integer node IDs directly, without rebuilding or cloning a graph of node objects.
The traversal preserves native near-child priority, ascending sibling order,
Float32 point comparisons, Double bounds and distance arithmetic, strict winner
updates and miss behavior. Both query paths clear their stacks on failure.

Graph storage remains the default; the new representation is an explicit private
policy. GUI/MCP schemas, public command gating and conservative pool admission are
unchanged. This does not advertise completed Global Fine Align or admission of
the three large scans into the production pool.

## Verification and measurements

The original query corpus passes all 392 cases with packed nodes, preserving
winner IDs, Double distance/projection bits and edge flags. Additional tests
cover shared restoration, omitted graphs, malformed metadata and empty indexes.
All three retained owner scans preserve complete native node, normal and mask
hashes in cached and compact bound modes. Each mode passes 198 query comparisons
through original and restored descriptors, for 396 in total. Retained carrier
hashes are checked; original source files are not freshly rehashed.

The [measurements](evidence/native-global-packed-nodes.json) retain all three
targets and two descriptor graphs in a single Node process, without forced
collection. In cached mode, heap at the restored checkpoint changed from about
286 MiB to 44 MiB. The packed representation adds 26.43 MiB of typed metadata
for 192,462 nodes, shared between descriptors. Construction still builds a
temporary graph; this slice does not remove that construction peak. The
measurements exclude browser/worker process overhead, rendering, source sampling
normals, project history and decoding intermediates. They are not total
application memory or proof that the project-load heap spike is fixed.

A warmed scan-3 query sample used identical cached bounds, six alternating pairs
of 825 queries and conventional medians: graph 9.1354 ms, packed 7.4242 ms, about
19% faster in this local sample. All recorded query bits matched before timing.
This is not a general throughput guarantee or a default-policy change.

Browser replay exercises packed handoffs across two physical CPU workers. It
passes 64 native case comparisons, two pose comparisons, two single-worker
fallback comparisons and 33 prepared handoffs. All 71 worker handles terminate.
The synthetic registration reaches zero plane gap after five query batches;
full native registration with the owner scans remains a separate requirement.

The validation snapshot used committed parent `cfa525c` plus this slice. Its
production build passed without warnings or errors (`scanforge-23b3c6a650634d47`).
There were 393 red regressions before implementation; the final focused run
passed 1,395 tests. The full suite passed 46,373 tests with 49 optional skips and
no failures. The two large resident replays and timing probe were run separately.
Formatting, whitespace and source/snapshot identity checks passed.
