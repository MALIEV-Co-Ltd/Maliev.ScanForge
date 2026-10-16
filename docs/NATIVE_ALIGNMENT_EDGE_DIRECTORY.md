# Alignment directed-edge storage

Alignment adjacency and query boundary masks share a private directed-edge
directory. The directory replaces boxed Map entries with two Uint32 keys and one
Int32 record per hash-table slot (12 bytes). Linear probing preserves distinct
directions, including vertex zero and the full unsigned 32-bit vertex range.
The table grows at 70 percent occupancy. Counts outside the compact key or
record range retain a string-keyed Map fallback without truncation.

Nonnegative records identify the first directed edge. A consumed record stores
`-slot-1`; duplicates never replace that first record or revive a consumed edge.
Zero means an empty table slot, so an unconsumed edge is encoded as `slot+1`.
Native bucket order, fallback order, triangle flags, record counts, neighbor
identities and boundary-mask behavior remain the responsibility of the unchanged
linking traversal. This is a storage change, not a different adjacency rule.

Global preparation counts vertices referenced by faces during index validation,
using one bit per input vertex. It reserves for up to three entries per referenced
vertex, bounded by the number of edge slots. This is an allocation hint for
typical triangulated scans; higher-valence topology still grows normally. Without
an observed-topology hint, initial reservation is capped so unused vertices and
repeated faces do not force a large initial allocation.

Cancellation during rehash leaves the old directory intact. After successful
rehash, only private retired table buffers are detached where the runtime
supports ArrayBuffer transfer; other runtimes rely on garbage collection.
Authored mesh buffers never enter that release path. Directory byteLength reports
current table storage, not process peak memory or GPU memory.

Validation covers a Map oracle through collisions and growth, signed consumed
records, wide-key fallback, cancellation and invalid reservations. Native parity
must additionally be checked through the retained adjacency corpus and the full
scan-1 index, normal, mask and Double-query capture. Larger scan replays compare
application baselines and resource capacity; they do not establish full native
registration parity without corresponding original evaluator captures.

The retained scan-1 replay preserved all three original hashes, 60539 nodes,
639591 memberships and 66 repeated Double queries. The 392 focused tests and
the browser replay (64 case comparisons, two pose checks and two fallback
checks, with two physical workers on the shared-input route) passed.

Large retained scans preserved the earlier application index, facet-normal and
neighbor-mask hashes, including node counts and ordered memberships:

| Scan |   Faces | Managed heap sample, before / after | ArrayBuffer sample, before / after |
| ---- | ------: | ----------------------------------: | ---------------------------------: |
| 2    | 2547403 |                 234.43 / 202.79 MiB |                154.38 / 250.38 MiB |
| 3    | 3326910 |                 516.18 / 208.41 MiB |                201.69 / 297.69 MiB |

These are separate phase maxima sampled at cancellation checkpoints, not
simultaneous total-process peaks. The typed directory reduces boxed-object
pressure but adds explicit backing storage; scan 2 does not demonstrate a net
memory improvement. Single-run timings are not a controlled speed comparison.
The larger replay hashes only the retained canonical carriers; original scan
identities were not freshly rechecked. No claim is made that this fixes the
separate project-load heap spike.

The fixed validation snapshot used parent `5024ee8` plus this slice's three
source/test files. Its production build passed without warnings or errors
(`scanforge-6f61f12b89ccf87b`); the full suite passed 45493 tests with 44 optional
tests skipped and no failures. The native retained-owner test was also executed
separately with its required external carriers. Formatting and source/snapshot
identity checks passed. Unrelated worktree edits were excluded from that build.

The directory is internal to existing shared alignment preparation and adds no
GUI-only behavior or public MCP schema. Full adjacency consumers retain their
existing output contract. Prepared target indexes are still rebuilt separately
by physical workers; shared prepared-target transport remains unfinished. The
512 MiB pool admission limit and Global Fine Align native-parity gate remain in
force.
