# Large-project memory correction

The latest [immutable chunk reuse run](evidence/large-project-reuse-roundtrip-20261024.json)
reduces the same original-project workflow's peak from **3.946 GiB to 2.623 GiB**,
leaving **1.377 GiB** under the unchanged 4 GiB cap. The earlier runs below are
retained as separate historical measurements.

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

These initial checks established checkpoint correctness. The full-size rerun
below separately verifies the incremental encoder under the original cap.
The end-to-end MCP smoke also passes project export, backup recovery and GUI/MCP
typed-normal byte comparisons. The existing encoder browser probe passes invalid
geometry rejection, cancellation, authored-buffer retention and queue cleanup.

## Full-size checkpoint rerun

[Fresh evidence](evidence/large-project-checkpoint-roundtrip-20261024.json) records
run `20261024T072655174588Z`. The original **736,091,936-byte** project completes
GUI reopen, MCP export, all 2,808 download reads, all 702 upload writes and MCP
reimport under the unchanged **4 GiB aggregate Windows Job cap** and 25% CPU
limit. Its downloaded SHA-256 remains
`cea96674341c61576523076bed0d6347b554e277127cbeba6c59cf6c40f67dea`.
All 16 current geometry carriers and six history steps match the saved reference.
Undo/Redo, identical-request retry and stale revision rejection pass. The final
rendered screenshot was inspected, and transfer artifacts are released.

Peak Job memory is **4,236,947,456 bytes (3.946 GiB)**, leaving **58,019,840 bytes
(55.33 MiB)**. All 17 owned processes exit, final active count is zero, all
observed identities/exits verify, handles and completion port close, and capture
and cleanup errors are empty. No further runtime memory failure reproduced in
this workflow; no additional application change was needed for the rerun.

Other chats were editing the workspace, so validation used an isolated copy of
the working source with its own successful build and unchanged compiler inputs.
The eleven recorded project/backup/transfer source paths match the current
workspace byte for byte. The runner changed only its exact snapshot path binding
and its ignored-directory check to use paths relative to that snapshot. Memory
limits, input bytes, assertions, leases and process ownership checks were retained;
no forced garbage collection was used.
The focused regressions pass again: 77 tests across ten files, with validation
snapshots excluded from test discovery. Documentation/evidence formatting passes.

Headroom remains narrow. This persistent-profile result does not establish
private/incognito admission, larger-project capacity, populated replacement or
in-flight cancellation.

## Immutable restore chunk reuse

The previous profile showed renderer memory growing by approximately another
decoded project during reimport, even after the scene was cleared. The shared
decoder now borrows matching immutable chunks from prior restores while their
backing remains alive. A bounded cache holds at most 128 **weak** buffer references;
it owns no geometry lifetime. The worker still reads every incoming payload,
compares its bytes and verifies SHA-256. A mismatch allocates independent backing
and preserves the earlier consumer. Nonisolated hosts retain ordinary decoding.

GUI opening, MCP `project_import` and `backup_restore` use this same path. No
format, schema, history, cancellation, revision or retry contract changed.

[Fresh evidence](evidence/large-project-reuse-roundtrip-20261024.json) records run
`20261024T075000065189Z`, with the same original 736,091,936-byte project, full
GUI/MCP round trip, unchanged 4 GiB Job cap and 25% CPU limit, and no forced GC.

| Measurement               |                    Previous run |                 Chunk reuse run |
| ------------------------- | ------------------------------: | ------------------------------: |
| Peak aggregate Job memory | 4,236,947,456 bytes (3.946 GiB) | 2,816,126,976 bytes (2.623 GiB) |
| Headroom below 4 GiB      |                       55.33 MiB |        1,410.33 MiB (1.377 GiB) |

Peak usage drops by **1,420,820,480 bytes (1.323 GiB), or 33.5%**. All 2,808
download reads and 702 upload writes complete, the original file SHA-256 remains
unchanged, all 16 geometry carriers and six history steps match, and Undo/Redo,
retry and stale-revision checks pass. The final rendered screenshot was inspected.
All 17 owned processes exit with zero active descendants and no capture/cleanup
errors; handles and completion port close successfully.

The production build and 180 focused tests across 15 files pass. New regressions
cover reuse without another shared allocation, complete incoming-file validation,
corrupt-cache replacement including a late stream-block mismatch, ordinary-buffer
fallback and shared worker transport identity. A real-browser repeat restore proves
physical backing reuse while retaining byte-exact encoding and native cloud poses.

This result uses a persistent browser profile. Private/incognito mode was not
rerun after this change; larger projects, populated replacement and in-flight
cancellation remain separate capacity/lifecycle scenarios.

## Persistent versus private context

The earlier harness created an isolated profile directory but used Playwright
`browser.newPage()`, which creates a private context. The corrected harness uses
the isolated persistent default context and the same viewport, inputs, commands,
assertions, cap, deadlines and ownership runner. Actual IndexedDB Blob files were
observed in that disposable profile; only file metadata was inspected.

Chromium stores persisted IndexedDB Blobs on disk, and retains deleted records'
backing while a client Blob is still active. Private/incognito IndexedDB stays
memory-backed. [Chromium IndexedDB design](https://chromium.googlesource.com/chromium/src/+/master/content/browser/indexed_db/docs/README.md).

The earlier disk-backing candidate exceeded 4 GiB during reimport in the private
context. That failure is retained separately in the evidence; the later chunk
reuse change has not been rerun there. Disk-backed memory
validation requires a persistent profile; IndexedDB API availability alone does
not establish disk backing. This test-context change is explicit, and the earlier
private captures are not relabeled as successful tests. Transfer validation does
not establish native alignment or convergence equivalence.
