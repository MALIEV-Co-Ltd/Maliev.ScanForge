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

The [numeric-reference transform checkpoint](evidence/m4-numeric-transform-acceptance-20261026.json)
records build `scanforge-c6fcc0fb53c79136`, 205 focused/regression passes, all 13
type-check batches and a rendered GUI/public-MCP run. Numeric points and endpoint
lines with empty source/pick sets share `mesh_transform`, exact payload/definition
inspection, atomic descendant refresh, history and worker reopen. Line direction
transforms without normalization and its stored length remains unchanged. The
browser verifies actual Move/Scale, one history step and numeric editor Cancel.
Derived modes, inactive retained line picks, duplication and original-native
controller/acceptance policies remain separate required gates. The acquisition
checkpoint's hosted 49,679 tests, build and CAD smoke passed; its worker formatting
failure was corrected in `d0353e9`, whose fresh hosted build, full tests, CAD smoke
and repository formatting pass. Numeric-transform checkpoint `df8e001` passed
49,742 tests but retained one obsolete rejection assertion. Correction `f8c9472`
verifies linked-source refresh instead; its fresh hosted build, 49,743 tests
(64 skips), CAD smoke and repository formatting pass
([run 40269732059](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40269732059)).

The [shared sketch semantic-edit checkpoint](evidence/m4-sketch-semantic-acceptance-20261026.json)
records build `scanforge-ffc037277fd23aa7` with zero build warnings/errors,
all 13 type-check batches and 116 focused checks. The GUI panel and `sketch_edit`
share presets, placement, numeric coordinates, topology, construction flags,
dimensions, relation construction, solving and analytic profile preparation.
The rendered public-MCP run compares independent intents, failed constraints and
profiles, scoped history, extrusion, worker reopen and both sketch-display flags.
Real sequential decimal/negative typing, Escape without publication and a direct
Solve click pass after fixing per-keystroke focus loss. Legacy coordinate repair
is tested while all published candidates retain prospective bounds. Solver
diagnostics have operation-local resource guards without a project-size cap.
Hosted checkpoint `f3c7cc2` passes build, 49,819 tests (64 skips), CAD smoke and
repository formatting ([run 40271644943](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40271644943)).
The [main-integration checkpoint](evidence/m4-main-integration-20261026.json)
combines it with M3 main `57c77aa`: 5,969 regression checks across 135 files,
all 13 type-check batches, a zero-warning build and fresh sketch/construction
GUI/public-MCP browser acceptance pass on `scanforge-cccb59cddb128b66`.
Reference identity, acquisition ownership, quota-aware geometry inspection,
normal buffers and history/visibility behavior are retained. The integration
requires its own exact-head hosted checks. Required source-family and
original-native gates remain open.

The [cone-source checkpoint](evidence/m4-cone-source-acceptance-20261026.json)
adds positive, equal and inverted-radius current cone recipes to shared point
center/pair and line pair/average construction. Its 146 focused checks and 7,871
affected regressions pass. All 13 type-check batches and the zero-warning build
pass; a format-only production refresh preserves `scanforge-b3d5b1cab378d17b`.
Real-worker GUI/public-MCP acceptance verifies actual cone/cylinder classification,
end radii and axial bounds within 1e-4 mm, tessellated volume within 3 percent,
repeated-record averages, radius-order rebuilds, locks, rollback, history and
binary reopening. This application recipe bridge does not claim native controller,
owner/provider or whole-construction equivalence. That checkpoint predates the
authored plane line inputs below. Retained general CAD/scan inputs and other
original-native gates remain open.

The [authored-plane checkpoint](evidence/m4-plane-source-acceptance-20261026.json)
adds retained `planeFrame.displaySize` and shared local-U/V line-pair inputs.
The focused suites pass 187 tests, with 73 corrected legacy contract tests also
passing. The broader failed receipt is retained rather than counted as a pass.
All 13 type-check batches and the zero-warning functional build pass. A later
presentation-only refresh produces `scanforge-598e491b941b7328`; actual GUI/public
MCP comparison verifies negative/decimal keyboard input, stored-size edit Cancel,
two-plane extent refresh from 20 to 36 mm, source movement, lock rollback and
binary current/history/future reopening. Final screenshots show aligned U/V
controls and clear source/derived geometry. This explicit authored-square mapping
does not establish the original native extent producer/controller. R14 failed
before modeling. R16 later verified one midpoint source-edit/save-reopen case;
it does not close the authored-plane extent or other native acceptance gates.

