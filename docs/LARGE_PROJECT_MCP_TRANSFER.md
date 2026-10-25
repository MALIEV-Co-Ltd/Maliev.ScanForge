# Large-project MCP transfer investigation

**Historical investigation:** the candidates below did not complete the full
round trip. The later [memory correction](LARGE_PROJECT_MEMORY_FIX.md) now passes
the original 736 MB workflow under the same 4 GiB cap in a persistent profile,
with **1.377 GiB of headroom** after shared restore chunk reuse. Earlier narrow
passes and private-context failures remain recorded separately.

The original-three aligned project is 736,091,936 bytes. GUI reopening restores
all 16 current geometry carriers and the full six-step modeling timeline. MCP
previously rejected its export because the artifact store allowed only 512 MiB,
even though project encoding had completed successfully.

The uncommitted candidate raises the logical transfer quota to **1 GiB**. The
shared store, `capabilities_get` and discovery descriptions agree. The 64-handle
limit, 1 MiB decoded upload chunks, 256 KiB reads, 900-second inactivity lease,
revision/retry protection and importer admissions remain in force. This changes
the logical transfer quota; the validation Job remains capped at **4 GiB**.

The complete GUI reopen and MCP export/download/upload/reimport round trip now
passes in a normal persistent browser profile under the **4 GiB** cap. All 16
geometry-buffer digests and the six-step history match. Private/incognito
reimport failed earlier candidates and has not been rerun after chunk reuse.
This scoped result does not establish full
alignment feature or milestone acceptance.

## Reproduced behavior

[Structured evidence](evidence/large-project-mcp-transfer-investigation-20261024.json)
pins the candidate source/build inputs, public API results, process ownership,
resource measurements and focused test receipts. The candidate is local HEAD
`e367262fc46b2fee8588c7b3c84ccd41fa7424fa` plus recorded working changes; it is
not attributed to pushed `main`.

The real saved project passes GUI reopen and all 16 buffer digest comparisons
against the prior alignment run. MCP Undo restores the complete before-state,
an identical request retries the original receipt without another Undo, a stale
Redo request is rejected, and a fresh Redo restores the full after-state and
timeline. The retry test compares settled live state before and after retry;
the original cached response revision can precede later UI state settlement.

| Candidate                              | MCP project export           | Download bytes before retirement | Result                              |
| -------------------------------------- | ---------------------------- | -------------------------------: | ----------------------------------- |
| Original 512 MiB quota                 | `RESOURCE_LIMIT`             |                                0 | Artifact capacity defect reproduced |
| 1 GiB quota                            | Succeeded, 736,091,936 bytes |                      223,346,688 | 4 GiB Job limit reached             |
| 1 GiB quota, bounded string conversion | Succeeded, 736,091,936 bytes |                      554,172,416 | 4 GiB Job limit reached             |

The two interrupted downloads are partial artifacts, not usable round-trip
outputs. No MCP reimport completed in either run. Their resource-limit events
invalidate full workflow acceptance; they have not been removed or relabeled as
successful application tests.

The owner terminates only its exact private Job. Both limit failures finish with
zero active Job processes, all retained observed processes exited, closed handles
and no cleanup errors. Complete normal identity-event coverage does not pass
after the memory-limit event. Observed Job peaks are retained verbatim in the
evidence rather than interpreted as successful operation within the limit.

## Allocation correction and checks

The original artifact reader appended a one-character string for every byte.
A maximum-size read therefore performed 262,144 string conversions. The
candidate converts bounded 8,192-byte blocks, at most 32 per read, then emits
the same base64 response. A failing allocation regression and byte-exact test
cover every byte value, padding, next offset and end-of-file behavior. This
removes avoidable temporary string nodes; the repeated full-file run shows that
it does not by itself resolve total browser memory usage.

All 11 artifact policy/behavior tests and 129 focused tests across eight files
pass. They retain exact quota-boundary, over-cap rejection, append preservation,
deletion, expiration, handle-limit and discovery checks. Large logical-size unit
fixtures use tiny backing allocations; the actual 736 MB browser runs above are
separate evidence. The latest build passes with 1,978 unchanged compiler inputs
and an empty stderr log. Targeted source/catalog/test/agent-document formatting
passes. Full unit and CAD suites were not rerun for these changes.

## Retention follow-up — 2026-10-24

[Follow-up evidence](evidence/large-project-retention-followup-20261024.json)
records the later candidate separately from the historical runs above. Concurrent
GUI/backup/MCP encodes of the same immutable snapshot share one worker, with
independent consumer cancellation. A weak reference permits reuse of the last
completed file while another consumer owns it. Backup change detection keeps
identity tokens instead of saved geometry/history; document replacement updates
the pending backup immediately. Decoding writes directly into final shared
readonly backing and verifies its hash without a full private chunk copy.

The two retention regressions fail against the earlier controller, whose hash
matches the preceding browser run's source receipt. The current retention and
encoding suite passes 90 tests in ten files. The decoder/backup suite passes 90
tests in eleven files; these overlapping counts must not be added. The later
build passes with 1,979 unchanged compiler inputs. These checks exercise the
shared GUI/MCP paths; they do not establish full-size import success.

