# Large-project replacement and cancellation

The pinned validation snapshot passes full-size project replacement into a
populated workspace, cancellation of a submitted decoder, rollback and retry
through public MCP. This supplements the [saved-project round trip](LARGE_PROJECT_MEMORY_FIX.md).
It does not establish acceptance of subsequent changes in the primary checkout.

[Structured evidence](evidence/large-project-populated-replacement-20261024.json)
records source/build identities, all geometry digests, resource ownership and
the rejected first attempt. The local base commit is
`e367262fc46b2fee8588c7b3c84ccd41fa7424fa`, plus the captured uncommitted changes.
No commit, push, release or native application execution was performed.

## Exact workflow

The GUI opens the original-three saved aligned STL project. Public MCP verifies
all 16 current geometry buffers, complete history, Undo/Redo, identical-request
retry and stale-revision rejection. Export, download and upload retain all
736,091,936 bytes; SHA-256 is
`cea96674341c61576523076bed0d6347b554e277127cbeba6c59cf6c40f67dea`.
No scan is sampled, reduced or substituted.

The disposable destination retains all three scans. Undoing only the last Global
Fine Align leaves five applied history steps and one redo step, with geometry
that differs from the saved project. `project_import` with `replace:true` must
restore the saved buffers and six-step history; an unchanged destination cannot
satisfy this check. Automatic backups remain enabled.

| Run                      | Result                                                                   | Peak aggregate Job bytes |
| ------------------------ | ------------------------------------------------------------------------ | -----------------------: |
| `20261024T071603574890Z` | Populated replacement, all 16 buffer digests, history and timeline pass  |            4,241,915,904 |
| `20261024T072139366736Z` | Decoder cancellation, rollback, receipt retry and fresh replacement pass |            4,235,284,480 |

Both runs retain the 4 GiB memory limit, 25% CPU limit and finite leases. All 17
owned processes exit in each run; final active counts are zero. Normal identity
coverage passes, handles and completion ports close, and capture/cleanup errors
are empty. Headroom remains narrow, approximately 51–57 MiB. This is not a
worst-case admission guarantee for other projects.

## MCP cancellation and retry

The cancellation check observes a fresh live `project-decoding-worker` target
and a main-thread record showing the file was posted before issuing `job_cancel`.
`job_get` settles to `cancelled` with error code `CANCELLED`. The target retires,
all 16 current buffers retain their before-state digests, and the five-step
history/one-step redo state is unchanged. The complete upload remains available.

Retrying the identical `project_import` request returns its original
acknowledgement and job ID, without starting another decoder. Its original
acknowledgement can still say `running`; `job_get` supplies the current cancelled
status. A new request ID and freshly read expected revision start a new import
using the retained artifact. That import restores all saved buffers, six history
steps and the current timeline selection. The transfer artifact is then deleted.

GUI project opening and public MCP import use the shared project decoder.
The checks use `project_get`, `history_get`, `history_undo`, `history_redo`,
`project_export`, `artifact_read`, `artifact_put`, `artifact_delete`,
`project_import`, `job_get`, `job_cancel`, `object_geometry_digest` and
`session_get`. Existing schemas, revision guards, retry rules and history
semantics are unchanged. GUI cancellation controls were not exercised here.

## Isolation and verification

The first populated replacement attempt completed browser checks, but a
concurrent primary build replaced a frozen `dist` input before final verification.
Run `20261024T070318600903Z` is rejected as acceptance evidence.

A managed validation worktree received a byte-checked copy of 2,617 source and
documentation files. Its successful build retains 2,578 unchanged build inputs,
including agent documentation. The source manifest for both accepted runs is
`764d4421c0f27f0e9572792745b0c08a0d0298e6942765e8f8b449008e742d4c`.
All frozen source/build inputs match before and after each accepted run. The
isolated focused suite passes 96 tests across eleven files. The rendered
post-replacement frame was reviewed. Full unit and CAD suites were not rerun.

The primary checkout has independent later edits, including point-cloud display
work. These results belong to the isolated snapshot; they are not attributed to
those newer edits or pushed `main`. The live development server remains on the
primary checkout at port 5173, and its user project was not changed by these runs.

## Remaining acceptance

This covers persistent-profile `.scanforge` replacement, not raw STL/PLY/ASC
import, backup restoration, native controller/setter comparison, a new alignment
solve, alignment cancellation, strict convergence or usable combined-output
quality. Private/incognito large-project reimport remains memory-limited. M1,
M3 and the broader reconstruction milestones remain open.
