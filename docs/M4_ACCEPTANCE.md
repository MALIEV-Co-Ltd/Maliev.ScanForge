# M4 construction and sketch acceptance

Tracks [issue #4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/4)
and milestone 5. The live trackers carry merge and closure status. The evidence
below distinguishes application/public MCP results from native observations
and the remaining release gates.

## Required scope still in progress

The owner-approved [reference-construction design](superpowers/specs/2026-10-23-reference-construction-design.md)
requires picked point/line inputs, pair and average lines, primitive-center and
pair points, three-plane points, and CAD/scan source acquisition. The numeric
and one-line midpoint candidate does not complete that scope. Remaining input
families and original-native mode/lifecycle acceptance remain release blockers.
They are being implemented and verified before PR #17 can merge or M4 close.

The existing integrated receipts describe candidate `04c7026`. A subsequent
[derived-point/cloud-pick checkpoint](evidence/m4-derived-point-cloud-pick-acceptance-20261026.json)
records build `scanforge-5e63abfd85df5fab`, shared center/pair/three-plane points,
actual GUI/public-MCP cloud vertex picks for points and line endpoints, exact
encoding across JSON, source deletion and worker reopening. Numeric-plane
edits/transforms refresh point chains atomically; other mesh writers reject
invalidating linked plane sources. The later checkpoint records build
`scanforge-9dfaedad90e869ce`, 249 focused passing tests and actual GUI/public-MCP
pair/average line comparisons, preserving repeated records, edit Cancel and
worker reopen. A separate rendered deferred-Preview harness passes for fractions,
line endpoints and point coordinates. Required input families, native acceptance
and final current-head release verification remain open.

The [analytic-source/editor checkpoint](evidence/m4-analytic-editor-acceptance-20261026.json)
records build `scanforge-e36c99758d1515a0`, real-worker sphere/cylinder inputs,
shared GUI/MCP CAD rebuild of mixed reference descendants, locked-source
preservation and numeric editor initialization with Cancel/Apply, history and
worker reopening. The subsequent full suite passed 49,590 tests, skipped 64 and
failed 15. Corrected admission assertions and detached repeated-record primitive
results pass 198 focused regressions. Hosted CI for checkpoint
`8a95c9748685f25717318665dcaa72fce8020119` subsequently passed the build,
49,605 tests with 64 conditional skips, CAD smoke and repository formatting
([run 40257603548](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40257603548)).
Later acquisition changes require fresh verification. These results do not close
the remaining required gates.

The [CAD/mesh acquisition checkpoint](evidence/m4-cad-acquisition-acceptance-20261026.json)
records build `scanforge-05dd00833777a05e`: GUI and MCP share revision-bound jobs
for exact CAD vertices, finite curve endpoints/parameter fractions and original
mesh vertices or normalized screen picks. The final rendered public-MCP run
passes numeric-only source deletion, history/reopen, fitted-plane point-source
admission and transform refresh, and cancellation that waits for the owned native
query to finish. Camera/clipping, indexed source identities and operation-local
work limits have focused coverage. A separate real React/API observer regression
verifies prompt release of private source bindings after GUI model publication
without a scene walk on camera-only renders. The full build, 95 initial focused
cases, 35 later API/owner cases (overlapping acquisition coverage), 11 real worker
checks and four observer cases pass. Full hosted verification of the next commit,
original-native acceptance and reference transform/duplication policies remain open.

Original native R10 cloud-pick acceptance exposed a four-ULP precision difference:
the saved point contains `6.80000019073486` after the native numeric control's
15-significant-digit text roundtrip. The shared operation now models this stage
after the separate float-pick quantizer, and the exact QSF regression passes
through API and real GUI/public-MCP verification. R11 distinguishes positive
G15 halfway rounding from fixed-six editor initialization. Desktop input failed
before R11 persistence; no QSF save/reopen or complete numeric parity is claimed.

## Capability inventory

| Capability                                                           | Shared application and MCP coverage                                                                                                                                                                                                                                                                        | Current acceptance boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numeric reference points, finite lines and finite axes               | `reference_construct`, `reference_construction_get`; shared cached preview, exact Apply, edit, Cancel, history and project persistence. GUI **Reference axis (finite)** creates the same directed finite semantic line.                                                                                    | Public stdio MCP and rendered GUI comparison pass, including ownership, expiry and retryable display cleanup. Native point/line acceptance and line file reopen are observed; this does not establish every native construction branch or an infinite-axis model.                                                                                                                                                                                                                                           |
| Line-derived midpoint                                                | `reference_construct` with `mode:"midpoint"` retains one existing semantic numeric line source; source edits refresh dependent points atomically, with lock/cycle/deletion guards and current/history/future admission.                                                                                    | GUI/public MCP, exact cached Apply, dependency edits, history and project reopen are covered. Native midpoint acceptance and editor readback pass; native midpoint file persistence remains unverified. Other source-derived modes remain gated.                                                                                                                                                                                                                                                            |
| Numeric planes and coordinate systems                                | GUI and `datum_construct` create/edit numeric planes and explicit coordinate frames with authoritative rigid frames and display sizes. Shared inspection, alignment references, persistence/history and stale-edit guards expose the same data to agents.                                                  | Focused API/core tests and actual GUI/public MCP lifecycle checks cover supported plane/frame routes, worker reopen and downstream placement/alignment. Finite axes use semantic lines rather than hidden frame objects. Additional native plane-construction modes and native frame comparisons remain open.                                                                                                                                                                                               |
| Primitive fitting and materialization                                | GUI and `analysis_fit` / `primitive_fit_create` share original-precision sampling, selection defaults and spherical regions; persistent plane frame and exact CAD sphere/cylinder/cone. Plane transforms use the shared operation and detach fitted metadata.                                              | Analytic and original PLY GUI/MCP comparisons, CAD creation and worker reopen pass. Native fit/residual equivalence remains open; passing application checks do not certify native numerical parity.                                                                                                                                                                                                                                                                                                        |
| Sketch placement from origin, reference planes and coordinate frames | GUI and `sketch_manage` use origin planes, stored `planeFrame` or explicit frame XY/YZ/XZ planes, with preserved tangent and signed normal offset. Legacy fit-plane fallback remains supported.                                                                                                            | Detached placement is explicit: later source edits do not move saved sketches. API and GUI/public MCP checks cover supported source placement and saved frames. This does not implement live sketch-on-face dependencies.                                                                                                                                                                                                                                                                                   |
| Shared canvas drawing                                                | `sketch_draw` exposes line, center/radius circle, three-point circle/arc and endpoint movement using raw UV intents, shared grid snapping, explicit line relation/tolerance options, work limits and scoped history. Canvas submission captures the first gesture revision; Escape discards pending input. | Pure/API/viewport/history tests pass. Actual canvas gestures and independent public MCP intents produce equal canonical geometry, topology and constraints, with Escape, failed-constraint atomicity, scoped history and worker reopen verified on the integrated build. Native curve and solver numerical comparisons remain open.                                                                                                                                                                         |
| Existing Sketch v1 authoring                                         | Shared `sketch_set`, `sketch_solve`, corner trim, fillet, paint-trim and mirror operations; constraints, scan-section references, rigid placement and analytic line/arc extrusion profiles persist.                                                                                                        | GUI/public MCP tests cover failed-constraint atomicity, Cancel, scoped history, section projection, closed profiles, downstream extrusion and worker reopen within the tested fixtures. Extended mirror/junction/fillet/paint-trim browser acceptance passes, including rejected edits, Escape, scoped history and worker reopen. Native constraint/profile comparisons remain open. Full ordered child/source provenance, duplication and unsupported curve families are not supplied by this graph model. |
| Internal sketch child restoration                                    | Internal line/conic/ellipse backends and recovered source-record arithmetic; conic/ellipse export/restore/fork retain the prior successful backend request separately from the latest failed preparation.                                                                                                  | Mock and actual generated-worker/OCCT tests verify retained arc/circle/ellipse BREP, empty failed-circle state, detached binary64 state and owned handle disposal. This is internal backend restoration, not public ordered Sketch v2, its project codec, spline integration or original-native numerical parity.                                                                                                                                                                                           |
| Additional construction and sketch modes                             | Recovered evaluators and native inventory document other point/line source combinations, plane-construction modes, duplication and curve/path workflows.                                                                                                                                                   | Unsupported modes remain absent from discovery. Each admitted mode needs coherent shared operations, validation, dependencies where applicable, persistence and appropriate native acceptance. The approved required reference modes listed above remain blocking until implemented and verified; unrelated recovered native branches do not expand the milestone automatically.                                                                                                                            |

## Additional native checkpoints

[Original native R6/R8/R9 observations](evidence/reference-native-acceptance-20261026.json)
record plane and section-sketch QSF reopening, a persisted 6 mm circle, and an
accepted 1.8 mm solid exported as STEP. The real application CAD worker imports
that native STEP and the equivalent application extrusion: both solids are
valid, their volumes differ by less than 1e-7 cubic millimetres, and their bounds
match within 1e-6 mm. This verifies representative geometry and placement; it
does not establish topology identity or all required construction modes.

## Verification and ownership

The original isolated candidate started at `e367262fc46b2fee8588c7b3c84ccd41fa7424fa`.
The [intermediate selective-integration checkpoint](evidence/m4-main-integration-20261026.json)
used base `fcf6e3b209052f5c6bf606dc9f61a8935e8f9f2a` and build
`scanforge-20aed0e955624da9` for its build, focused, GUI/public-MCP, M1 selection,
M6 inspection and real-kernel checks. It predates the latest datum/drawing changes
and the current rebased candidate at `0aba2b6a19f09b369af7eaea4d3bb9ccea4a651d`. The newer
[integrated acceptance checkpoint](evidence/m4-integrated-acceptance-20261026.json)
records build `scanforge-3eb2603ffcf27d68`, its build-input identity, reviewed
runtime patch, 49,254 passed tests and 64 conditional skips, browser checks and
real-kernel receipts. Candidate commit and release closure remain separate gates.
The initial copied pending workspace also contains other milestones' work; a
passing candidate is not permission to commit all copied files. Pin the final
source inputs, review the M4 dependency set and rerun acceptance on the exact
commit before merging.

The retained [integration checkpoint](evidence/m4-public-integration-20261025.json)
records the earlier full-suite result of 49,049 passed, 65 skipped and no failures,
plus build, CAD smoke, public stdio MCP, browser and resource results. Later edits
must receive fresh verification; that checkpoint is not a result for every future
candidate. A full repository formatting check also found inherited pending files;
scoped formatting is recorded separately.

The [plane/sketch checkpoint](evidence/m4-plane-sketch-integration-20261025.json)
adds original-scan source-frame parity, zero-DOF closed-profile solving, sketch
history and worker reopen. Actual canvas pixels verify readable curves in light
and dark themes and preserve dashed construction curves. Its full run had
49,084 passes, 65 skips and one obsolete ribbon assertion; the corrected ribbon
and display suites passed separately. That failed full receipt remains retained.

The later [midpoint checkpoint](evidence/m4-midpoint-integration-20261025.json)
adds a point linked to one semantic stored endpoint line, atomic source-edit
refresh, lock/deletion rejection and full project/history admission. That earlier candidate's
full suite passed with 49,112 passed and 65 skipped; public browser and MCP
checks pass. Other source families, native comparisons and complete M4 remain open.

Heavy checks run serially in owned Windows Jobs with a 4 GiB total limit, 25 percent
CPU cap, free-memory admission and finite leases. Each receipt records owned
process cleanup. Browser checks use private loopback ports and disposable profiles.
Native scenes belonging to other milestone tasks must be preserved.

The root desktop automation runtime fails before executing JavaScript with
`failed to write kernel assets`; a separate agent context initializes correctly.
The [native GUI checkpoint](evidence/m4-native-gui-checkpoint-20261026.json)
records an accepted point and a line with edit-dialog readback, plus a saved QSF.
The line displayed 10 mm. A later owned session reopened that QSF and verified the same line fields and
10 mm length. A subsequent owned session accepted the constructed line midpoint at (5,0,0)
and reopened its editor with Line Middle Point mode and the correct source.
Native midpoint file persistence remains unverified. The initial point/line QSF
session's final save exceeded its input cutoff by seven seconds; its watchdog receipt is
a retained failure despite complete process cleanup. A fresh bounded owned native process supplied
private static code sections and exited cleanly. Static recovery can resolve
implementation questions; it does not replace native rendered interaction,
numerical comparison or actual native project save/reopen acceptance. Native code
and analysis carriers remain private.

## Closure gates

- Complete the inventory and missing shared construction/sketch behavior without
  substituting convenient arithmetic for unresolved native branches.
- Verify analytic and original scan workflows through GUI and public MCP,
  including failure, cancellation, locks, retries, history and project reopening.
- Verify source dependency edits, cycle rejection, transforms, deletion,
  duplication and recovery for every admitted derived construction mode.
- Complete native frame, fit residual, curve, constraint and closed-profile
  comparisons on identified original inputs; preserve failed receipts and scope.
- Run build, static checks, appropriate integration tests and resource cleanup
  against the pinned final commit, then review and merge that commit into main.
- Verify the merged main revision before closing issue #4 and milestone 5.
