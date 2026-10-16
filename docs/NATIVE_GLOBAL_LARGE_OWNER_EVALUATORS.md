# Full retained-owner mesh evaluator captures

The original main-image adjacency rebuild, facet-normal task, target index
builder, recursive Double query and target chooser were executed for all three
retained canonical scans. The new large captures extend the scan-1 oracle in
[the fixture](../tests/fixtures/global-fine-retained-owner-mesh-native.json).

| Scan | Vertices | Triangles | Index nodes | Ordered memberships | Double query records |
| ---- | -------: | --------: | ----------: | ------------------: | -------------------: |
| 1    |   139338 |    273139 |       60539 |              639591 |                   33 |
| 2    |  1299033 |   2547403 |       52446 |             3452946 |                   33 |
| 3    |  1683605 |   3326910 |       79477 |             4617801 |                   33 |

All three complete index, facet-normal and boundary-mask hashes match the
application's retained output. This supersedes the earlier capacity-only
evidence for scans 2 and 3. It verifies evaluator preparation and the recorded
queries, rather than complete multi-scan registration.

## Original execution and adapters

The captures execute original procedures `0x140b38e30`, `0x140b35d90`,
`0x140a7f470`, `0x1403999e0`, `0x140399e30` and `0x140ae87d0` from the retained
image with SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
The existing allocation, virtual-access, CRT lifecycle, stack-probe and serial
scheduling adapters remain explicit limitations. This is direct original
machine-code execution with adapters, not a native UI capture or an observation
of the original OS scheduler.

The old harness created individual Python objects for every vertex and face,
plus a face-pointer dictionary and per-membership extraction objects. The bulk
harness uses contiguous 48-byte vertex and 80-byte face arenas with the same
field offsets, stride-based virtual accessors and validated pointer-to-index
conversion. Small allocations use aligned arena storage; the existing no-op
free adapter still retains their storage until process exit. Ordered leaf
memberships, normal bytes and boundary flags are extracted through NumPy views.
Query sample coordinates explicitly use Python Double arithmetic, preserving
the earlier captured point construction.

Before executing larger scans, bulk scan-1 output matched every previous native
index, normal and boundary hash, node and membership count, and all 33 complete
query records. The new harness has a 4096 MiB host-memory admission, a 110-second
process lease, a 1024 MiB remaining-memory abort and the unchanged individual
allocation limit. Successful runs release all executable mappings in finally
handling and process exit releases arena storage. Exact process exits and
cleanup records were inspected.

The fixture retains result-file and generated-harness digests for scans 2 and 3.
The external replay is `global-fine-bulk-owner-probe.py <scan-number>` in the
retained analysis folder. It validates the original adapter-template digest,
loaded image digest and canonical vertex/triangle carrier digests before use.
Original source-file hashes remain recorded provenance; the source files were
not freshly rehashed and the complete original file reader was not executed.

## Application regression boundary

The optional retained-owner test now enumerates every fixture scan through
ordinary preparation and shared prepared-state restoration. It compares whole
index, normal and boundary hashes, node/membership counts, repeated original
Double query results and geometry-cache reuse. The same private alignment
implementation serves existing shared GUI/MCP operations; no capability or
schema is added by this evidence update. Global Fine Align remains gated until
full workflow parity and production resource admission are verified.

All six routes passed, totaling 396 repeated native query comparisons. Each
route preserved complete index, normal and boundary hashes and cache reuse.
The scan-3 shared route ran in its own process after the between-case memory
guard stopped a combined run; no guard was reduced. For large retained meshes,
run one route per bounded process, with fresh host-memory admission, for example
`-t 'scan-3.*shared restore=true'`. This avoids keeping a previous test case's
reclaimable allocations pending while admitting the next one.

The fixed application validation snapshot used parent `fd67092` plus the updated
fixture and replay test. Its production build passed without warnings or errors
(`scanforge-d2e5dabe4d975425`). The full suite passed 45530 tests with 49 optional
tests skipped and no failures; all six expanded owner routes were executed
separately with their retained carriers. Formatting and source/snapshot identity
checks passed. No application implementation, public GUI/MCP schema, memory
admission or feature gate changes are included in this evidence slice.
