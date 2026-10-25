# Current-candidate original STL global alignment

The current working candidate completes the coarse-placed original-three STL
Global Fine Align workflow through GUI Preview, public MCP cached Apply, all
current buffer digests, Undo/Redo, timeline checks and project save. The final
worker observation and process cleanup also pass. This closes the stale-candidate
gap in the earlier retained assessment; full native and milestone acceptance
remain open.

[Structured evidence](evidence/original-stl-global-current-quality-20261024.json)
identifies HEAD `e367262fc46b2fee8588c7b3c84ccd41fa7424fa` plus its recorded
uncommitted changes, source manifest
`aa3868414a44301046783fe5a9acc066975e3741fb20bdf93d6d46109e821195`,
and all 2,251 frozen source/build inputs. It must not be attributed to pushed
`main`. The build passed with 1,978 unchanged compiler inputs and an empty stderr
log. The focused alignment/MCP regressions passed 106 tests across eight files.

## Workflow and agent coverage

This run opens the retained full-size coarse/refined project, rather than
repeating raw-file imports. Its 3,121,976 indexed vertices and 6,147,452 accepted
triangles retain the original STL hashes and topology. All 13 authored baseline
carriers match the retained coarse-placement receipts. Legacy activation also
initializes three computed-normal carriers, giving 16 current buffers.

The GUI uses the shared Global Fine Align operation at `0.5 mm`, with parallel
execution enabled. Public MCP job/state results agree with the staged preview,
including exact Float64 transform bits and ordered application stages. Cached
MCP Apply creates one history entry without launching another solve. All 16
buffer digests restore exactly on Undo and Redo, with matching timeline state.
The saved project includes the complete history and is 736,091,936 bytes, SHA-256
`cea96674341c61576523076bed0d6347b554e277127cbeba6c59cf6c40f67dea`.

This is GUI Preview plus public MCP observation/cached Apply. It does not claim
an independent fresh MCP preview solve, a new save/reopen run, or the remaining
retry, revision-mismatch, in-flight cancellation and combined-output acceptance.
Application operations, schemas, catalog and agent usage did not change here.

## Independent complete-geometry checks

The separate checker evaluates every indexed vertex before and after: 6,243,952
measurements against the other scans' full triangle surfaces. It uses the same
independently pinned BVH libraries and analytic/brute-triangle controls described
in the [retained assessment](ORIGINAL_STL_GLOBAL_QUALITY.md). It imports no
application registration code and performs no downsampling.

Fixed support retains the exact vertex IDs within `0.5 mm` before global
alignment, including their after-distances when they exceed that cutoff.

| Scan       | Fixed overlap vertices | RMS before (mm) | RMS after (mm) | P95 after (mm) |
| ---------- | ---------------------: | --------------: | -------------: | -------------: |
| scan-1.stl |                 51,039 |        0.169815 |       0.163303 |       0.405096 |
| scan-2.stl |              1,272,780 |        0.052089 |       0.045477 |       0.055515 |
| scan-3.stl |              1,666,828 |        0.068309 |       0.060190 |       0.089630 |

Across the same 2,990,647 overlap vertices, RMS decreases from `0.065173 mm` to
`0.057918 mm`. These unsigned, vertex-weighted distances establish improvement
for this run, not physical scanner accuracy or a release quality threshold.

Independent Float64-bit decoding and two literal Float32 transform stages
reproduce all 9,365,928 indexed and 55,327,068 expanded coordinate values in the
saved project byte-for-byte. All 18,442,356 triangle-index values remain
unchanged. Original STL hashes are reverified. Normal carriers have complete
workflow/history digest coverage, but are not independently reconstructed by
this coordinate checker.

The controller stops after two passes with all scans stable and none converged.
Final mean diagnostics are approximately `0.039113`, `0.023783` and `0.039779 mm`.
The native local convergence threshold remains `0.001 mm`; measured improvement
does not turn those false flags into a convergence pass. Sampling uses actual
clock inputs, so this run has its own geometry and quality receipts.

## Resource and failure evidence

The full application workflow peaks at 3,157,667,840 bytes under the unchanged
4 GiB aggregate Job cap and 25% CPU limit. All 17 owned processes exit, final
active count is zero, retained handles close, and cleanup/capture errors are
empty. The exhaustive assessment takes 58.67 seconds with a separate analysis
Job peak of 866,758,656 bytes; publication verification peaks at 760,999,936
bytes. Heavy jobs run serially with finite leases.

Two earlier attempts remain recorded as failures. The first completes save but
times out a final 1.5-second worker-record observation. The second fails because
a private harness copy used Windows' default encoding and corrupted an exact UI
text match. The final UTF-8 copy is verified to differ from the original harness
only in that observation budget, raised to six seconds. The 900-second overall
lease, 60-second cleanup reserve, resource caps and pass criteria remain intact.
All failed attempts also have terminal process-cleanup evidence.

No original-native application was executed or accessed in this step. Final
native controller/setter/imported-geometry comparison, other formats and
point-cloud workflows, usable combined output, M1 dependency and reviewed
milestone acceptance remain required. No commit, push or GitHub mutation was
performed. The local development app remains available on port 5173.
