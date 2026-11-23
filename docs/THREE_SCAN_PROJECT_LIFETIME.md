# Three-scan project lifetime measurement

The shared data pipeline retained all three original PLY scans and their aligned
history simultaneously, saved a binary project, then reopened it twice under the
unchanged 4 GiB Windows Job limit. Both round trips preserved every position,
scanner-normal, computed-normal and topology buffer exactly. Undo/Redo restored
the corresponding full geometry hashes, shared topology remained deduplicated,
and indexed rendering borrowed the restored computed-normal carrier.

This is component evidence for [M8](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/8)
and project persistence in [M7](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/7).
It does not close either milestone or establish rendered GUI/MCP acceptance.

## Workload and result

The original inputs contain 3,381,455 vertices and 6,663,164 facets. Import reads
bounded slices of at most 1 MiB and verifies each original file hash before and
after the run. No geometry is downsampled and history is retained throughout both
reopens. The actual shared datum executor applies the matrices produced by the
pinned numerical alignment replay using its supported zero-worker fallback.
The stored-normal and indexed-position hashes also match the separate native
buffer comparison.

| Measurement                                          |                         Result |
| ---------------------------------------------------- | -----------------------------: |
| Original geometry retained                           |              681,438,156 bytes |
| Original plus aligned geometry, with shared topology |            1,282,918,344 bytes |
| Saved binary project including history               |              666,971,709 bytes |
| Aggregate peak Job committed memory                  | 3,716,186,112 bytes (3.46 GiB) |
| Job memory limit                                     |    4,294,967,296 bytes (4 GiB) |
| CPU quota                                            |                            25% |
| Complete run                                         |                      65,262 ms |
| First reopen and exact verification                  |                      10,018 ms |
| Second reopen and exact verification                 |                       9,627 ms |
| Settled ArrayBuffer accounting after each reopen     |            1,951,556,907 bytes |

The owned process exited, its Job became empty and all owned handles closed
without cleanup errors. Already-aborted save/reopen calls rejected with
`AbortError`. These checks do not establish mid-operation cancellation latency.

## Retention diagnosis

The first harness kept the preceding decode result alive in its top-level async
scope. One reopen verified successfully, but the next allocation reached the
4 GiB limit and the process exited with an allocation failure. The failed receipt
is retained in the structured evidence.

The corrected harness returns from each verification function and yields to the
event loop before explicit garbage collection. A weak reference confirms that
the old decoded scene is collectible. ArrayBuffer accounting returns to exactly
the same baseline after both cycles while the original scene, aligned scene and
backup remain resident. No application code or resource guard changed to obtain
this result.

Explicit collection measures reachability and settled storage; it does not
measure automatic browser collection delays. Two cycles are also insufficient
to establish long-duration leak freedom.

## Evidence and remaining acceptance

The [structured evidence](evidence/three-scan-project-lifetime-20261023.json)
contains source/build/driver identities, full buffer hashes, per-phase memory,
file read bounds, native-comparison links, success and failure receipts, and
the cleanup results. This uses normal ArrayBuffers in the supported non-browser
path. Browser workers, shared-buffer transport, public MCP invocation, automatic
backup scheduling, navigation frames and GPU state are outside this run.

The same parser, transforms, project codecs and history activation are used
beneath GUI/MCP operations. Their contract tests remain separate evidence.
Rendered acceptance on the current candidate is still required; the earlier
browser-access denial was not bypassed.
