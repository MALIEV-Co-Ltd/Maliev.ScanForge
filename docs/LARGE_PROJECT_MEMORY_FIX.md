# Large-project memory correction

The original-three saved project now completes GUI reopen, MCP export, full
download, full upload and MCP reopen under the unchanged **4 GiB aggregate
validation Job limit** in an isolated persistent browser profile.

[Structured evidence](evidence/large-project-memory-fix-20261024.json) pins the
source, build, runtime captures, ownership ledger, screenshot and test receipts.
The working changes are local and uncommitted.

## Changes

- Backup change detection stores weak identity tokens instead of owning saved
  geometry/history arrays. Replacing a document updates the pending backup
  immediately; stopping the writer releases its pending snapshot. Active writes
  retain their snapshot until they settle.
- Binary decoding decompresses into final readonly shared backing, then publishes
  typed views. It no longer retains private decoded chunks alongside shared
  geometry copies. The original file declares 1,408,041,588 decompressed bytes.
  Incremental SHA-256 verifies shared bytes without another full-chunk copy;
  nonisolated decoding keeps its ordinary-buffer fallback.
- Binary project saves/exports of at least 64 MiB use temporary IndexedDB backing.
  MCP uploads checkpoint at each 64 MiB growth boundary. Committed read/delete
  transactions remove temporary records while immutable browser-owned Blobs retain
  their bytes. Failed checkpoints preserve the previous upload. Disposal,
  expiration, concurrent append/delete and quotas are checked before publication.
  Cancellation aborts encoding storage work; opens and transactions have finite
  deadlines. Interrupted records expire and are swept by subsequent staging.

GUI Save, backups and MCP export share the encoder. GUI opening, MCP import and
backup recovery share the decoder. Existing tool schemas, geometry, history,
retries, revision guards, artifact quotas and the 4 GiB validation cap remain.
The catalog and agent documentation describe upload checkpointing and recovery.

## Validation and limits

The successful capture is `20261024T065015903040Z`:

| Check                                 | Result                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Full download/upload                  | 736,091,936 bytes each                                                  |
| Download SHA-256                      | `cea96674341c61576523076bed0d6347b554e277127cbeba6c59cf6c40f67dea`      |
| GUI/MCP geometry comparison           | All 16 current carriers match across three objects                      |
| History                               | All six steps restored; Undo/Redo, retry and stale revision checks pass |
| Transfer handles                      | Released after reimport                                                 |
| Peak aggregate Job memory             | 4,233,691,136 bytes, approximately 3.943 GiB                            |
| Remaining headroom                    | 61,276,160 bytes, approximately 58.44 MiB                               |
| Ownership cleanup                     | All 17 processes exited; active count zero, handles closed, no errors   |
| Focused and additional contract tests | 286 tests across 21 files pass                                          |
| Build                                 | Pass; 1,980 compiler inputs unchanged during build                      |

The final rendered screenshot shows all three reopened scans and the complete
timeline. A separate real-browser 64 MiB check verifies exact bytes after deleting
the temporary database record, zero remaining records, and cancellation. Failure
regressions cover storage errors, concurrent append and deletion. Full unit and
CAD suites were not rerun.

This is one successful full-size run with **narrow memory headroom**, not a
worst-case guarantee for larger projects or histories.

## Incremental encoder checkpoints

[Follow-up evidence](evidence/project-encoding-checkpoints-20261024.json) records
the current codec hash and fresh checks separately from the original full-size run.

The encoder now checkpoints completed payload batches once pending output reaches
64 MiB, before encoding subsequent geometry/history payloads. Previously it kept
every compressed payload until the entire container was assembled, then staged
the full file. GUI Save, automatic backup and MCP `project_export` use the same
corrected codec. Batches can exceed 64 MiB by the last payload; compression of an
individual payload and private-context storage remain memory costs.

Fresh verification of this follow-up passes 77 focused tests across ten files,
the production build and typecheck. The new checkpoint tests verify lossless
geometry/history restoration, checkpoint failure/retry and public MCP export.
`tests/project-encoding-disk-browser.mjs` also runs the actual local and worker
encoders in a disposable persistent Chrome profile: 134,217,792 source bytes
produce the same 113,118,064-byte container and SHA-256
`3f72ab60119d9b5dd209d08f10a5bb7e3142b355f57fc69c3b1a47cd79ab5751`.
An 84,836,900-byte checkpoint completes before final assembly; restored geometry
and shared history backing match, with zero temporary database records remaining.

These are checkpoint correctness checks. The original 736 MB round trip and its
4 GiB peak above were not repeated for this follow-up; do not attribute those
measurements to the incremental encoder or infer a new peak-memory guarantee.
The end-to-end MCP smoke also passes project export, backup recovery and GUI/MCP
typed-normal byte comparisons. The existing encoder browser probe passes invalid
geometry rejection, cancellation, authored-buffer retention and queue cleanup.

## Persistent versus private context

The earlier harness created an isolated profile directory but used Playwright
`browser.newPage()`, which creates a private context. The corrected harness uses
the isolated persistent default context and the same viewport, inputs, commands,
assertions, cap, deadlines and ownership runner. Actual IndexedDB Blob files were
observed in that disposable profile; only file metadata was inspected.

Chromium stores persisted IndexedDB Blobs on disk, and retains deleted records'
backing while a client Blob is still active. Private/incognito IndexedDB stays
memory-backed. [Chromium IndexedDB design](https://chromium.googlesource.com/chromium/src/+/master/content/browser/indexed_db/docs/README.md).

The same application candidate still exceeded 4 GiB during reimport in the private
context. That failure is retained separately in the evidence. Disk-backed memory
validation requires a persistent profile; IndexedDB API availability alone does
not establish disk backing. This test-context change is explicit, and the earlier
private captures are not relabeled as successful tests. Transfer validation does
not establish native alignment or convergence equivalence.
