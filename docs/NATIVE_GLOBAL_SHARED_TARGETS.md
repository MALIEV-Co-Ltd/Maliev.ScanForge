# Shared prepared global-alignment targets

The global correspondence pool previously shared input coordinates but prepared
the same mesh evaluator, facet normals and adjacency separately in each CPU
worker. Shared input did not prevent that duplicate preprocessing.

For two admitted workers under cross-origin isolation, initialization now runs
in two phases. The first worker prepares every scan normally and returns a
cloneable carrier containing its geometry and prepared mesh targets. Large
derived arrays follow the input storage: facet normals, triangle bounds,
degeneracy flags, neighbor masks and ordered leaf memberships use shared backing
buffers when the input vertices already use SharedArrayBuffer. Authored buffers
are never detached or modified.

The second worker receives that carrier, validates source identity, dimensions,
node structure, memberships and mask ranges, then attaches local evaluator and
query scratch. It does not recompute the mesh index, normals or adjacency. The
carrier includes geometry and prepared state in the same message to preserve
their object aliases across structured cloning. Node metadata is cloned per
worker; raw point indexes and mutable query/result storage remain worker-local.
Targets remain immutable for their geometry identity; poses do not invalidate
preparation. A changed geometry carrier must be prepared again.

Single-worker and nonisolated routes retain normal initialization. Missing or
invalid prepared data rejects initialization and closes both exact worker
handles. Requests still time out after 30 seconds, idle pools expire after
30 seconds and the total pool lease remains 15 minutes. Ordered query merging,
numeric mode, source samples and pose updates are unchanged.

The existing conservative 384-byte-per-face estimate and 512 MiB admission are
unchanged. This slice removes duplicate preparation on an admitted shared route;
it does not yet prove a lower aggregate process peak or admit the larger owner
scans. It does not claim to fix the separate project-load heap spike or complete
native registration parity. Global Fine Align remains subject to its existing
full-workflow gate; no new public GUI/MCP capability is advertised.

Retained native static evidence at `0x140ae9590` places the target vector in a
common context before dispatch. `0x140ae9970` reads that context and uses private
cell scratch; output is merged in cell order. This supports sharing immutable
targets, but the retained serial native adapters do not verify the original OS
scheduler. The application browser replay verifies two actual CPU workers.

Validation includes the native correspondence fixture with zero evaluator or
adjacency build calls during prepared-state restoration; ordinary and shared
restoration of the complete retained scan-1 index, normal and boundary hashes
and 66 Double-query comparisons per route; and a browser replay checking shared
prepared buffers, native output bits, pose reuse, one-worker fallback and worker
termination. Larger canonical replay results are capacity/application-baseline
checks unless a corresponding full original evaluator capture exists. Retained
carrier hashes are checked; original source-file identities are not freshly
rehashed by these tests.

The validation snapshot used parent `a1e667c` plus this slice. Its production
build passed without warnings or errors (`scanforge-d2e5dabe4d975425`), 433 focused
tests passed, and the full suite passed 45530 tests with 45 optional tests skipped
and no failures. The separately enabled retained-owner replay passed both routes
(132 repeated Double-query comparisons in total). Browser verification passed
64 native case comparisons, two pose comparisons and two fallback comparisons,
with 32 prepared shared-target handoffs and all 66 workers terminated.

Shared restoration of the 2547403-face and 3326910-face retained canonical scans
preserved every application index, normal and mask hash, node count, ordered
membership count and cache reuse. These diagnostic replays use the unchanged
host-memory/deadline guards and exercise target preparation and restoration
directly. They do not demonstrate production pool admission or complete native
multi-scan registration.
