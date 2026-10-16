# Alignment pool input ownership

Shared query inputs now belong to one pool lifetime. The module-level geometry
cache previously kept an immutable shared copy reachable as long as its source
geometry remained reachable, even after the workers closed. New pools create
fresh packets; successful initialization drops the main-thread handoff packet,
and close clears callbacks, initialization references and owned worker handles.
Worker termination remains the cleanup mechanism on failure, abort and expiry.
This removes application references; it does not force browser garbage collection
or promise immediate release of operating-system pages.

Transport copies each ordinary backing buffer once across the complete scan
packet. It preserves element types, offsets, overlapping views, repeated view
identity and aliases between source points and mesh vertices, including aliases
between scans. Existing shared backing buffers are reused. Authored arrays are
neither mutated nor detached.

Input admission counts unique complete backing buffers, including unused bytes
behind subarray views. An ordinary buffer costs the authored backing plus one
shared copy, or one structured clone per physical worker without sharing. An
existing shared backing counts once. The former per-field sum could count the
same input several times while also missing unused bytes of a large backing.

The 512 MiB ceiling, raw-index estimate, mesh-preparation reserve, worker count
policy, numeric mode and query ordering remain unchanged. This is not the final
packed whole-scene admission implementation and does not enable the large-scan
command. There is no public schema or usage change. Both GUI and MCP continue
through the same shared alignment operations; no separate implementation is
introduced.

The next integration gate is enforcement of preparation peaks across the entire
scene, including retained earlier targets, adjacency and index scratch, final
copies and physical-worker overhead. Native numeric equivalence and successful
registration within tolerance are separate checks. The existing identity-start
native three-scan controller result is non-converged.

## Validation

The isolated production build passed without warnings or errors. The focused
alignment run passed 153 tests. The full affected application suite passed
46,420 tests with 53 optional skips and no failures (468 passed files, 15 skipped)
in 230.13 seconds. Unrelated working-tree changes were excluded and preserved.

Physical-browser replay matched 64 native query controls, two changed-pose checks
and two single-worker fallback checks. Two physical query workers preserved the
numeric mode and ordering. The independent synthetic registration reached zero
gap after five query batches. All 71 owned worker handles terminated, and the
disposable browser closed with no page errors. These are small-fixture boundary
checks, not a new native three-scan controller comparison or memory benchmark.

Regression coverage includes whole-backing admission for small subarrays,
overlapping mixed typed views, aliases across scan objects, repeated geometry
identity, existing shared inputs, fresh packets after close, unchanged query
results and cleared worker callbacks. Formatting, whitespace and root/snapshot
source identity checks passed. The [evidence record](evidence/native-global-pool-storage.json)
records scope and results. No release, push or deployment was performed.