The [duplication-availability checkpoint](evidence/m4-reference-duplicate-guard-20261026.json)
fixes an enabled unsupported GUI action: semantic reference points and lines now
use the shared duplication predicate for menu availability and MCP execution.
The affected type check and zero-warning production build pass, as do 158 focused
tests and the actual GUI/public stdio MCP browser workflow on
`scanforge-ef836f21c2055ee2`. Numeric and derived reference Duplicate items are
disabled; MCP rejection preserves objects, revision and history. The same browser
workflow matches R16's native line endpoint 10 to 20 mm and midpoint 5 to 10 mm
case through history and project reopening. This guard does not implement
reference duplication or complete native copy/transform policy. Required input
families and other native acceptance gates remain open.

The [fitted-plane duplicate checkpoint](evidence/m4-fitted-plane-duplicate-20261027.json)
records a separate original-native fitted plane duplicated, saved and reopened,
with the copy's displayed normal and offset retained. On the same PLY file,
actual application GUI Duplicate and public MCP `object_duplicate` produced
distinct objects with equal application fit and frame; undo and MCP-copy worker
reopen passed. The original and application fit populations are not established
as equivalent, and native copy links, other modes and semantic reference point
or line duplication remain open. Strict saved-file readback confirms the four
original record spans are unchanged and a fifth plane-type span is appended;
excluding its name and two changing 16-byte fields leaves one unexplained byte
difference across 304 compared bytes. A byte-verified serializer prefix and
readback show distinct identities and empty saved common source/dependent sets
for this case. A statically traced candidate payload is identical in both saved
records and contains a vector matching the displayed normal. The remaining
32-byte tails are identical and all zero in this zero-list case; their field
meanings and live binding remain unverified. Native displayed normal and
application axis differ by approximately 0.014° ignoring sign, but their
sampled populations are not known to match. These observations do not establish
general link or fit parity.

The [scan-plane sketch guard checkpoint](evidence/m4-scan-plane-sketch-guards-20261027.json)
extends the original scan, fitted-plane and sketch workflow with GUI draft
cancellation and GUI/public MCP conflicting-constraint rejection, GUI/public
MCP scoped undo/redo, reopening both sketches and an unchanged scan geometry
digest. This is application/public MCP evidence; native fit, frame and solver
parity remain open.

The [native line-pair observation](evidence/m4-native-line-pair-20261027.json)
records a constructed line between two parallel numeric reference lines. The
native editor displayed their midpoints as endpoints and retained both named
sources and the result after QSF reopening. GUI and public MCP produced the same
displayed geometry on the corresponding source endpoints with explicit 0.5
fractions, retained source records and worker reopen; the GUI displayed a
fallback notice. A subsequent native source endpoint edit from 10 to 20 mm
updated both displayed target X coordinates from 5 to 7.5 mm and survived QSF
reopen. The GUI-created pair refreshed to the same geometry through a public MCP
source edit, undo/redo and project-worker reopen. This one dropdown-selected native case does not establish
general acquisition or fallback semantics. The native average picker did not
confirm a source and remains unverified.

Strict saved-record readback of the two native pair projects confirms reciprocal
source/dependent identities, mode 3, ordered source identities and zero-valued
pick suffixes before and after the source edit. The tested application midpoint
fraction route retains nonzero midpoint coordinates for these same sources.
The subsequent [object-selection checkpoint](evidence/m4-pair-object-selection-20261027.json)
uses zero-valued records for this specific pair of numeric endpoint sources.
On build `scanforge-8d14a572c53c5924`,
the isolated GUI/public-MCP run matched those records and geometry, retained an
unchanged source record while editing another, and passed Cancel, source refresh,
undo/redo and project-worker reopen. The 63-file reference suite passed 1,388
tests and all 13 build type-check batches passed. This closes the observed
record discrepancy for that fixture only; native average selection, general
acquisition and other native acceptance gates remain open.

Original native R10 cloud-pick acceptance exposed a four-ULP precision difference:
the saved point contains `6.80000019073486` after the native numeric control's
15-significant-digit text roundtrip. The shared operation now models this stage
after the separate float-pick quantizer, and the exact QSF regression passes
through API and real GUI/public-MCP verification. R11 distinguishes positive
G15 halfway rounding from fixed-six editor initialization. Desktop input failed
before R11 persistence; no QSF save/reopen or complete numeric parity is claimed.

## Capability inventory