Run `20261024T063314116586Z` restores the GUI project, verifies the existing
Undo/Redo/retry checks, downloads all 736,091,936 bytes in 2,808 public reads,
and uploads those same bytes in 702 public writes. The downloaded SHA-256 is
`cea96674341c61576523076bed0d6347b554e277127cbeba6c59cf6c40f67dea`.
MCP reimport then reaches the memory guard. The recorded Job peak is
4,328,476,672 bytes; it is a failed admission result, not operation within the
4 GiB limit. All retained observed processes exit, final active count is zero,
handles and completion port close, and cleanup reports no errors. Normal
identity-event coverage does not pass after the limit event.

The container has 33 decoded chunks totaling 1,408,041,588 bytes. Sampled browser
private memory is about 963 MiB immediately after export deletion and scene
clear, then about 1,558 MiB near the end of upload. The renderer remains about
1,898 MiB at that upload sample while the main page JS heap is about 29 MiB.
These measurements identify overlapping large backing storage as the next
investigation boundary; they do not prove a particular live reference or exact
allocation owner. Neither retention fixes nor direct decode backing alone
resolve the full workflow.

## Persistent-profile round trip — 2026-10-24

[Successful round-trip evidence](evidence/large-project-mcp-roundtrip-20261024.json)
records run `20261024T065015903040Z` separately from the failures above.
The shared encoder stages files of at least 64 MiB through temporary IndexedDB
storage. Public MCP uploads refresh this backing at each 64 MiB boundary. Normal
transaction completion removes the temporary record while the returned Blob
keeps its bytes available. Failure leaves the previous upload unchanged. The
agent guide documents timeout, expiry and storage recovery behavior.

The earlier harness called `browser.newPage()`, creating a separate private
context despite its disposable profile directory. The successful harness uses
the default context belonging to that isolated persistent profile. Inputs,
full-history requirements, public transfer limits, geometry checks, finite leases,
4 GiB memory limit and 25% CPU limit are unchanged. The private-context failure
remains retained; it has not been relabeled as a successful run.

The persistent run completes all 736,091,936 bytes in both directions, preserves
the recorded file SHA-256, and restores all 16 geometry buffers and six history
entries through MCP. GUI reopen, Undo/Redo, identical-request retry and stale
revision rejection pass. Transfer artifacts are deleted and the current timeline
step is verified. The post-import screenshot was inspected; it shows the three
STL objects and restored timeline. This is persistence evidence, not new
registration-quality or native-rendering acceptance.

Observed Job peak is 4,233,691,136 bytes (about 3.94 GiB). All 17 owned processes
exit, final active count is zero, normal identity-event coverage passes, handles
and completion port close, and capture/cleanup errors are empty. Margin is small;
this does not establish admission for every project.

A separate persistent-profile browser probe stages and rereads all 67,108,864
bytes after database-record deletion. The physical IndexedDB file and returned
bytes share SHA-256
`d7283b99ddf012611e734298334482c2cab5921ec43f52dd6485acb17c44802a`.
Small-file identity, pre-abort and cancellation while opening pass, with zero
remaining records. This small storage check supplements the full-size workflow;
it does not replace it. Added public-API regressions cover deletion, concurrent
replacement, expiry, API disposal and storage failure during a pending upload.
The serialized focused run passes 60 tests across six files. An earlier focused
run briefly overlapped another test batch and is not used as serialized evidence.
The production build passes; full unit/CAD suites were not rerun.

## Remaining work

The latest [shared restore chunk reuse run](evidence/large-project-reuse-roundtrip-20261024.json)
completes the same 736,091,936-byte round trip at **2.623 GiB peak**, leaving
**1.377 GiB** below the unchanged 4 GiB cap. All 16 geometry carriers and six
history steps match; 180 focused tests and the production build pass. GUI opening,
MCP `project_import` and backup restore share the corrected decoder. Private mode
has not been rerun after this change.

The earlier incremental encoder passed an original-size round trip in run
`20261024T072655174588Z`: all 736,091,936 bytes in each direction, all 16 geometry
carriers and six history steps preserved, and clean exit of all 17 owned
processes. Peak is 4,236,947,456 bytes under the unchanged 4 GiB cap, with 55.33 MiB
headroom. This adds no private-context or populated-replacement acceptance. See
[the rerun evidence](evidence/large-project-checkpoint-roundtrip-20261024.json).

Private/incognito reimport failed before shared chunk reuse and has not been
revalidated for the current candidate. Continue investigating its
backing ownership without forced garbage collection, a cap increase or smaller
acceptance fixtures. The successful destination was explicitly cleared before
MCP import; large in-place replacement and in-flight cancellation require
separate checks. Preserve the successful full-size round trip as a regression
gate while completing those paths.

No original-native application was accessed here. Native final controller/setter
comparison, false convergence flags, remaining STL/PLY/ASC lifecycle workflows,
usable combined output, M1 dependency and the other reconstruction milestones
remain open. The current development app stays available on port 5173. No commit,
push or GitHub mutation was performed.
