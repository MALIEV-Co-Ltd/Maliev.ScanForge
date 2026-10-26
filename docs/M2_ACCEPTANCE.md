# M2 repair and processing acceptance

Tracks [issue #2](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/2), starting 2026-10-25. M1 is owned by another task. M2 remains open; a passing regression suite does not establish complete native equivalence.

Current checkpoint `b250f0f` passes [exact-head hosted CI](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40295641582):
49,318 tests, 64 conditional skips, production build, both CAD smoke checks and
repository formatting. Current rendered Edit Scan GUI/public-MCP reopening
also passes with unchanged geometry history. The [readiness and navigation record](evidence/m2-input-readiness-and-navigation-20261026.json)
separates these results from a fresh native session that could read the owned
window but could not activate it (`GetCursorPos`, access denied). The process
was in the active RDP session with both desktops named Default; the read-only
probe still failed after the owner kept the desktop visible and moved the mouse.
No native modeling/file input was attempted. Authenticated cleanup passed.
The native partial/bridge and broader inventory comparisons remain open, so
this checkpoint is not a milestone closure or merge acceptance.

## Operation and evidence inventory

GUI mesh processing and public `mesh_process` use `src/processing-client.ts` and the shared worker implementation. Agent binding/validation is in `src/automation/operations.ts`; discovery and schemas are in `src/automation/catalog.json`. Existing revision, retry, lock, cancellation, resource and history checks remain required. Read [the agent guide](AGENT_GUIDE.md) for request syntax.

| Capability                                                        | Shared implementation and MCP operation                                                                                 | Retained comparison / tests                                                                                                                                                | Remaining acceptance                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component diagnostics and cleanup                                 | `mesh-processing.ts`, `scan-edit.ts`; `mesh_analyze` and `mesh_process` with `scanEdit/inventory` and component actions | `persistent-topology`, `scan-edit`, `scan-topology-panels` tests; [cache format](TOPOLOGY_CACHE.md)                                                                        | Same-input native panel/count/cleanup comparisons and complete current GUI/MCP lifecycle                                                                                                                                                                                                              |
| Complete, semi and bridge fills; automatic/flat/tangent/curvature | `scan-edit.ts` and hole helpers; `scanEdit/fillHoles`                                                                   | `scan-hole-*`, hole progress tests; [workflow](SCAN_DATA_MVP.md)                                                                                                           | Equivalent native mode/selection outputs, diameter filters, seam/normal and rollback checks across modes                                                                                                                                                                                              |
| Boundary rendering, smoothing and projection                      | Boundary/sketch helpers; `scanEdit`                                                                                     | `scan-boundary-*`, `selection-boundary-highlight`; [workflow](SCAN_DATA_MVP.md)                                                                                            | Same-input native outputs and current public-MCP/rendered lifecycle                                                                                                                                                                                                                                   |
| Selected smoothing                                                | Selected smoothing and parallel worker helpers; `scanEdit/smoothSelected`                                               | Native annular/disconnected-fan fixtures; [smoothing record](SELECTED_SMOOTHING.md)                                                                                        | Fresh current boundary integration and original-input acceptance; synthetic thread transport is not a performance result                                                                                                                                                                              |
| Defeature/repatch                                                 | `scan-defeature*`; `scanEdit/defeature`                                                                                 | Native 96-facet annular spatial-fill comparison; curvature regressions and browser replay; [spatial fill](DEFEATURE_FIX.md), [curvature extension](DEFEATURE_CURVATURE.md) | Owner approved replacement files after confirming the original is gone. Retain exact manufactured selection and available-scan coverage; curvature extension remains distinct from native equivalence                                                                                                 |
| Split                                                             | `scan-edit*` split helpers; `scanEdit/split`                                                                            | General cutter and scan-edit tests                                                                                                                                         | Equivalent native plane/closed/open cutter cases and complete current GUI/MCP lifecycle                                                                                                                                                                                                               |
| Polygon count/percentage/deviation reduction                      | `scan-tools-reduction.ts`, reduction helpers; `scanTools/reducePolygons`                                                | Retained adapter/collapse/comparison fixtures; [reduction record](NATIVE_POLYGON_REDUCTION.md)                                                                             | Large native input, complete mode/dialog state and rendered/public-MCP acceptance                                                                                                                                                                                                                     |
| Iterated noise reduction and deviation                            | Noise kernel, index/query and worker helpers; `scanTools/reduceNoise`                                                   | Whole/selected 1–5 iteration fixtures, boundary-off and real thread tests; [noise record](MESH_PARALLELISM.md)                                                             | Current integrated real-input preview/Apply/Cancel, overlay, history and native dialog comparisons                                                                                                                                                                                                    |
| Scale                                                             | `scan-tools-transforms.ts`; `scanTools/scaleMesh`                                                                       | Native input/coordinate fixtures and preview tests; [scale record](NATIVE_SCALE_INPUT.md)                                                                                  | Complete current GUI/MCP/persistence acceptance                                                                                                                                                                                                                                                       |
| Flip normals                                                      | `scan-tools-transforms.ts`, `scan-flip-topology.ts`; `scanTools/flipNormals`                                            | Native winding evidence and topology regressions; [flip record](NATIVE_FLIP_NORMALS.md)                                                                                    | Current integrated ownership, stored normals and history acceptance                                                                                                                                                                                                                                   |
| Mirror                                                            | `scan-tools-transforms.ts`, frame helpers; `scanTools/mirrorMesh`                                                       | Native coordinate, tangent and exact plane fixtures; [mirror record](NATIVE_MIRROR_COORDINATES.md)                                                                         | Current complete GUI/MCP/persistence acceptance and native picking/dialog behavior                                                                                                                                                                                                                    |
| Average                                                           | `scan-tools-transforms.ts`; `scanTools/averageMesh` with `targetIds` or legacy `targetId`                               | Manufactured tests and [new static callback trace](NATIVE_SCAN_PROCESSING_GAPS.md)                                                                                         | Shared native query/Float32 port and observed three-plane export integrated; difficult native boundary/tie/preparation cases remain open                                                                                                                                                              |
| Cylindrical unroll                                                | `scan-tools-transforms.ts`; `scanTools/unroll`                                                                          | Manufactured tests and [new static command/output trace](NATIVE_SCAN_PROCESSING_GAPS.md)                                                                                   | Observed +Z 0/90-degree and repetition exports matched; arbitrary cylinder tangent/frame binding and auxiliary sketch/frame ownership remain open                                                                                                                                                     |
| Re-polygonize                                                     | `scan-tools-remesh.ts`; `scanTools/repolygonize`, optional `targetIds`                                                  | [static route](NATIVE_REPOLYGONIZE_STATIC_PATH.md), [field investigation](NATIVE_REPOLYGONIZE_FIELD.md), topology tests                                                    | Native GUI export now exists: production field/repair/half-count core matches all 50,895 facets byte-for-byte. Original-input GUI/MCP/native coordinate equality and source digests pass; final whole-candidate acceptance remains pending. Explicit voxel mode retains the old closed-shell behavior |

Listed regression names identify coverage to run; they are not statements that every check has passed on the current candidate. Historical documentation retains its own input, digest and validation dates. In particular, do not apply old fixed input-limit descriptions to the current implementation without checking its schema and admission path.

## Unroll and Average correction checkpoint

The shared operation now integrates native seam removal, swap-last order, positive reference-angle rotation and bounded Unroll instances. Average integrates indexed native surface queries, boundary rejection, ordered Float32 accumulation, largest-facet base selection and new-owner publication. Both GUI commands invoke the same public MCP operation and preserve explicit replacement support. The original inputs remain intact by default.

Manufactured native GUI exports and exact settings are retained as sanitized coordinate fixtures under `tests/fixtures`. Unroll matches the arc/radial coordinates and facet order of the three vertical-cylinder exports and a fourth nonorigin oblique-cylinder export; its tiny imported-frame axial residual uses a declared 1e-12 mm tolerance. Average matches its complete native three-plane and open-rim rejection corner streams exactly, with the observed 10 mm default. See [the investigation record](NATIVE_SCAN_PROCESSING_GAPS.md). Rendered GUI/public-MCP lifecycle checks cover the accepted outputs, undo/redo, retry protection, cancellation, failure rollback, and save/reopen. Final candidate identities and broader regression results are recorded separately from the historical baseline below.

The [correction evidence record](evidence/m2-average-unroll-20261025.json) pins build `scanforge-5f403cdc15ae16f0` and its 2,692 enumerated inputs. Build, 155 focused tests in nine files, and both rendered/public-MCP lifecycle replays passed on that immutable candidate with unchanged inputs and clean owned-process/port cleanup. A broader prior consistent working candidate passed 49,018 tests in 694 canonical files, with 64 fixture-gated skips. The later oblique regression passed in the focused batch. Concurrent fine-alignment changes are recorded separately; the broader checkpoint is not attributed to a different source snapshot. All validation preserved the 4 GiB aggregate cap.

M1 tracking issue [#1](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/1) was confirmed closed on 2026-10-25; its integration/evidence remains owned by that task.

M2 remains open. These fixes do not close unrelated inventory rows, arbitrary imported-cylinder tangent binding, native auxiliary Unroll objects, or difficult Average query/preparation acceptance cases. A review found inherited construction-order keys on newly created mesh owners; the shared publication path now assigns a distinct key, with keyed-source Average/Unroll serialization regressions.

## Historical baseline before these corrections

The final 2026-10-25 focused batch passed **2,317 tests in 79 canonical files**, with zero failures or skips and unchanged enumerated inputs during that run. This supersedes the initial partial batches. Snapshot copies under `.resources` were excluded; an earlier unfiltered thread run is not included. Numerical fixtures, topology/ownership, panels, progress and actual CPU worker threads are covered; this is not complete native acceptance.

Build and focused checks ran serially under the existing aggregate 4 GiB / 25% CPU Windows Job policy. Both roots exited, descendant jobs reached zero active processes, handles closed, and cleanup errors were empty. Final build/test descendant peaks were 2,578,227,200 / 980,000,768 bytes. Exact commands, input manifests, JSON results and receipts are retained in private validation storage. The [sanitized evidence record](evidence/m2-acceptance-20261025.json) identifies the uncommitted candidate, commands, source/build/result digests, canonical test files, screenshots and resource receipts.

The build passed with zero warnings/errors, 2,008 stable enumerated inputs and build ID `scanforge-9b734d59e008f36a`. Browser checks use a retained copy of that complete build, isolated from concurrent rebuilds of `dist`. Set `SCANFORGE_QA_DIST` to that build directory when running `node tests/defeature-curvature-browser.mjs` or `node tests/scan-noise-browser.mjs`; omission retains the existing `dist` default. The harness now selects Settings → AI agents before pairing. Defeature uses a whole-panel camera view, checks camera stability and browser warnings/errors, and waits for rendering before the result screenshot. Browser cleanup precedes bridge shutdown to avoid generating connection errors during teardown; recorded flow diagnostics are copied rather than mutated afterward.

- Defeature GUI/public-MCP replay passed with exact output equality, unchanged retained facets, Undo/Redo, cancelled-job rollback, invalid whole-scan rollback, successful reuse afterward and project save/reopen. The manufactured curved panel's fitted output deviation was about `2.15e-8` mm. This proves that fixture and the application lifecycle, not the missing original screenshot selection or native curvature equivalence.
- Noise GUI/public-MCP replay passed on a manufactured 1,013,888-facet curved panel with deviation comparison enabled. Both accepted coordinate streams hashed to `ccaf47650753554435f09ea2d7421227b9b1dcad7f937d213bba58a207d2935d`. Preview took about 9.46 seconds in the final single run. It is neither an original-scan nor a native performance benchmark.
- Both browser checks exited and released owned processes and listening ports. The million-facet replay's descendant Job peak was 2,382,987,264 bytes, within the unchanged aggregate 4 GiB limit. The existing user server was preserved.

## Closure gates

- Pin and review the complete candidate, including source/build identities and all relevant native fixture digests.
- Complete each inventory row with equivalent input, selection, settings and units. Keep numerical, rendered, transport and lifecycle claims distinct.
- Verify topology reuse/invalidation, selection isolation, normals/seams, deterministic worker output, progress, errors, cancellation/rollback, persistence and undo.
- Verify public MCP and GUI outcomes through the shared application boundary; no GUI-only completion.
- Confirm M1's acceptance independently before closing issue #2 and its milestone.

Continue using [the M2 plan](superpowers/plans/2026-10-25-m2-verification.md). No later milestone is being advanced by this work.

## Native Re-polygonize integration checkpoint

The [native reconstruction evidence](evidence/m2-native-repolygonize-20261025.json) records a fresh three-scan 0.5 mm native GUI export, exact complete production-core equality, a separate 136-facet native control, source immutability and resource cleanup. The native command's enabled half-count optimization explained the remaining extraction/output discrepancy. Native output retains open/nonmanifold diagnostics; this does not establish solid validity. Shared GUI/MCP publication now preserves indexed inputs, creates a new owner and hides originals by default, with explicit replacement and legacy voxel behavior retained. Final build/browser/transport/persistence gates remain pending on the integrated candidate.

The integrated Re-polygonize browser replay passed on production asset build `scanforge-1148d75be3ce1ff0`: all 6,147,452 source facets produced the native 50,895-facet corner stream through both GUI and public MCP, and every canonical source geometry-buffer digest remained unchanged. The 136-facet control additionally passed new-owner publication, input visibility, Undo/Redo (including after save/reopen), retry, cancellation and failure rollback, and indexed output persistence. This exposed and fixed generic history display preservation overriding the command's input-hiding transaction; ordinary display toggles retain their existing behavior. Output computed normals now exist before persistence, avoiding first-reopen cache changes. Owned aggregate peak was 2,276,892,672 bytes in 157.25 seconds, with all helper processes/ports closed and no browser errors. A final full build/review and the unrelated M2 rows remain open.

## Transform lifecycle after main integration

[The transform browser record](evidence/m2-transform-browser-20261025.json) pins production asset build `scanforge-bb403834162abf8c` on the M6-integrated branch. Scale at110%, Mirror about XY and an explicit tilted construction-plane frame, and immediate Flip Normals match every ordered Float32 coordinate byte in their retained native arithmetic fixtures. GUI and direct public MCP outputs, shared public Scale/Mirror preview creation/cancellation/acceptance, Undo/Redo and binary persistence passed with no browser errors. A GUI-only origin Mirror failure was reproduced: an explicit undefined reference ID failed the shared schema. The panel now omits that optional property. This replay does not claim fresh native GUI picking, arbitrary frame classification or scanner-normal metadata acceptance.

## Large Defeature failure-class control

[The new evidence record](evidence/m2-defeature-large-20261026.json) retains a manufactured32768-facet panel with18425selected facets. It reproduced the refinement-budget/spatial-iteration failure before the fix. Reusing the existing bounded edge-legalization queue yields21784output facets and3529new vertices, with the original4096cap, sampling density and source seam unchanged. The production build/typecheck and nine focused curvature/native-helper/budget tests pass. Current GUI and public MCP produce identical output, preserve all retained Float32 coordinates, keep the camera stable and pass Undo/Redo, cancellation/failure rollback and binary save/reopen. The final browser run used build `scanforge-d8a85032a1b0df29`, peaked at1254219776owned aggregate bytes, and closed all helpers/ports. A prior12-second driver polling timeout is retained separately; the diagnostic rerun passed without changing production. This is a retained replacement failure-class control, not the lost original selection or native curvature equivalence.

## Integrated candidate regression checkpoint (2026-10-26)

Candidate `fcb30426552279945c065f73bfbfbb7430f24f4b` includes the latest M6 main integration and the bounded Defeature fix. Production build `scanforge-80b7e925df4a40e5` passed the twelve TypeScript batches and asset build. The complete canonical suite passed 49,051 tests with 0 failures and 64 fixture-gated skips across 699 files. All 2,111 enumerated source inputs remained byte-identical before/after both checks. The CAD smoke suite also passed, including 338 native matrices. The initial whole-repository format check found five formatting discrepancies; the repaired candidate passed the complete format check on the second run.

Fresh Average GUI/public-MCP acceptance passed source preservation, default base selection, multiple references, Undo/Redo, retry protection, cancellation/failure rollback and binary save/reopen. The extended Unroll browser driver also passed an actual GUI command rerun after reopening its saved CAD cylinder reference, in addition to those lifecycle checks. Both replays used the production build above and closed their owned helpers and ports without browser errors.

The same production build then passed the complete original-three-scan Re-polygonize replay again: 6,147,452 input facets produced 50,895 output facets through both GUI and public MCP, matching every native ordered coordinate byte and preserving every canonical source buffer. The small native control also passed ownership, visibility/history, retry, cancellation/failure rollback and indexed save/reopen. Aggregate peak was 2,253,717,504 bytes over 172.03 seconds, with clean helper/port cleanup and no browser errors. [The integrated evidence record](evidence/m2-integrated-checkpoint-20261026.json) pins the current checks. These are application integration checks against retained native fixtures; they do not replace the remaining native frame, query and repair-mode comparisons. No M2 closure or merge is claimed.

## Fresh imported-cylinder and projection-tie controls

[The new native frame control](evidence/m2-unroll-frame-control-20261026.json) rotates the reference cylinder's imported seam tangent from +X to +Y. Native Unroll still produces the same complete 22-facet corner stream. Importing this actual STEP surface exposed an application defect: fitting its display triangles perturbed the exact radius. The shared GUI/MCP `cylinderId` route now reads analytic CAD parameters through the existing kernel query. Ambiguous bodies reject atomically; explicit numeric references remain supported. Build `scanforge-de47b3b68835ea10`, 160 focused tests, and the imported-reference GUI/public-MCP lifecycle pass, including a real GUI rerun after CAD save/reopen. All 2,802 enumerated source, asset and fixture files stayed unchanged across the build. The retained initial browser mismatch and TypeScript failure are distinct from the successful reruns. Native auxiliary Sketch/Roll-frame publication remains open.

Three fresh Average exports compare opposite orders of two reference faces at equal distance from the same base, plus exact-radius exclusion. Both face orders at tolerance10 mm yield Z=-0.5 mm; tolerance1 mm preserves the original base. Production matches every ordered Float32 coordinate in all three exports. The sanitized fixture `average-observed-ties.json` pins inputs, outputs and digests. This closes those finite tie/radius controls, not every preparation class or the remaining M2 inventory.

## Native hole-fill checkpoint, 2026-10-26

[Hole-fill evidence](evidence/m2-native-holes-20261026.json) and the
[native comparison notes](NATIVE_HOLE_FILL.md) bind build
`scanforge-39813075d443eb00` to a complete unchanged 2820-file manifest. The
combined shared implementation passed 82 focused tests, 185 affected repair
tests, nine shared-tree Re-polygonize regressions, twelve TypeScript batches and
Vite. Five frozen-asset GUI/public-MCP replays passed Flat39, Tangent40,
Automatic39, the two-rectangle 9 mm native batch and guarded surface recovery.
Each replay covers source preservation, Undo/Redo, empty-fill history,
invalid-selection rollback, binary reopening and reopened history. All owned
jobs exited with no live descendants or cleanup errors under the unchanged
4 GiB aggregate / 25% CPU policy. The latest M2 dev server remains on port 5174.

The correction preserves imported index identities after generic warmup,
retains native Float32 arithmetic and boundary-tree order, uses an enclosing
sphere for diameter and distinguishes native batch Tangent from selected-hole
algorithms. The former guarded automatic fill is explicitly available as
`surfaceRecovery` in GUI and MCP. Empty or all-skipped fills preserve model
history and avoid a duplicate successor buffer.

Native Curvature, partial/bridge and other inventory gates remain open. These
finite passing controls do not close M2, replace full-candidate verification or
prove arbitrary-rim native equivalence. Earlier failed probes and the affected
suite's obsolete contract assumptions remain recorded with their corrections.

## Entire Curvature annulus integration, 2026-10-26

[The integration evidence](evidence/m2-curvature-integration-20261026.json) records
exact native geometry through the shared async driver, actual pinned CAD protocol,
rendered GUI and public SDK/MCP. The 64-edge annulus has 1,702 facets and 884 used
vertices with zero coordinate or oriented-connectivity difference. Source buffers,
undo/redo, binary persistence, failed-edit rollback and observed nested-worker
cancellation pass. The kernel version, public surface limits and 4 GiB/25 percent
validation limits are unchanged.

The 202-test affected suite and 80-test async worker/native follow-up pass. The
first full run's three synchronous-response test assumptions are retained and
corrected; exact-head full CI is pending. The source-preserving failed native cup
classes, other modes/inputs and remaining operation inventory still require their
own disposition. M2 is not closed by this bounded acceptance record.

Current checkpoint `5ada756b6439eb1705a6842f84884a0e9765308e` passed [GitHub Actions run 40265236808](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40265236808): 49,136 tests passed, 64 conditional skips, all 13 TypeScript batches, Vite/offline build, both CAD smoke checks and whole-repository formatting. The earlier failed full-run receipt remains retained. This verifies that checkpoint; later Unroll changes require their own validation.

## Unroll auxiliary ownership, 2026-10-26

[The auxiliary evidence](evidence/m2-unroll-ownership-20261026.json) records
shared GUI/public-MCP publication of the mesh, visible saved Sketch and hidden
tangent Roll frame with separate retained radius. The source remains unchanged.
Undo/Redo/Seek and binary reopening restore only the operation-owned sketch;
unrelated sketch edits and the active draft survive. GUI and MCP visibility,
retry protection, cancellation and failure rollback pass on production build
`scanforge-662952da8b8d36cc`, with 77 affected regressions and all thirteen
TypeScript batches. The viewed screenshot shows the saved seam line while the
other draft remains active. Owned helpers and ports close without page errors.

The tangent-frame convention derives from recovered static conversion helpers;
there is no runtime capture proving bitwise equality of the native frame payload.
The existing observed mesh coordinates retain their stated 1e-12 mm axial
comparison tolerance. Native image execution was not used. The evidence records
and corrects an earlier validation scheduling overlap using a shared named mutex.
Main advanced during this build, so integration and fresh candidate acceptance
remain required. This bounded Unroll slice does not close M2.

## Main integration, 2026-10-26

[Integration evidence](evidence/m2-main-integration-20261026.json) records the
combined M2 candidate and main `57c77aa`: 236 affected tests across 27 suites,
all thirteen TypeScript batches and a warning-free production build
`scanforge-2ab3fc2854ef56ae`. Fresh rendered GUI/public-MCP Unroll and Curvature
checks pass on that frozen build. Owned sketches, facet normals, history and
binary reopening coexist. Earlier failed test/build receipts remain recorded.
Full hosted CI, the original three-scan replay and remaining native acceptance
gates are still required before M2 can close.

The [fresh original three-scan replay](evidence/m2-main-original-three-20261026.json)
on this integrated build now passes: 6,147,452 input triangles produce 50,895
triangles at 0.5 mm with the retained native ordered-coordinate SHA-256. All
source buffers remain unchanged; GUI/public-MCP equality, visibility rollback,
undo/redo and indexed save/reopen pass. The bounded Job peaked at 2,463,584,256
bytes, exited zero and released every owned helper and port. This compares the
retained aligned poses and native export; it is not a fresh native GUI run.

## Integrated processing and normal transport, 2026-10-26

[The processing record](evidence/m2-main-processing-20261026.json) retains current
GUI/public-MCP Average, scale, mirror, flip, million-facet noise and large
Defeature results, including source preservation, history and reopening. The
manufactured Defeature selection contains 18,425 facets; it is distinct from the
unavailable original selection. The retained 39/40-edge cup controls reject
unusable Curvature collars without changing source coordinates or cached
topology. The separate native 41-edge failure still lacks equivalent coverage.

Full CI on `1327d05` found two transport regressions after 49,307 passing tests:
an obsolete second topology copy discarded normal carriers. One shared copy
now preserves these carriers for Average and reconstruction. The corrected
candidate passes 238 affected checks, 27 transport/Average checks, all thirteen
TypeScript batches and the warning-free build `scanforge-83e557f8be96d4a9`.
Fresh Average browser acceptance passes on that build, including exact reopened
facet normals. Prior failed receipts remain recorded. These bounded results do
not close the remaining native acceptance, review and merge gates.

The [post-correction original-input replay](evidence/m2-main-transport-original-three-20261026.json)
also passes on `scanforge-83e557f8be96d4a9`: the same 6,147,452 input facets and
50,895 output facets retain native ordered-coordinate SHA-256
`e3a54940e0d1f2be3b291bab672dd40cd09914339f24cd17671d01bea57a08a2`.
All source buffers, visibility/history rollback and indexed persistence checks
pass, with no page errors or surviving owned helpers. This verifies the
normal-preserving transport correction rather than reusing the earlier build.

## Replacement Defeature inputs approved, 2026-10-26

The owner confirmed that the original file no longer exists and requested other
files for testing. Exact reproduction of that missing selection is therefore no
longer a closure requirement. Use the retained manufactured 32,768-facet panel
with its exact 18,425-facet selection, plus recorded available-scan inputs for
additional real-input coverage. Preserve input/selection identities and results;
do not describe replacement inputs as the original report. Other native,
lifecycle, review and integration gates remain required.

The [retained real-scan replacement record](evidence/m2-defeature-replacement-20261026.json)
pins the complete 273,139-facet `scan-1.stl` by digest and its exact 64-facet
selection. It exposed an actual failure: tolerance-welded publication moved
unselected source corners. Shared Defeature publication now preserves these
corners exactly, and omitted GUI/MCP topology tolerances agree at 0.001 mm.
The unchanged case passes GUI/public-MCP equality, retained coordinates,
history, cancellation/failure rollback and save/reopen on build
`scanforge-6f95718105a661d8`, with 3,182,702,592 bytes peak owned memory and
complete cleanup. Follow-up review independently reproduced stale successor
adjacency after preserving a removed weld representative. Conditional
invalidation fixes that regression while keeping exact successor reuse; all
293 affected tests pass. Final build `scanforge-8602b889358c497b` passes all
thirteen TypeScript batches without warnings. The unchanged real-scan replay
also passes with the cache correction, including equal diagnostics after
reopening, complete helper cleanup and the unchanged 4 GiB aggregate limit.
The 64-facet real-input case complements the separate manufactured
18,425-facet failure-class control; neither is the missing original selection.

## Whole-branch review corrections, 2026-10-26

[The review correction record](evidence/m2-review-corrections-20261026.json)
retains both observed failures and their fixes: authored indexed connectivity
survives intervening diagnostics/tolerance changes, and imported exact capped
cylinders are available through the GUI chooser and canvas picker. Analytic
validation remains shared with MCP. All 240 affected checks, thirteen TypeScript
batches and the warning-free build `scanforge-86498b4101777eb5` pass. The actual
capped-body GUI/public-MCP replay agrees exactly and preserves source geometry.
The reviewer found no further blocking code defect in the prepared corrections;
remaining native acceptance and final exact-head CI/merge gates are still open.