| Capability                                                           | Shared application and MCP coverage                                                                                                                                                                                                                                                                        | Current acceptance boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Numeric reference points, finite lines and finite axes               | `reference_construct`, `reference_construction_get`; shared cached preview, exact Apply, edit, Cancel, history and project persistence. GUI **Reference axis (finite)** creates the same directed finite semantic line.                                                                                    | Public stdio MCP and rendered GUI comparison pass, including ownership, expiry and retryable display cleanup. Native point/line acceptance and line file reopen are observed; this does not establish every native construction branch or an infinite-axis model.                                                                                                                                                                                                                                                                                                              |
| Line-derived midpoint                                                | `reference_construct` with `mode:"midpoint"` retains one existing semantic numeric line source; source edits refresh dependent points atomically, with lock/cycle/deletion guards and current/history/future admission.                                                                                    | GUI/public MCP, exact cached Apply, dependency edits, history and project reopen are covered. Native midpoint acceptance and editor readback pass. R15 saved and reopened a midpoint QSF. R16 verified its recipe/source, edited the line endpoint from 10 to 20 mm, observed midpoint 5 to 10 mm, and saved/reopened the edited construction with the recipe/source intact. This row covers the midpoint checkpoint; the center/pair/three-plane point and located pair/average line checkpoints are described separately. Required unsupported source families remain gates. |
| Numeric planes and coordinate systems                                | GUI and `datum_construct` create/edit numeric planes and explicit coordinate frames with authoritative rigid frames and display sizes. Shared inspection, alignment references, persistence/history and stale-edit guards expose the same data to agents.                                                  | Focused API/core tests and actual GUI/public MCP lifecycle checks cover supported plane/frame routes, worker reopen and downstream placement/alignment. Finite axes use semantic lines rather than hidden frame objects. Additional native plane-construction modes and native frame comparisons remain open.                                                                                                                                                                                                                                                                  |
| Primitive fitting and materialization                                | GUI and `analysis_fit` / `primitive_fit_create` share original-precision sampling, selection defaults and spherical regions; persistent plane frame and exact CAD sphere/cylinder/cone. Plane transforms use the shared operation and detach fitted metadata.                                              | Analytic and original PLY GUI/MCP comparisons, CAD creation and worker reopen pass. Native fit/residual equivalence remains open; passing application checks do not certify native numerical parity.                                                                                                                                                                                                                                                                                                                                                                           |
| Sketch placement from origin, reference planes and coordinate frames | GUI and `sketch_manage` use origin planes, stored `planeFrame` or explicit frame XY/YZ/XZ planes, with preserved tangent and signed normal offset. Legacy fit-plane fallback remains supported.                                                                                                            | Detached placement is explicit: later source edits do not move saved sketches. API and GUI/public MCP checks cover supported source placement and saved frames. This does not implement live sketch-on-face dependencies.                                                                                                                                                                                                                                                                                                                                                      |
| Shared canvas drawing                                                | `sketch_draw` exposes line, center/radius circle, three-point circle/arc and endpoint movement using raw UV intents, shared grid snapping, explicit line relation/tolerance options, work limits and scoped history. Canvas submission captures the first gesture revision; Escape discards pending input. | Pure/API/viewport/history tests pass. Actual canvas gestures and independent public MCP intents produce equal canonical geometry, topology and constraints, with Escape, failed-constraint atomicity, scoped history and worker reopen verified on the integrated build. Native curve and solver numerical comparisons remain open.                                                                                                                                                                                                                                            |
| Existing Sketch v1 authoring                                         | Shared `sketch_set`, `sketch_solve`, corner trim, fillet, paint-trim and mirror operations; constraints, scan-section references, rigid placement and analytic line/arc extrusion profiles persist.                                                                                                        | GUI/public MCP tests cover failed-constraint atomicity, Cancel, scoped history, section projection, closed profiles, downstream extrusion and worker reopen within the tested fixtures. Extended mirror/junction/fillet/paint-trim browser acceptance passes, including rejected edits, Escape, scoped history and worker reopen. Native constraint/profile comparisons remain open. Full ordered child/source provenance, duplication and unsupported curve families are not supplied by this graph model.                                                                    |
| Internal sketch child restoration                                    | Internal line/conic/ellipse backends and recovered source-record arithmetic; conic/ellipse export/restore/fork retain the prior successful backend request separately from the latest failed preparation.                                                                                                  | Mock and actual generated-worker/OCCT tests verify retained arc/circle/ellipse BREP, empty failed-circle state, detached binary64 state and owned handle disposal. This is internal backend restoration, not public ordered Sketch v2, its project codec, spline integration or original-native numerical parity.                                                                                                                                                                                                                                                              |
| Additional construction and sketch modes                             | Recovered evaluators and native inventory document other point/line source combinations, plane-construction modes, duplication and curve/path workflows.                                                                                                                                                   | Unsupported modes remain absent from discovery. Each admitted mode needs coherent shared operations, validation, dependencies where applicable, persistence and appropriate native acceptance. The approved required reference modes listed above remain blocking until implemented and verified; unrelated recovered native branches do not expand the milestone automatically.                                                                                                                                                                                               |

