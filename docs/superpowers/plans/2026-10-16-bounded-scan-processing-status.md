# Bounded scan processing checkpoint — 2026-10-16

The resident decimation corrections are implemented and copied into the active
checkout serving port 5173. The full approved disk-backed workflow is unfinished.

## Delivered resident changes

- Large reduced surfaces use the existing signed-distance evaluator through a
  linear-storage BVH, avoiding the recovered octree's fixed node failure. Small
  surfaces retain the recovered index, with a specific node-budget fallback.
- Spatial cuts no longer protect an entire healthy patch solely because they
  disconnect its local vertex fans. Complete source stars are checked before
  temporary representatives are separated at identical, pinned coordinates.
- GUI preview and direct MCP comparison retain unique samples and corner IDs
  without constructing original adjacency. The first-coordinate origin and
  27-neighbor-cell representative order remain unchanged.
- GUI and MCP use the existing shared operation, parameters, revision guards,
  cancellation and history behavior. No new public storage capability is exposed.

Resident ordering and source-star lookup still have arrays proportional to input.
The internal allocation coordinator and paged sample/comparison modules are
foundations; they are not an enabled out-of-core application path.

## Verification

| Check                                             | Result                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Isolated build                                    | Passed; `scanforge-b1946c52b6f68bc2`                                           |
| Isolated full suite                               | 43,462 passed; 40 skipped; zero failures                                       |
| Active-checkout build                             | Passed; `scanforge-b7a8559deb3a7d9c`; zero warnings/errors                     |
| Active full suite, one worker, 1536 MiB heap cap  | 43,523 passed; 40 skipped; zero failures                                       |
| Healthy 1,152,000-face curved-panel unit test     | At most 576,000 faces; source perimeter retained; finite, positive-area output |
| Active GUI preview/compare/accept                 | 115,200 to 57,600 faces; original retained during preview                      |
| Active MCP replay from original at 50%            | Identical geometry coordinate bytes to GUI                                     |
| Subsequent direct MCP reduction/comparison at 90% | 57,600 to 51,834 faces; exactly one history step                               |
| Formatting                                        | Touched source, tests and documentation checked                                |
| Resource cleanup                                  | Test browser/MCP parents and direct children absent; temporary ports closed    |

The original full-size comparison-fix baseline also completed GUI/MCP on 1,152,000
faces, but retained 996,352 faces at a 50% request before cut-fan corrections. Do
not present that old baseline as the final full-size target verification.

Latest equal-input GUI/MCP fixture SHA-256:
`f03c032141131ab0319f061469a1abdc3bbd8b655672f056a18852d1038e85e3`.
Both exported coordinate streams hash to:
`07ea9846b68b74272c1bbd68c9e44bb483890c4b22885ef73a32cfd711befc7d`.
This is a synthetic 600 x 300 mm curved panel, not the customer's headlight file.
The browser used software rendering on an i9-11900KF with 16 logical processors
and 32 GiB RAM. Timings are single-run observations, not performance guarantees.

Evidence in the active checkout:

- `.resources/bounded-scan-integration/build.log`
- `.resources/bounded-scan-integration/suite.json`
- `.resources/bounded-scan-integration/source-integration.json`
- `.resources/bounded-scan-integration/parity-browser.log`
- `.resources/bounded-scan-integration/final-cleanup.json`
- `.resources/resident-reduction/large-reduction-browser-ledger.json`

## Remaining work and blocker

The final 1,152,000-face GUI/MCP replay was attempted but not admitted by its
unchanged 6144 MiB free-memory guard. Its latest attempt is recorded in
`.resources/bounded-scan-integration/large-browser.log`. The separate 115,200-face
replay retains its own 3072 MiB guard. No guard was lowered and no unrelated
application or service was stopped.

Not yet implemented: external bounded ordering/reduced output, a complete paged
source edge directory with protected-source counts, OPFS pages and atomic durable
manifests/recovery, stored entity/import/render/picking/history adapters, streamed
projects/backups/MCP artifacts, and admitted deterministic multicore scheduling.
Those capabilities remain unavailable. The durable source migration must preserve
point-cloud support with an explicit point-source contract; triangle-only metadata
must not disguise points as empty meshes.

The next required large replay is `node tests/large-reduction-browser.mjs` from
the active checkout after admission succeeds. Continue the unchecked approved
plan tasks without requesting routine permission again.

## Local commits and integration ownership

| Commit    | Scope                                                         |
| --------- | ------------------------------------------------------------- |
| `57733b2` | Comparison node-budget correction and large workflow baseline |
| `2a15e05` | Shared allocation leases and resident source/page adapters    |
| `63b2068` | Paged canonical samples and comparison output foundation      |
| `814b06f` | Paged comparison, stable ties and bounded directory traversal |
| `c4b0d73` | Resident cut-fan correction and original-adjacency removal    |

The commits are on `codex/bounded-scan`, in
`B:/maliev-legacy/scanforge-bounded-scan`. Resident source/test files were copied
into the active checkout only after expected-content checks; its index and
unrelated changes were preserved. Internal paged foundations remain isolated.
There was no push, deployment or release publication.

The isolated checkout is retained for the unfinished plan, with no running
helper required. Re-observe its state and admission before continuation. The
plan ledger remains under its ignored `.superpowers/sdd/` directory. Whole-plan
completion and final review are pending; the completed slices received an author
self-review because delegation is prohibited in this side conversation.