## Additional native checkpoints

[One empty average-line edit](evidence/m4-native-empty-average-20261027.json)
retained the prior displayed line after native save/reopen and after an unsaved
edit of a former source. GUI and public MCP now produce matching empty-average
edits and worker reopening; a separate shared API test covers a former-source
edit. The native picker still reported zero selected, so successful average
acquisition and general native parity remain unverified.

[Native reference history menus](evidence/m4-native-reference-history-menus-20261027.json)
were inspected after reopening one numeric line and its dependent midpoint. Neither
history context menu showed Duplicate. This does not establish whether other native
routes can duplicate references or determine their copy/link behavior.

[Original native R6/R8/R9 observations](evidence/reference-native-acceptance-20261026.json)
record plane and section-sketch QSF reopening, a persisted 6 mm circle, and an
accepted 1.8 mm solid exported as STEP. The real application CAD worker imports
that native STEP and the equivalent application extrusion: both solids are
valid, their volumes differ by less than 1e-7 cubic millimetres, and their bounds
match within 1e-6 mm. This verifies representative geometry and placement; it
does not establish topology identity or all required construction modes.

The [real-scan sketch checkpoint](evidence/m4-real-scan-sketch-20261027.json)
extends the original PLY section workflow through independent GUI and public MCP
sketch edits, conflicting-constraint rejection, GUI draft cancellation, scoped
undo/redo and project-worker reopening. Its 661 unsampled section segments come
from 274,154 eligible scan triangles; source geometry hashes remain unchanged
through reopen. This is application/MCP evidence, not a native section or solver
comparison. Other release gates above remain open.

The [real-scan canvas follow-up](evidence/m4-real-scan-canvas-20261027.json)
aims the viewport at that section and draws a line with an actual GUI gesture.
An independent public MCP `sketch_draw` request produces the same coordinates
and endpoint topology; both sketch undos remove their line. The rendered capture
shows the GUI line against the scan. The line is undone before the separate
rectangle/reopen checks, and no native drawing equivalence is claimed.

The [entity routine investigation](evidence/m4-native-entity-slot-candidates-20261027.json)
verifies two candidate pointer locations and the bytes of their bounded native
listings. The listings compute projected point and line-midpoint candidates;
they do not establish a duplicate factory or its link policy. This static result
does not replace the required original-native duplication and lifecycle checks.
The later [duplicate-command lead](evidence/m4-native-duplicate-command-lead-20261027.json)
binds a duplicate-related label to a UI registration value and a conditional
indirect dispatch in byte-verified static listings. The destination handler,
live receiver and reference-copy semantics remain unverified. A separate
hidden owned-process slot observation and on-disk export lookup support a
`SendMessageW` inference, with mapped-module identity not byte-verified. A
separate owned-process descriptor read identifies `CEditSketchDialog` RTTI for
the nearby table starts. A separate static switch maps the same value to a
selection prompt and a call at an RVA previously associated with sketch
duplication, weakening this as a project-reference duplication lead without
binding the command receiver. Failed import and carrier descriptor lookups
remain retained.

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

The root desktop automation runtime initially failed before executing JavaScript
with `failed to write kernel assets`. The later
[R13 recovery checkpoint](evidence/m4-native-runtime-recovery-20261026.json)
confirms fresh owned original-native pixels, restored file-dialog input and
successful reopening of the immutable numeric-line fixture, followed by clean
bounded-session shutdown. Source-edit persistence and copy/transform policy
remain unverified. The later R14 attempt failed with root cursor access denied
and separate-context kernel-asset initialization errors. Its owned process was
finished early with complete cleanup; it produced no modeling or saved fixture.
The [native GUI checkpoint](evidence/m4-native-gui-checkpoint-20261026.json)
records an accepted point and a line with edit-dialog readback, plus a saved QSF.
The line displayed 10 mm. A later owned session reopened that QSF and verified the same line fields and
10 mm length. A subsequent owned session accepted the constructed line midpoint at (5,0,0)
and reopened its editor with Line Middle Point mode and the correct source.
R15 additionally saved a fresh midpoint QSF and reopened it with the correct title
and both history objects. Its reopened recipe-field inspection was stopped before
input by the conservative modal cutoff. R16 subsequently verified the saved recipe,
edited the source-line endpoint from 10 to 20 mm and observed the dependent
midpoint change from (5,0,0) to (10,0,0). A fresh edited QSF reopened with the
same midpoint coordinates, mode and source. Both sessions finished cleanly with
all four owned processes exited. The inspected point/line context menus did not
expose Copy or Transform; that limited observation does not establish full
copy/transform policy, which remains open.
The initial point/line QSF
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
