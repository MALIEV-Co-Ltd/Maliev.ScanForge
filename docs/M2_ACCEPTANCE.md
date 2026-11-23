# M2 repair and processing acceptance

Tracks [issue #2](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/2), starting 2026-10-25. M1 is owned by another task. M2 remains open; a passing regression suite does not establish complete native equivalence.

## Scope boundary

M2 covers the scan-repair and processing commands listed in issue #2, including Average, Mirror and cylindrical Unroll. Boundary-to-sketch creation and its own publication, history and persistence are M2 processing outcomes; general spatial-sketch editing belongs to [M4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/4) and is not an M2 closure requirement. Re-polygonize is listed in M2; M3's already reviewed alignment and combination acceptance is a separate milestone, not a new M2 gate. Shared CAD restore, MCP, project history and resource protections are verified only as needed by M2 operations; completing all M5, M7 or M8 functionality is not required to close M2. M1 is the sole milestone dependency listed in issue #2 and has been closed.

## Native Split readiness, 2026-10-29

After M5 confirmed the native lane was released, a fresh QuickSurface launch was denied before a window opened. [The readiness record](evidence/m2-split-native-readiness-20261029.json) captures the failure and confirms no QuickSurface process remained. No native Split input or result was observed; the native comparison remains open.

## Native Split point-search candidate, 2026-10-29

A [digest-bound static check](evidence/m2-split-native-point-radius-static-20261029.json) independently verifies the candidate call-site constants and Float32 arithmetic used before an internal point-search helper. This narrows a possible boundary control but does not establish global Split tolerance, runtime reachability, native output, or application/native parity. No Split behavior was changed from this evidence alone.

The [candidate insertion predicate analysis](evidence/m2-split-native-incircle-symbolic-20261029.json) derives an incircle determinant from the native helper's arithmetic data flow; a symbolic expansion confirms the algebra under the inferred numeric-record operations. Its caller treats a zero return as non-positive. This is static evidence, not runtime proof of the numeric representation, native tie-breaking, tree order or Split facet equivalence.

An [offline incircle prototype](evidence/m2-split-incircle-exact-prototype-20261029.json) found a binary64 control where floating arithmetic returns zero but the exact determinant is positive. A BigInt sign prototype matched 603 independently generated rational controls and retained the six previously observed native-face matches when given captured point order. These are not independent native tie-break tests; point ordering, constraints, performance, cancellation, GUI and MCP acceptance remain open.

A [sequential cavity prototype](evidence/m2-split-sequential-cavity-prototype-20261029.json) using the captured native point order matches all six recorded native face triangulations when zero incircle results are included. A strict-positive control matches two of six. This is evidence for the zero-branch hypothesis, not an implementation or independent native validation: tree ordering, constraints, degeneracy, exact orientation, resource bounds and application lifecycle remain open.

Sorting those captured points by the current face triangulator's barycentric ordering makes the same prototype match five of six native faces; the first convex face retains a different diagonal. This [ordering control](evidence/m2-split-sequential-app-order-20261029.json) approximates the application ordering on native captured points; it does not execute the full collector or prove general native parity.

Read-only [native tree snapshots](evidence/m2-split-live-cutter-trees-20261029.json) map the convex and concave cutter leaf entries to their pinned STL facets. Traversing the captured concave tree in the statically inferred child order reproduces both previously observed face-record orders. A [membership comparison](evidence/m2-split-native-tree-membership-20261029.json) matches all 16 captured leaf lists using triangle-box intersection; facet-AABB overlap alone admits extra facets in all eight concave leaves. These controls do not establish general subdivision, endpoint orientation, point pooling or worker ordering, and do not change application behavior.

A [construction hypothesis](evidence/m2-split-tree-construction-hypothesis-20261029.json) reproduces the two captured root cubes, all child bounds and their ordered leaf entries from the pinned inputs. The half-width, padding and child policy were inferred and evaluated on the same fixtures; deeper trees, other scales, degeneracy and native endpoint ordering remain unverified.

An [independent cyclic-source tree control](evidence/m2-split-tree-construction-independent-20261029.json) applies that unchanged hypothesis to a separate two-facet planar mesh with a larger bounding box. Its root, all eight child bounds and ordered facet lists match the read-only native snapshot. The tree has only one subdivision; deeper trees, other geometry and endpoint ordering remain unverified.

## Large project in-place reopen candidate (2026-10-29)

An uncommitted numeric-array reuse candidate completed one original PLY-3 GUI Split/Extract and public MCP project save/in-place reopen with matching source, cutter and extracted geometry digests. The guarded aggregate peak was 4,180,025,344 bytes under the 4 GiB limit. A separate mixed CAD/scan project passed GUI and public MCP reopen and post-reopen Undo/Redo at a 2,331,430,912-byte peak. These are single candidate runs; broader resource repeatability, the ordinary-array immutable ownership audit, and native Split comparison remain open. A subsequent transport handoff regression demonstrated that a candidate changed between comparison and adoption could restore incorrect values. The local candidate now rechecks synchronously at adoption. A repeat reopened below the 4 GiB limit but failed on a missing offline script because the test build lacked its generated manifest; it is not an acceptance pass. Independent review also identified a transport identity collision for distinct equal arrays; a regression and local exclusion fix have been added. The corrected complete build then passed the original-scan replay with matching geometry, no page or console errors and a 4,175,196,160-byte peak. [The evidence](evidence/m2-numeric-reuse-20261029.json) retains both the failed and passing runs. A subsequent original-scan in-place reopen also passed public MCP Undo/Redo with matching source, cutter and extracted geometry at 4,178,944,000 bytes; GUI reopening and GUI history after reopening were not exercised. [History evidence](evidence/m2-original-post-reopen-history-20261029.json). Three GUI file-open attempts after MCP artifact transfer exceeded 4 GiB before open completion; aggregate sampling does not isolate the responsible allocation. A cleaner GUI Save/Open control reached matching geometry below the cap but stopped on a test locator; its corrected repeat exceeded 4 GiB after reopen, before post-reopen Undo completed. [Failed transfer runs](evidence/m2-original-gui-reopen-memory-20261029.json) and [GUI-only controls](evidence/m2-original-gui-save-reopen-20261029.json). The later viewport wrapper correction retains an unchanged source display and passed GUI Save/Open plus GUI Undo/Redo on the original PLY-3 at a 4,161,060,864-byte peak, with matching geometry; its full candidate suite and typecheck also passed. [Viewport evidence](evidence/m2-viewport-wrapper-history-20261029.json). This is one workload, not native Split equivalence. The reviewed restore candidate is committed separately; final M2 acceptance remains open. The candidate shares the existing immutable geometry convention and has not yet been accepted as a production change.

## Large indexed component extraction (2026-10-28, in progress)

The later candidate `scanforge-f21a1fe3d84e8d59` supersedes the failed combined-run status below: the original PLY-3 GUI Split, GUI Extract, Undo and public MCP Extract completed with matching geometry digests without forced collection. Its guarded aggregate peak was 4,171,862,016 bytes, under the 4 GiB limit, with clean process cleanup. A separate original-scan GUI Extract Undo/Redo replay preserved the source, cutter and extracted geometry, peaking at 3,960,418,304 bytes. A further large Extract project export completed, but its import failed with an array buffer allocation error and a 4,425,740,288-byte guarded peak; An earlier fresh-project import matched the saved geometry but exceeded the limit. Candidate `scanforge-b77f6a53f3277b31` subsequently passed fresh-project reopen with matching extracted, source and cutter digests at 3,997,863,936 bytes. Candidate `scanforge-f3a3583977dfc488` also completed in-place replacement with matching geometry, but its 4,316,708,864-byte peak exceeded the cap. A later candidate `scanforge-d5ce48c41b1d48bb` again matched all three geometry digests while peaking at 4,315,508,736 bytes; a repeat imported the project but timed out during the extracted geometry digest at a 4,353,433,600-byte peak. The complete save/reopen resource gate and native equivalence remain open. See [allocation evidence](evidence/m2-extract-allocation-diagnostic-20261028.json).

Large precise indexed Extract can use a private indexed source only after cancellable admission verifies every expanded corner exactly, including signed zero. Mismatched sources retain the existing expanded-input path. GUI and public MCP share the same operation and preserve the source and cutter. In a public MCP replay after GUI Split of the original PLY-3, candidate build `scanforge-e5da98aa6a7bbdc1` extracted 1,779,171 facets, retained indexed output, preserved source and cutter, and passed Undo/Redo and geometry digests. Peak guarded job memory was 3,918,405,632 bytes, with clean owned-process cleanup. This is application behavior evidence, not native comparison.

At the earlier `scanforge-4909f8d7765048df` checkpoint, the combined GUI Extract, Undo and MCP comparison was still open: that replay committed GUI Extract and Undo but exceeded the 4 GiB guard during the post-Undo source digest, and its agent bridge timed out. Earlier replay results recorded a WebGL error. The standalone public-MCP pass does not establish GUI lifecycle acceptance or close M2. The currently missing native Split comparison and other tracker gates remain open.

A later GUI-only replay completed Extract, Undo, Redo and output digests without page or console errors, but its guarded peak was 4,358,275,072 bytes, above the 4 GiB limit; it is not a resource pass. [Renderer memory measurements](evidence/m2-extract-renderer-memory-20261028.json) identify the renderer as the largest process and retain separate process and CDP samples. They do not isolate a single allocation or establish the combined lifecycle.

Candidate `scanforge-c43fdaa90b718243` allocates Extract's indexed vertex output to the actual unique-vertex count, materializes face lists only for selected components, and avoids the temporary expanded vertex conversion when restoring computed facet normals. Focused coordinate, ordering, normal-bit and worker transport tests pass. The combined original-scan replay completed GUI Extract, Undo, its source digest and MCP Extract, but failed while digesting the MCP output; its guarded peak was 4,399,484,928 bytes, over the 4 GiB limit. It is not a passing combined comparison.

The 2026-10-27 partial Tangent curved-annulus control matches the installed native export through the shared operation, rendered GUI and public MCP. Source corners, history and binary reopening pass; the complementary arc has a separate result. [Evidence](evidence/m2-partial-tangent-20261027.json) is limited to this one control; other partial and bridge algorithms and the remaining M2 gates stay open.

Latest confirmed green full hosted application checkpoint `69a1380` passes [run 40379322369](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40379322369): 49,926 tests, 64 conditional skips, build, both CAD smoke checks and formatting. Subsequent test/evidence-only commits require their own exact-head CI.

Flat Bridge checkpoint `242ea74` passes [exact-head hosted CI](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40318500393):
49,325 tests, 64 conditional skips, production build, both CAD smoke checks and
repository formatting. Current rendered Edit Scan GUI/public-MCP reopening
also passes with unchanged geometry history. The [readiness and navigation record](evidence/m2-input-readiness-and-navigation-20261026.json)
separates these results from a fresh native session that could read the owned
window but could not activate it (`GetCursorPos`, access denied). The process
was in the active RDP session with both desktops named Default; the read-only
probe still failed after the owner kept the desktop visible and moved the mouse.
No native modeling/file input was attempted in that R7 session. Authenticated
cleanup passed. A subsequent [R8 readiness record](evidence/m2-native-partial-bridge-readiness-20261026.json)
records recovered input and an observed Semi/Flat operation: the original
8-facet square ring became 9 facets after two opposite boundary-corner clicks.
Its export was not saved before the scheduled session stop, so this observation
does not establish geometry equality. Earlier access-denied receipts remain
retained. The later [native Semi/Flat and Flat Bridge record](evidence/m2-native-flat-bridge-20261026.json)
binds actual exports: Semi/Flat retains the eight original triangles and matches
the native ninth triangle; two Flat bridges require 20 and 17 patch triangles,
where the old application produced two. The shared correction reproduces both
complete oriented Float32 outputs using attachment-length-based rail sampling.
Review regressions additionally preserve retained diagonal constraints and bound
quadratic clipping work before allocation. The corrected candidate passes 308
tests in 32 files, all 13 TypeScript batches and build `scanforge-b5420f04ca0b12b2`.
All five rendered Bridge scenarios pass; the native Flat control matches all
84 oriented facets through GUI/public MCP, undo/redo and binary save/reopen.
That checkpoint passed exact-head CI and is served by the preserved local
preview. Broader inventory gates remain open; this is not milestone closure.

The [current bridge browser record](evidence/m2-bridge-browser-readiness-20261026.json)
passes flat, tangent, independent-boundary and fragmented-open cases through
rendered GUI/public MCP: hover/preview, exact output equality, cancellation,
undo/redo and camera preservation, with no page errors or surviving helpers.
The existing driver now uses current Settings navigation and public session /
viewport readiness after history restoration. No application behavior or
geometry assertion was changed to obtain these passes. Native partial/bridge
output comparison remains separate and open.

## Cached Flip resource control (2026-10-27)

On the indexed second original scan, cached Flip now reverses edge incidences
without materializing 3,846,354 edge records. Matched isolated worker probes
preserved the source and produced the same output hash; the owned-job peak fell
from 2,473,766,912 to 1,434,013,696 bytes. An opt-in test separately packed and
hydrated the flipped cache under the 4 GiB limit. A rendered native-fixture
GUI/public-MCP replay still matches, including history and project reopening.
The [resource record](evidence/m2-flip-cache-memory-20261027.json) distinguishes
these tests and the earlier test-assertion allocation artifact from full browser
large-scan or native behavior. A separate 2,697,877-facet PLY replay observed indexed validation and
cancelled through both GUI and public MCP with source buffers and history
unchanged; the public-MCP cancel arrived before worker dispatch. A subsequent
Flip and Undo passed. Cancellation delivery remains scheduling-dependent.
Native original-scan Flip remains open.

## Boundary smoothing minimum-strength control (2026-10-27)

The native reference 8.0.123 imported the 64-facet curved annulus in millimetres. With the Boundaries strength control visibly set to 0, one Smooth all operation was exported as STL. The sanitized [coordinate fixture](../tests/fixtures/boundary-smooth-all-strength-zero-native.json) records the original and export SHA-256 identities, settings and all 576 Float32 coordinates. The shared scan-edit operation matches every coordinate outside its documented mathematical-zero roundoff neighborhood with the native importer topology. A fresh original annulus at the visibly confirmed midpoint strength 50 also matched all coordinates under the same criterion; its [sanitized fixture](../tests/fixtures/boundary-smooth-all-strength-half-native.json) retains the export identity. These finite controls do not establish parity for arbitrary boundaries or every strength setting. The same shared operation is used by GUI and `mesh_process`; this comparison is a worker-level test, not a new public-MCP or rendered equivalence run.

The preceding candidate `434c86594c092e3004f89fac447361a8b6815a1e` passed 49,955 tests with 64 conditional skips in the full local suite, under the 4 GiB job limit with clean owned-process cleanup. The new native fixture and focused comparison are subsequent test/evidence changes; hosted checks and remaining native gates are separate.

## Anchored boundary prototype (2026-10-27)

On the original curved annulus, the native application placed one visible anchor on the inner boundary and applied Smooth all at observed strength 50. The [sanitized output](../tests/fixtures/boundary-smooth-anchor-inner-native.json) retains the source/export hashes and coordinate stream. The sole inner source vertex retained exactly matches the visible anchor location; this position is inferred from the exported coordinates, not an independently decoded native anchor identity. The initial shared implementation failed that oracle. Excluding the identified anchor from the boundary vertex passes reproduces the finite native output outside the existing mathematical-zero tolerance. The [comparison record](evidence/m2-boundary-anchor-20261027.json) also verifies identical GUI/public-MCP Float32 geometry and undo/redo on this case. Other native multiple-anchor spacing, open and folded boundaries, viewport picking, anchored binary reopening and active-kernel cancellation remain separate acceptance gates.

A second [native anchor control](../tests/fixtures/boundary-smooth-anchor-head-native.json) places the visible marker at the inferred first point of the inner native walk. On the same original annulus and strength 50, the exported coordinate nearest that point moved approximately 0.113 mm. The shared operation matches the entire native Float32 output outside the documented near-zero neighborhood. The clicked point identity is inferred from the screen marker and output geometry; native internal identity was not independently decoded. This control does not establish arbitrary anchor locations or multiple-anchor behavior.

On the same original annulus, a [two-anchor native control](evidence/m2-boundary-two-anchors-20261027.json) preserved both opposite inner points. The shared operation matches all 576 exported coordinates outside the existing near-zero tolerance, and the rendered GUI and public MCP results have identical Float32 digests. Pairs are currently limited to two points on the same closed boundary with at least two points between them on each side. This finite case does not establish other anchor spacing, meshes or M2 closure.

## Operation and evidence inventory

GUI mesh processing and public `mesh_process` use `src/processing-client.ts` and the shared worker implementation. Agent binding/validation is in `src/automation/operations.ts`; discovery and schemas are in `src/automation/catalog.json`. Existing revision, retry, lock, cancellation, resource and history checks remain required. Read [the agent guide](AGENT_GUIDE.md) for request syntax.

| Capability                                                        | Shared implementation and MCP operation                                                                                 | Retained comparison / tests                                                                                                                                                | Remaining acceptance                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Component diagnostics and cleanup                                 | `mesh-processing.ts`, `scan-edit.ts`; `mesh_analyze` and `mesh_process` with `scanEdit/inventory` and component actions | `persistent-topology`, `scan-edit`, `scan-topology-panels` tests; [cache format](TOPOLOGY_CACHE.md)                                                                        | Same-input native panel/count/cleanup comparisons; manufactured current GUI/MCP lifecycle is recorded below                                                                                                                                                                                                                                            |
| Complete, semi and bridge fills; automatic/flat/tangent/curvature | `scan-edit.ts` and hole helpers; `scanEdit/fillHoles`                                                                   | `scan-hole-*`, hole progress tests; [workflow](SCAN_DATA_MVP.md)                                                                                                           | Entire Flat/Tangent/Automatic, diameter/batch, successful Entire Curvature annulus, Semi/Flat and two Flat bridge finite controls accepted. Semi/Flat rendered GUI/MCP/history/reopen now passes. Other partial/bridge algorithms remain open; recovered 41-edge failed-cup rejection is recorded below.                                               |
| Boundary rendering, smoothing and projection                      | Boundary/sketch helpers; `scanEdit`                                                                                     | `scan-boundary-*`, `selection-boundary-highlight`; [workflow](SCAN_DATA_MVP.md)                                                                                            | Same-input native outputs; current selected/all smoothing and saved-sketch projection GUI/MCP lifecycles pass below.                                                                                                                                                                                                                                   |
| Selected smoothing                                                | Selected smoothing and parallel worker helpers; `scanEdit/smoothSelected`                                               | Native annular/disconnected-fan fixtures; [smoothing record](SELECTED_SMOOTHING.md)                                                                                        | Current GUI/MCP native six-pass fan and explicit two-pass annulus, cancellation/history/reopen pass. Current 273,139-facet /64-selection GUI/MCP source isolation, cancellation/history/reopen pass. Production-scan native numerical and nonmanifold/winding acceptance remain open; threaded correctness is not performance evidence.                |
| Defeature/repatch                                                 | `scan-defeature*`; `scanEdit/defeature`                                                                                 | Native 96-facet annular spatial-fill comparison; curvature regressions and browser replay; [spatial fill](DEFEATURE_FIX.md), [curvature extension](DEFEATURE_CURVATURE.md) | Owner-approved manufactured 18,425-facet and real 273,139-facet /64-selection replacements pass GUI/MCP, retained coordinates, rollback/history/reopen and cache invalidation. Final candidate acceptance remains; curvature is an application extension.                                                                                              |
| Split                                                             | `scan-edit*` split helpers; `scanEdit/split`                                                                            | General cutter and scan-edit tests                                                                                                                                         | Equivalent native plane/closed/open cutter cases; five current manufactured cutter GUI/MCP lifecycles and component publication state are recorded below                                                                                                                                                                                               |
| Polygon count/percentage/deviation reduction                      | `scan-tools-reduction.ts`, reduction helpers; `scanTools/reducePolygons`                                                | Retained adapter/collapse/comparison fixtures; [reduction record](NATIVE_POLYGON_REDUCTION.md)                                                                             | Global count/percentage rendered GUI/public-MCP lifecycle passes 40,960 /273,139 /1,152,000-facet inputs; installed-native large-input and complete native deviation-dialog equivalence remain open                                                                                                                                                    |
| Iterated noise reduction and deviation                            | Noise kernel, index/query and worker helpers; `scanTools/reduceNoise`                                                   | Whole/selected 1-5 iteration fixtures, boundary-off and real thread tests; [noise record](MESH_PARALLELISM.md)                                                             | Current three-iteration original-scan whole boundary-on/off and64-selection GUI/direct-MCP/preview geometry, diagnostics, cancellation/history/reopen pass; fresh native production-scan/dialog comparisons remain open                                                                                                                                |
| Scale                                                             | `scan-tools-transforms.ts`; `scanTools/scaleMesh`                                                                       | Native input/coordinate fixtures and preview tests; [scale record](NATIVE_SCALE_INPUT.md)                                                                                  | Retained native arithmetic controls and current GUI/MCP preview/accept/cancel/history/binary persistence pass. Final candidate refresh and whole-milestone gates remain.                                                                                                                                                                               |
| Flip normals                                                      | `scan-tools-transforms.ts`, `scan-flip-topology.ts`; `scanTools/flipNormals`                                            | Native winding evidence and topology regressions; [flip record](NATIVE_FLIP_NORMALS.md)                                                                                    | Current winding-coordinate GUI/MCP/history/persistence pass. Native final normal refresh and scanner-normal metadata acceptance remain separate.                                                                                                                                                                                                       |
| Mirror                                                            | `scan-tools-transforms.ts`, frame helpers; `scanTools/mirrorMesh`                                                       | Native coordinate, tangent and exact plane fixtures; [mirror record](NATIVE_MIRROR_COORDINATES.md)                                                                         | Origin and explicit tilted-frame GUI/MCP preview/history/persistence pass. Native picking/imported-plane producer and arbitrary classification scope remain open.                                                                                                                                                                                      |
| Average                                                           | `scan-tools-transforms.ts`; `scanTools/averageMesh` with `targetIds` or legacy `targetId`                               | Manufactured tests and [new static callback trace](NATIVE_SCAN_PROCESSING_GAPS.md)                                                                                         | Three-plane, open-rim rejection, face-order ties and exact-radius exclusion finite native controls accepted; current GUI/MCP/history/rollback/reopen and normal transport pass. Broader preparation classes remain unverified.                                                                                                                         |
| Cylindrical unroll                                                | `scan-tools-transforms.ts`; `scanTools/unroll`                                                                          | Manufactured tests and [new static command/output trace](NATIVE_SCAN_PROCESSING_GAPS.md)                                                                                   | Saved Sketch/hidden Roll frame atomic publication, history/Seek, unrelated draft and reopening pass including main integration. One retained +Z, zero-offset, one-turn auxiliary frame/sketch control now matches GUI-triggered and direct public-MCP structured outputs within stated native-record tolerances; arbitrary-frame controls remain open. |
| Re-polygonize                                                     | `scan-tools-remesh.ts`; `scanTools/repolygonize`, optional `targetIds`                                                  | [static route](NATIVE_REPOLYGONIZE_STATIC_PATH.md), [field investigation](NATIVE_REPOLYGONIZE_FIELD.md), topology tests                                                    | Original-three-scan native ordered-coordinate equality and integrated transport/persistence accepted in the post-correction record. Final candidate refresh and remaining milestone gates apply; explicit voxel mode keeps its separate behavior.                                                                                                      |

Listed regression names identify coverage to run; they are not statements that every check has passed on the current candidate. Historical documentation retains its own input, digest and validation dates. In particular, do not apply old fixed input-limit descriptions to the current implementation without checking its schema and admission path.

The [one-turn auxiliary record](evidence/m2-unroll-native-auxiliary-gui-mcp-20261027.json)
compares the GUI-triggered and direct public MCP frame and sketch with the
retained native project matrix and IGES line. Their structured frame and sketch
agree exactly with each other; the native matrix comparison uses an inferred
record layout and the decimal IGES line requires a 5e-10 mm tolerance. Native
visibility was separately observed in the retained UI. This is one finite
control, not a general native frame-schema or rendered auxiliary comparison.

The retained oblique-cylinder native export now also has a current exact-CAD GUI/public-MCP comparison: all 198 output coordinates match within 1.2e-16 mm, and GUI/MCP geometry, frame, sketch, source preservation and Undo/Redo agree. This is one equal-component positive-axis control; negative-axis and Y/Z-seed native exports remain open. [Evidence](evidence/m2-unroll-tilted-cad-gui-mcp-20261027.json).

Indexed Flip Normals now retains vertex identities and reverses indexed triangles while refreshing computed normal state. Its output vertex-normal bits match 41 retained native facet-plus-vertex kernel captures when their triangle winding is reversed before Flip. On both a small indexed PLY and the 274,154-facet original PLY, GUI and public MCP agree on all reported output geometry buffers; Undo restores the original scanner-normal and geometry digests. The small PLY control also passes Redo; separate indexed unit controls pass binary reopening. On the original PLY, public MCP cancelled after the vertex-normal refresh stage was reported, preserving all reported geometry and scanner-normal digests, revision and history; a subsequent Flip matched the prior successful result. The exact worker instruction at cancellation was not observed. A retained pre-Flip native snapshot matches the original input buffers: the output facet bits match sign inversion, and vertex normals match numerically with six zero-sign differences. This is an inference from pre-Flip data, not a captured native post-Flip output. Native original-scan post-Flip comparison and very-large-input admission responsiveness remain open. [Evidence](evidence/m2-flip-indexed-20261027.json).

Indexed Flip admission now yields between bounded checks for both GUI and MCP. A small indexed PLY passes GUI/public-MCP geometry equality, Undo and Redo; 50,054 tests pass with 64 skipped. The prior three-million-facet synchronous admission took 129â€“140 ms in an isolated Chrome control; the staged run allowed observed frames, though frame gaps include other rendering activity and do not establish a maximum task duration. The later large-input GUI/public-MCP cancellation replay is described above; subsequent synchronous copies and publication, and native original-scan post-Flip behavior remain open. [Evidence](evidence/m2-flip-staged-admission-20261027.json).

On the original 274,154-facet PLY, the staged candidate also produces matching GUI/public-MCP output buffer digests and Undo restores all input digests, including scanner normals. An immediately cancelled public MCP job reported progress zero and left input digests unchanged; its actual admission stage was not observed. A subsequent MCP Flip succeeded and matched the GUI. This is application parity, not a native post-Flip capture. [Evidence](evidence/m2-flip-staged-admission-20261027.json).

## Unroll and Average correction checkpoint

The shared operation now integrates native seam removal, swap-last order, positive reference-angle rotation and bounded Unroll instances. Average integrates indexed native surface queries, boundary rejection, ordered Float32 accumulation, largest-facet base selection and new-owner publication. Both GUI commands invoke the same public MCP operation and preserve explicit replacement support. The original inputs remain intact by default.

Manufactured native GUI exports and exact settings are retained as sanitized coordinate fixtures under `tests/fixtures`. Unroll matches the arc/radial coordinates and facet order of the three vertical-cylinder exports and a fourth nonorigin oblique-cylinder export; its tiny imported-frame axial residual uses a declared 1e-12 mm tolerance. Average matches its complete native three-plane and open-rim rejection corner streams exactly, with the observed 10 mm default. See [the investigation record](NATIVE_SCAN_PROCESSING_GAPS.md). Rendered GUI/public-MCP lifecycle checks cover the accepted outputs, undo/redo, retry protection, cancellation, failure rollback, and save/reopen. Final candidate identities and broader regression results are recorded separately from the historical baseline below.

The [correction evidence record](evidence/m2-average-unroll-20261025.json) pins build `scanforge-5f403cdc15ae16f0` and its 2,692 enumerated inputs. Build, 155 focused tests in nine files, and both rendered/public-MCP lifecycle replays passed on that immutable candidate with unchanged inputs and clean owned-process/port cleanup. A broader prior consistent working candidate passed 49,018 tests in 694 canonical files, with 64 fixture-gated skips. The later oblique regression passed in the focused batch. Concurrent fine-alignment changes are recorded separately; the broader checkpoint is not attributed to a different source snapshot. All validation preserved the 4 GiB aggregate cap.

M1 tracking issue [#1](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/1) was confirmed closed on 2026-10-25; its integration/evidence remains owned by that task.

M2 remains open. These fixes do not close unrelated inventory rows, arbitrary imported-cylinder tangent binding, native auxiliary Unroll objects, or difficult Average query/preparation acceptance cases. A review found inherited construction-order keys on newly created mesh owners; the shared publication path now assigns a distinct key, with keyed-source Average/Unroll serialization regressions.

## Historical baseline before these corrections

The final 2026-10-25 focused batch passed **2,317 tests in 79 canonical files**, with zero failures or skips and unchanged enumerated inputs during that run. This supersedes the initial partial batches. Snapshot copies under `.resources` were excluded; an earlier unfiltered thread run is not included. Numerical fixtures, topology/ownership, panels, progress and actual CPU worker threads are covered; this is not complete native acceptance.

Build and focused checks ran serially under the existing aggregate 4 GiB / 25% CPU Windows Job policy. Both roots exited, descendant jobs reached zero active processes, handles closed, and cleanup errors were empty. Final build/test descendant peaks were 2,578,227,200 / 980,000,768 bytes. Exact commands, input manifests, JSON results and receipts are retained in private validation storage. The [sanitized evidence record](evidence/m2-acceptance-20261025.json) identifies the uncommitted candidate, commands, source/build/result digests, canonical test files, screenshots and resource receipts.

The build passed with zero warnings/errors, 2,008 stable enumerated inputs and build ID `scanforge-9b734d59e008f36a`. Browser checks use a retained copy of that complete build, isolated from concurrent rebuilds of `dist`. Set `SCANFORGE_QA_DIST` to that build directory when running `node tests/defeature-curvature-browser.mjs` or `node tests/scan-noise-browser.mjs`; omission retains the existing `dist` default. The harness now selects Settings â†’ AI agents before pairing. Defeature uses a whole-panel camera view, checks camera stability and browser warnings/errors, and waits for rendering before the result screenshot. Browser cleanup precedes bridge shutdown to avoid generating connection errors during teardown; recorded flow diagnostics are copied rather than mutated afterward.

- Defeature GUI/public-MCP replay passed with exact output equality, unchanged retained facets, Undo/Redo, cancelled-job rollback, invalid whole-scan rollback, successful reuse afterward and project save/reopen. The manufactured curved panel's fitted output deviation was about `2.15e-8` mm. This proves that fixture and the application lifecycle, not the missing original screenshot selection or native curvature equivalence.
- Noise GUI/public-MCP replay passed on a manufactured 1,013,888-facet curved panel with deviation comparison enabled. Both accepted coordinate streams hashed to `ccaf47650753554435f09ea2d7421227b9b1dcad7f937d213bba58a207d2935d`. Preview took about 9.46 seconds in the final single run. It is neither an original-scan nor a native performance benchmark.
- Both browser checks exited and released owned processes and listening ports. The million-facet replay's descendant Job peak was 2,382,987,264 bytes, within the unchanged aggregate 4 GiB limit. The existing user server was preserved.

## Closure gates

- The [current dirty-candidate full Vitest run](evidence/m2-current-full-suite-20261029.json) reports 50,532 passed and 76 skipped, with identical pre/post source and test inventories. Four of the reported passes are `it.fails` assertions: three native Split facet comparisons and one Float32 seam case still fail as expected. The guarded run peaked at 1,365,278,720 bytes and cleaned up; it is not native, rendered GUI/MCP or milestone acceptance.
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

## Resident reduction progress cleanup, 2026-10-26

[The reduction lifecycle record](evidence/m2-reduction-lifecycle-20261026.json)
retains the actual browser failure: completed preview work left fraction 1 in
GUI/public-MCP inspection, rendering a stale preparation bar. Shared state cleanup
now clears both stage and fraction. The same manufactured 115,200-facet input
passes GUI preview/accept and public MCP with exact output geometry equality;
the rendered completion bar is absent. All 28 focused tests, thirteen TypeScript
batches and warning-free build `scanforge-78d899a80c57e2b3` pass. This is current
percentage-mode lifecycle evidence, not native global reduction equivalence.
Native R14 input activation again failed with access denied; no native modeling
or file input was attempted and owned cleanup completed. Remaining native,
whole-inventory, exact-head CI, review and integration gates stay open.

## Selected smoothing and current inventory audit, 2026-10-26

[The current smoothing record](evidence/m2-selected-smoothing-lifecycle-20261026.json)
retains a real rendered failure and its one-line selection-outline fix. A closed
selected surface has no exposed outline; the overlay now supplies the required
Object3D argument even when that optional list is empty. The focused regression
fails before and passes after the correction. All 13 affected checks, thirteen
TypeScript batches and warning-free build `scanforge-371efeb2c74e6b42` pass.
The GUI six-pass default matches the retained three-click native fan exactly;
public MCP agrees, including cancellation rollback, history and binary reopening.
A separate explicit two-pass MCP annulus matches native within 0.000001 mm and
preserves 198 unmarked corner slots; undo/redo and fitted rendering also pass.
The existing Defeature replay passes with the extended browser driver.

The inventory above supersedes older pending statements for accepted Unroll
auxiliary publication, transform persistence, Average finite boundary/tie
controls and owner-approved Defeature replacements. It does not overwrite their
historical receipts. The strongest remaining gates are global/native large-mesh
and deviation reduction, native components/boundary/split comparisons and their
current lifecycle, other partial/bridge algorithms, the separate native failed
41-edge cup, available-scan smoothing/noise, and final candidate review/CI/merge.
M1 issue #1 was rechecked closed; main remains `57c77aa`. M2 remains open.

## Semi/Flat rendered acceptance, 2026-10-26

[The Semi/Flat lifecycle record](evidence/m2-native-semi-flat-lifecycle-20261026.json)
binds the retained native square-ring source/export to the current build. GUI
Semi hole/Flat with boundary 1 and arc 1 to 3 matches supported public MCP and
all nine oriented native facets; all eight original facets remain exact. Back
before Apply, undo/redo and binary reopening pass. The reversed-arc unit control
correctly differs. All 19 affected checks and the targeted 813-file TypeScript
program pass. A six-scenario rendered replay also passes all five existing
Bridge regressions with complete helper/port cleanup and no page errors.
Earlier driver failures remain retained: unsupported partial preview, inter-case
panel state, exhausted disposable-artifact count and a readonly test literal.
The driver now deletes decoded artifacts; storage and process limits are unchanged.
No production code changed for this acceptance slice. Remaining partial/bridge
algorithms and other milestone gates remain open.

## Smoothing source preservation on the available scan, 2026-10-26

[The production-scan record](evidence/m2-smoothing-source-preservation-20261026.json)
retains a new actual failure: smoothing 64 selected facets changed unrelated raw
corner 89,363 by about 0.00003 mm through tolerance-welded publication. Shared
selected and boundary smoothing now publish target coordinates only for vertices
that actually move; stationary vertices preserve original raw corner coordinates.
Moved aliases remain connected and consistent. Both isolated source-preservation
regressions fail before and pass after the fix, with warm/cold topology equality.
All 94 affected checks, thirteen TypeScript batches and warning-free build
`scanforge-17d06aa14c7f4518` pass. The unchanged 273,139-facet input and exact
64-facet selection now pass GUI/public-MCP equality, all 819,004 corner slots
outside the selected-region bounds plus 0.001 mm, cancellation rollback,
undo/redo, binary reopening and equal reopened diagnostics. Peak owned memory
was 2,717,134,848 bytes under the unchanged 4 GiB limit; all helpers/ports closed.
Fresh GUI/default-MCP six-pass and explicit two-pass annular native controls also
pass on this build. The real scan has no equivalent native export, so its native
numerical gate remains open. Boundary workflow acceptance remains separately open.

## Compact global reduction and rendered lifecycle checkpoint

The [compact integration record](evidence/m2-compact-reduction-integration-20261026.json) replaces the old object-record routing limit with bounded typed preparation and collapse records. The existing invalid-topology gate is preserved without diagnostic component objects. GUI preview acquires one bounded indexed original and reuses it for reduction; stale caches, cancellation, source ownership and below-four/no-op behavior have regressions. Independent review identified the preview double-weld admission gap; its actual RED was corrected and the complete affected suite passed 1,802 tests in 24 files. Build `scanforge-ecb2f00867553feb` passes all 13 TypeScript batches with 3,015 unchanged enumerated inputs.

The [final browser record](evidence/m2-global-reduction-browser-20261026.json) binds one frozen driver and that exact build across three inputs. GUI 50% and public-MCP triangle-count requests have identical complete coordinate digests: 40,960 to 20,480, original `scan-1.stl` 273,139 to 136,569, and manufactured 1,152,000 to 576,000 facets. All three assert the global collapse stage and absence of spatial fallback, source/history isolation, GUI Cancel-before-Accept, public preview discard, cancelled worker-result rollback, Undo/Redo and binary save/reopen. The 40,960 control also matches the independently frozen recovered whole-input digest; it is not a newly captured native UI export. The largest replay remains under the unchanged 4 GiB /25% CPU policy; all owned helpers and ports close. Exact timings, peaks, source/output/build/driver identities and failed observations are retained in the record.

The larger STL control exposes signed-zero normalization during export: 1,339 raw `-0` words export as `+0`, with zero numerical coordinate changes. Final validation preserves both digests and checks the narrowly canonicalized export, rather than claiming unchanged raw STL bits. No production geometry/export change was made for this test distinction.

Native large-input and deviation-dialog comparisons remain open. [Latest owned native readiness](evidence/m2-native-readiness-r15-20261026.json) again reads a visible/unminimized window but fails activation with access denied; no modeling/file input or export occurs. Successful cleanup is not native acceptance. M2 and PR #18 remain open, draft and unmerged; the live 5174 preview preserves its existing scene/history.

## Noise source publication and comparison checkpoint

The [noise correction record](evidence/m2-noise-source-and-comparison-20261026.json) binds two shared fixes. Noise publication preserves stationary raw corners instead of normalizing unrelated welded aliases. Direct deviation comparison now measures those published facets, matching GUI/public-preview comparison. Native smoothing, leaf/query arithmetic, defaults and resource limits are unchanged. Actual source-preservation REDs and a direct 8/9 versus preview 9/9 comparison RED pass after correction; 667 affected tests in 25 files and all 13 TypeScript/build batches pass on `scanforge-dc23d600e7862cae`.

Three original `scan-1.stl` runs cover explicit three iterations, whole-scan boundary smoothing on/off, and the retained 64-facet selection. GUI, direct `mesh_process` and public `scan_preview` produce identical coordinates and comparison summaries. Preview/Cancel isolation, public discard, cancelled-result rollback, Undo/Redo and binary save/reopen pass. The selected run preserves 2,457,012 scalar Float32 coordinate slots outside the selected raw bounds plus a conservative 2e-6 mm margin; shared vertices adjacent to selected facets may move. The manufactured six-facet [alias control](../tests/fixtures/noise-published-alias-control.json) additionally reproduces the comparison failure through the real browser/MCP boundary and passes all three paths at 9/9 on the correction. Frozen drivers, exact inputs, outputs, screenshots, per-run peaks and complete helper/port cleanup are retained. None is a native production-scan benchmark or new installed-native numerical export. The 40,960-facet global reduction control also retains its frozen global digest and complete lifecycle on this build.

Exact-head a831a21 CI run 40361910539 passes 49,897 tests with 64 fixture-gated skips, build, both CAD checks and formatting. The earlier f86e02d checkpoint and pre-correction controls remain separate. The remaining native/inventory/whole-milestone gates still precede closure and main merge.

## Component cleanup application lifecycle, 2026-10-27

The [component application record](evidence/m2-component-lifecycle-20261027.json) binds the current frozen build to three manufactured disconnected patches (2, 8 and 18 facets, areas 1, 4 and 9 mmÂ²), including a retained near-coincident corner. Rendered inventory, navigation, Keep, Flip, Extract, inclusive triangle-count cleanup and exclusive area cleanup use the same shared worker as public MCP. Complete Float32 coordinate digests match independent raw-corner expectations and GUI/MCP outcomes. Every operation passes Undo/Redo and binary project save/reopen; extraction retains its source and creates a separate owner. GUI Cancel-and-back and public cancelled-worker-result tests preserve geometry and history. No production application behavior changed for this validation.

This establishes the stated manufactured geometry and history-coordinate checks. Source visibility/selected-owner history was not asserted in that earlier checkpoint; the subsequent split/segment record below corrects those gaps. Same-input installed-native inventory/count/area/cleanup comparisons remain open; the retained native readiness failure and all other M2 acceptance gates still apply.

## Boundary smoothing admission and lifecycle, 2026-10-27

[The boundary record](evidence/m2-boundary-admission-lifecycle-20261027.json) retains an actual two-case executor RED for locked and exact-CAD admission. `boundarySmooth` was incorrectly in the read-only list; it now uses existing mesh edit checks before processing. Read-only inventory and projection reports retain their access. In the full old application, the locked edit already failed at model commit and preserved source/history, but still dispatched one geometry worker. One frozen browser driver reproduces that admission failure on the old build, then verifies zero worker requests on `scanforge-6a1dbd85da287221`. No production locked-geometry corruption is claimed.

All 123 affected tests, thirteen TypeScript batches and the warning-free build pass. Current manufactured selected-boundary and all-boundary smoothing produce identical complete GUI/public-MCP coordinate digests. Unrelated raw corners remain unchanged for the selected boundary. Both paths pass Undo/Redo, binary save/reopen, public held-result cancellation and GUI Cancel-and-back; protected inspection remains available. All owned helpers/ports close under the unchanged 4 GiB /25% CPU guard. Installed-native boundary output comparisons remain open. At that checkpoint, projection created GUI saved sketches without a model-history transaction while MCP returned curve reports; the subsequent publication correction is recorded below.

## Boundary projection publication and history, 2026-10-27

[The projection record](evidence/m2-boundary-projection-publication-20261027.json) binds an actual GUI RED: a saved sketch was created while model history remained at zero. The shared correction uses one planar sketch converter in GUI/MCP and existing identity-scoped model-sketch history. Public `scanEdit/boundaryProject` retains the read-only curve report default; explicit `createSketches:true` publishes new saved sketches and returns `sketchIds` plus that artifact. A validated sketch-only transaction advances model history without a dummy geometry change. No projection geometry algorithm, kernel, dependency or resource guard changed.

All 143 affected contract/geometry/history/persistence tests in eight files and all thirteen TypeScript/build batches pass on `scanforge-2a46d3d412c3aeea`. One frozen browser driver reproduces the old history failure and passes selected/all GUI/public-MCP equality on the correction. Source geometry, active draft and unrelated/later sketches remain intact across Undo/Redo/Seek and binary reopening; retry does not duplicate sketches. Held-result job cancellation, GUI Cancel-and-back, locked publication rejection and protected read-only projection pass. Independently visible saved projections render as three closed planar outlines, and binary reopening preserves visibility. Exact identities, timings, peaks, screenshots and complete helper/port cleanup are retained. Installed-native boundary output/settings comparisons, remaining M2 rows and final whole-candidate review/CI/main merge stay open.

The [prepared Split input record](evidence/m2-split-native-input-controls-20261027.json)
pins the existing disjoint-plane, convex and concave application controls as
binary STL inputs for later native runs. The imported finite-plane, convex and
concave cases now pass GUI/public-MCP geometry, ownership, cancellation, history
and reopening checks using those exact files. A fresh native session opened, but
Windows denied input before import; no native Split result is claimed. Equivalent
native command settings, output geometry and ownership remain required.

## Split cutter binding and segment publication state, 2026-10-27

[The split/segment record](evidence/m2-split-segment-publication-20261027.json) retains actual failures for plane binding, component visibility history, empty result rejection and source-file provenance. Materialized planes persist `planeFrame`, which both old split paths missed after project loading removed transient fit data. GUI and MCP now share authoritative reference-plane binding; ordinary meshes remain finite, and explicit operation planes stay authoritative. Both adapters publish split/extracted/segmented parts through one constructor, retain raw source/cutter buffers and source filenames, use matching names/normal part appearance, hide the original and select the first result. Existing `modelVisibilityFor` history ownership restores source visibility on Undo/Redo/Seek; all-empty results fail atomically. No clipping/classification algorithm or resource guard changed.

All 208 affected tests in fourteen files and thirteen warning-free TypeScript/build batches pass on `scanforge-2fc7a9818f5df3e7`. Five manufactured split cases cover an infinite reference plane, finite planar mesh, folded open surface and convex/concave solids. Complete GUI/public-MCP facets, output appearance/names/provenance and selected-owner/source-visibility state agree; independent cross-product areas conserve the input area, including 1/15 and 3/13 mmÂ² partitions. Source/cutter geometry, GUI/MCP Undo/Redo, binary reopening, held-result cancellation and GUI Close cancellation pass. The component five-case replay also passes raw-corner oracles plus the newly asserted extraction visibility/selection/history/provenance. Frozen drivers preserve the actual old REDs and current GREENs. All helpers/ports close under unchanged 4 GiB /25% CPU limits. Native plane/closed/open cutter and other inventory comparisons, final whole-candidate review/CI and main merge remain open.

## Recovered 41-edge failure control and candidate review, 2026-10-27

The original matched-height 41-edge STL is available locally and matches input SHA-256 cfb36f1235043361d42bf634345ddee919d5e30db58a41cd3cba82e1be5d1e94. The retained native Automatic and Curvature exports are identical failed fills (376 facets, two holes/two components). The [new failure-control record](evidence/m2-failed-cup41-20261027.json) binds the sanitized 123-facet source to its original Float32 corner digest. Current application Curvature and Automatic both reject the unusable collar with identical GUI/public-MCP error text, unchanged geometry/history, binary reopening and unchanged reopened topology. A subsequent Flat fill and Undo/Redo pass. Thirteen focused tests pass; both browser replays use unchanged application build scanforge-2fc7a9818f5df3e7, with all 820 source hashes matching and clean owned-process/port cleanup. This resolves rejection/rollback disposition for this failed control; it does not claim native successful-cap geometry equality. Historical records claiming no retained 41-edge input apply to their earlier checkpoints.

A fresh read-only review of 57c77aa..69a1380 found no confirmed P1/P2 source blockers after passes through shared publication/history, compact reduction, Average/Unroll, projection/split and representative repair helpers. It did not execute tests or independently audit every fixture/receipt or prove arbitrary Curvature mathematics. Native and final integration gates remain required.

## Native boundary smoothing correction, 2026-10-27

[The native boundary record](evidence/native-boundary-smoothing-20261027.json) binds the installed 8.0.123 image, original 64-facet annulus, settings and exported ordered coordinates. The shared async operation now matches every nonzero Float32 coordinate exactly. Three outer-Y slots differ by at most 1.9984014443252818e-15 mm around mathematical zero; the predeclared 16*DoubleEPS*input-scale zero rule applies, while the immutable native raw hash and stricter failed receipts remain retained.

The correction includes native binary-import ordering, mixed-precision smoothing distances, bounded periodic cubic fitting, immutable snapshot projection, boundary-locked correction and static-derived face cleanup. Updated indexed output reaches both GUI and MCP, preserving source buffers and successor identity. The integrated affected batch passes 120 tests. Direct MCP execution uses the real processing worker and pinned WASM, with one model commit and history mutation. This does not substitute for current rendered/public-socket lifecycle acceptance. Independent native open/anchor/folded controls, slider binding, native 3D Sketch and the other inventory rows remain open; M2 is not closed or merged.

The [current rendered/public-MCP record](evidence/m2-boundary-native-browser-20261027.json) verifies this annulus on the latest working source matching build `scanforge-83a2ca2e8c172ece`: one GUI history step, exact complete GUI/MCP digests, original bytes on Undo, restored edited geometry on Redo and binary save/reopen, retained indexed identity and equal second edits. Immediate public SDK cancellation preserves geometry/revision/history. Earlier requests that completed before cancellation and a post-Undo BUSY response remain retained; they are not counted as cancellation passes. Both temporary bridge helpers closed cleanly; active-kernel cancellation and independent native controls remain separate gates.

The fresh boundary-correction review found one invalid-topology admission gap. Four regressions failed before the shared guard; 65 affected tests pass after it, preserving source/cache and MCP history on rejection. The complete pre-guard suite passed 49,947 tests with 64 conditional skips. The reviewed guard candidate passes all thirteen TypeScript/build batches (`scanforge-dd3c0e023e41fd94`); both CAD smoke programs pass. Canonical repository formatting passes all 2,310 candidate files after local CRLF normalization with no Git content change. The broad local-folder format attempt failed only on ignored workflow ledgers and is retained separately. Review follow-up finds the admission issue resolved; native acceptance limits above remain open.

## Spatial boundary sketch creation, 2026-10-27

The shared boundary operation publishes one saved spatial sketch containing ordered fitted curves; GUI and `mesh_process` expose the same operation, and `sketch_get` exposes its curve data. The [finite comparison](evidence/m2-spatial-boundary-sketch-20261027.json) uses the original annulus inner boundary at 0.05 mm: GUI and public MCP curves match exactly, native IGES degree and knots match, and the maximum pole difference is 1.21e-8 mm against rounded native text. Both created sketches were removed by model Undo; MCP Redo restored its sketch. JSON and binary project/history serialization are covered by tests. A public MCP binary export and reopen additionally preserved the sketch bank and source geometry digest, and post-reopen Undo/Redo removed and restored the sketch. Spatial sketch editing remains unimplemented. Native controls for selected and all boundaries, nonplanar behavior, and resource guards are covered by focused tests; this does not close M2 or establish parity on arbitrary meshes.

## Retained native Unroll frame bytes, 2026-10-27

The native 0-degree cylinder project `native-frame90-unroll0.qsf` is pinned by SHA-256 `557494b57c4e006aa5a4d079ffce2bd87ba036de7918d6032664f033a50f8e47`. In that project the UTF-16 name `Roll frame(1)` begins at byte 3540; 96 bytes at byte 3602 form the [retained 12-double control](../tests/fixtures/unroll-native-roll-frame.json). Interpreting those bytes as a 3-by-4 row-major affine matrix yields a frame matching the shared Unroll auxiliary producer within 6.2e-17 in this one case. The matrix interpretation is inferred from the adjacent record and previously analyzed native frame constructor; it is not an independently decoded general QSF format or a runtime capture. The seven Unroll auxiliary tests pass, including the new fixed-byte comparison. GUI and MCP use the same producer and their previously documented lifecycle checks remain separate from this raw-file comparison. Arbitrary reference frames, general project parsing and the remaining M2 native gates remain open.

The same native control also exported its auxiliary sketch as an IGES line. The [retained endpoint record](evidence/m2-unroll-frame-control-20261026.json) is now directly compared with the shared producer in the focused test: both endpoints, their connectivity and the OXY sketch plane agree within 5e-10 mm. The largest difference is 3.60e-10 mm in the circumference coordinate, against decimal-rounded IGES text. The source fixture matches the original STL's ordered Float32 triangle coordinates; the IGES file hash matches the retained record. Eight focused tests pass under the 4 GiB helper job. This is one native cylinder control, not arbitrary-frame acceptance.

## Outer-boundary spatial fit controls, 2026-10-27

The same shared spatial-sketch operation also matches the retained original annulus outer-boundary IGES control points to six decimal places and knot vectors exactly at both explicitly entered 0.05 mm and 0.001 mm tolerances. The seven focused spatial-boundary tests include both controls and pass under the 4 GiB validation guard. The original mesh and both IGES hashes match [the native record](evidence/native-boundary-3d-sketch-20261027.json). A subsequent [combined-preview control](evidence/m2-spatial-outer-combined-20261027.json) verifies GUI/public-MCP curve equality at 0.001 mm on the outer boundary, model Undo/Redo, binary project reopening, post-reopen Undo/Redo, and unchanged source geometry. It matches native knots exactly and poles within 4.44e-10 mm against rounded IGES text. A separate public-MCP guard run rejected a stale revision, cancelled an immediate small-fixture fit at progress 0 without changing revision, history, sketches or source geometry, and rejected a locked source without publication. It does not establish active-kernel cancellation. Both test tabs reported no browser warnings or errors; the viewed screenshot was not retained. The earlier selected-inner comparison remains a separate control. Other boundary-creation geometries and the remaining native M2 gates are not established; interactive spatial-sketch editing is tracked in M4.

## Spatial fitting cancellation after progress, 2026-10-27

A [public MCP control](evidence/m2-spatial-active-cancel-20261027.json) used 400 translated annuli with 800 closed boundaries. At 0.001 mm tolerance the job reported fitting progress for one boundary before cancellation was requested. It ended cancelled with unchanged project revision, history, saved-sketch count and complete source-position digest. The exact instruction running at cancellation was not independently observed. The isolated browser reported no ScanForge warnings or errors, and one Chrome autofill-extension error; the bounded helper and descendants cleaned up. This manufactured control does not establish native equivalence or close the other M2 gates.

## Split tolerance and precision controls, 2026-10-27

Shared GUI/MCP Split now classifies and interpolates against the same plane, retains small nonzero facets, and checks generated facets at Float32 output precision. Manufactured controls cover near-plane cuts, near-edge non-intersections and several shared-edge cases. If a generated facet collapses or reverses at output precision, the operation rejects atomically; the finite-cutter fallback is conservative for rounded noncoplanar boundaries. The [earlier scoped evidence](evidence/m2-split-tolerance-20261027.json) recorded an exactly coplanar neighboring-face seam failure; the subsequent shared boundary-contact correction passes that finite fixture in both cutter directions. Native Split comparison, general coplanar overlap semantics and general watertightness remain open; these controls do not establish them. See [the coplanar control](evidence/m2-split-coplanar-20261027.json).

## Finite Split segment defect, 2026-10-27

A manufactured single-triangle control exposed an earlier shared Split defect: an open cutter intersecting only an interior segment extended the seam to the source boundary. The [failure and bounded static candidate trace](evidence/m2-split-finite-support-20261027.json) retain the original observation. The later finite-segment route is assessed on that control below; general finite-segment behavior and native comparison remain open.

## Split contact-copy precision, 2026-10-28

The shared Split path now collapses consecutive numerical copies of the same observed contact when they round to the same Float32 output, while retaining original source corners. The original `ply-1` face 7207 previously rejected; it now passes direct winding/area checks and GUI/public-MCP geometry, history, reopening and cancellation checks. Direct one-cutter runs on the three original scans retain source and cutter buffers and pass area and seam-edge-set checks under the 4 GiB guard. [Scoped evidence](evidence/m2-split-contact-copy-20261028.json) records the browser, suite and typecheck boundaries. The independent review found no concrete blocker for this incremental correction. Native and milestone gates remain open.

## Finite-interior Split control, 2026-10-28

The current shared precise Split route was replayed on the earlier one-triangle interior-cutter control. The [GUI/public-MCP record](evidence/m2-finite-interior-gui-mcp-20261028.json) confirms matching output geometry, a finite seam with no spurious boundary outside the cutter, source Undo/Redo, unchanged cutter and binary reopening. The focused suite passed 77 tests with one expected failure in the separate experimental Float32 seam mode. This resolves the previously observed control for the current route; it does not establish general finite-cutter semantics, native equivalence or M2 closure.

## Indexed component grouping memory check, 2026-10-28

The shared component worker now joins faces as it encounters edges instead of retaining every edge incidence. On build `scanforge-bd445525d73e4d0a`, the manufactured rendered control passed GUI/public-MCP geometry comparisons, Undo/Redo, save/reopen and cancellation, with a 907,161,600-byte peak. The original `ply-3` combined run completed GUI Split, GUI Extract, Undo and public-MCP Extract, but timed out while checking the MCP output digest. Its measured peak was 4,392,824,832 bytes, above the 4 GiB limit, so neither full parity nor memory acceptance is established by that run. Native comparison and M2 closure remain open.

The subsequent [allocation diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) found substantial collectible renderer allocations around extraction and identified the selection outline and exact indexed admission among the hot paths. Explicit diagnostic garbage collection allowed the original GUI and MCP output digests to match, but the job still exceeded 4 GiB. Removing temporary outline tuples preserved the focused geometry and manufactured GUI/MCP lifecycle checks; a normal original-scan replay still exceeded the limit and timed out. The memory gate remains open.

A controlled browser microprofile showed fewer sampled allocations when comparing finite numbers directly while distinguishing signed zero, so the shared exact admission uses that equivalent comparison. The 114 affected tests and manufactured GUI/public-MCP lifecycle replay pass. On build `scanforge-ab64f5f92f193f8e`, the uninstrumented original-scan replay still timed out before the first Extract verification, peaking at 4,311,244,800 bytes. This change does not establish the 4 GiB acceptance gate.

An additional typed-array finite-validation microprofile showed fewer sampled allocations with an indexed loop. Shared geometry and project validation now use that loop for typed values, while ordinary arrays retain their existing callback behavior. The 119 affected tests and manufactured GUI/public-MCP lifecycle replay pass. The uninstrumented original-scan replay on `scanforge-0ab35f091c0584bc` still timed out before Extract verification and peaked at 4,309,864,448 bytes; the memory gate remains open.

The shared component inventory worker now omits the expanded source only after a cancellable bit-exact indexed admission; mismatched corners retain the earlier full-source path. A real worker comparison and 119 focused tests pass, as does the manufactured GUI/public-MCP lifecycle replay. On `scanforge-162556494cd129aa`, the original scan completed GUI Extract, Undo and MCP Extract, but timed out during the output digest at a 4,350,103,552-byte peak. This remains above the 4 GiB limit and is not a full parity or memory acceptance pass.

Diagnostic sampling subsequently identified digest finite-value validation and a typed-array callback as allocation sources. Shared validation now uses equivalent finite-number bounds and a typed loop, preserving NaN, infinity, nonnumber and signed-zero behavior. Sixty-nine focused tests and the manufactured GUI/public-MCP replay pass. The normal original-scan replay on `scanforge-74bba52674994711` still timed out before GUI Extract verification at a 4,346,515,456-byte peak. The 4 GiB gate remains open.

In a separate diagnostic replay of that build, explicit collection enabled the original GUI/MCP output digests to match. Sampled allocations attributed to digest validation fell from approximately 846 MB to 3 MB, but the owned job still peaked at 4,310,507,520 bytes. These sampled numbers are estimates under diagnostic collection, not normal-run memory acceptance.

The subsequent extraction profile also identified indexed admission and ordinary-array validation. Their checks now avoid per-element callback boxing while retaining finite-value, signed-zero and sparse-array semantics. The 144 focused tests and manufactured GUI/public-MCP replay pass. The normal original-scan replay on `scanforge-cf2fb30d9d20230e` timed out before GUI Extract verification, with a 4,329,013,248-byte peak. The 4 GiB gate remains open.

A worker timeline observed no project-encoding worker before a separate original-scan Extract timeout; an export control confirmed the trace detects that worker. Component-panel idle updates now avoid republishing an unchanged selection, while explicit clicks retain their existing behavior. Ninety-five focused tests and the manufactured GUI/public-MCP lifecycle replay pass. The normal original-scan replay on `scanforge-d34fb87bd26941c8` still timed out before GUI Extract verification at a 4,332,331,008-byte peak. The memory gate remains open.

Precise indexed Extract now prepares its existing welded display normals in the worker and transfers them with the segment, avoiding a second expanded-mesh display preparation on the renderer. The real-worker normal control compares against the previous expanded shading; 128 focused tests and the manufactured GUI/public-MCP replay pass. On `scanforge-d0fd2a36abbeecc2`, the normal original-scan GUI Extract, Undo and MCP Extract completed with equal geometry digests and unchanged cutter. The owned job nevertheless peaked at 4,382,154,752 bytes, above 4 GiB; the large-scan Redo, save/reopen and memory gates remain open.

The real-worker control also exposed progress decreasing during display preparation; progress now remains monotonic. An attempted earlier release of the private worker source was reverted after the original-scan replay still exceeded the memory limit and timed out in the final MCP digest. Its receipt is retained in the allocation diagnostic.

Outer-Job high-water sampling places a substantial rise during component inventory and another around GUI Extract publication and digest. Selection-outline directories now grow only for new keys and at a higher load factor; quantized boundary comparisons, the focused viewport tests, and the manufactured GUI/public-MCP replay pass. On `scanforge-1295353c775ff282`, original GUI/MCP Extract digests matched without forced collection, but the job peaked at 4,405,010,432 bytes. The high-water samples are approximate and the 4 GiB gate remains open.

Exact large indexed inventories now transfer compact triangle-index buffers from the worker; public MCP inventory artifacts retain their JSON array contract. A real-worker test and a 66,048-triangle public MCP control pass, as do the manufactured GUI/MCP component lifecycle checks. The normal original-scan replay on `scanforge-53a4d1abf2bf34e7` produced matching GUI and MCP Extract digests, but peaked at 4,380,844,032 bytes. A separate process snapshot found substantial renderer and GPU allocations; disposing hidden geometry did not reduce the observed peak and was reverted. The [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) records the sampling limits. Original-scan Redo, save/reopen, the 4 GiB gate and native acceptance remain open.

Caller sampling identified per-element callbacks in shared segment validation and component selection. Equivalent direct loops pass 97 focused tests and the manufactured GUI/public-MCP component lifecycle. The normal original-scan replay on `scanforge-9e3f489f18428520` matched GUI/MCP Extract geometry and preserved the source and cutter, but peaked at 4,356,243,456 bytes. The 4 GiB gate and original-scan Redo and reopening remain open; the [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) includes the unsuccessful experiments and profiling limits.

Precise local-coordinate conversion for normal and deviation display now uses an indexed loop. A three-million-coordinate browser microprofile produced identical Float32 output with fewer sampled allocations, and the precise-picking and manufactured GUI/public-MCP lifecycle controls pass. The original-scan replay on `scanforge-7bbc1c3e2e224cd4` lost its MCP connection during GUI Extract; the guard peaked at 4,295,876,608 bytes and cleaned up. This run does not establish large-scan geometry, memory acceptance or native equivalence.

Exact indexed Extract now releases private worker transport buffers after restoring their coordinates, while retaining any buffer referenced by the result and falling back when buffer transfer is unavailable. Ownership tests and a 66,048-triangle public MCP Extract, source preservation and Undo/Redo control pass. A browser microprofile observed immediate backing-storage release, but the original-scan replay on `scanforge-75ec4ba8f805e619` timed out at the GUI digest with a 4,295,229,440-byte peak. Large-scan memory, history and native acceptance remain open; see the [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json).

When selection moves to a different mesh, the viewport now retires the old selection overlay before displaying the new mesh; it keeps the overlay when the positions are shared. Focused disposal and selection tests and the manufactured GUI/public-MCP lifecycle pass. The original-scan replay on `scanforge-4045762aeccdf304` timed out at the GUI digest with a 4,295,630,848-byte peak. The [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) retains the scope and cleanup result; the 4 GiB and native gates remain open.

Worker-restored coordinate arrays now use a separate finite validator to avoid mixed-array optimization feedback; every call still checks the current contents and preserves sparse-array behavior. Mutation, worker, and GUI/public-MCP lifecycle tests pass. The normal original-scan replay on `scanforge-b724c55c857a1fea` timed out at the GUI digest with a 4,295,577,600-byte peak. A separate diagnostic with explicit collection matched GUI/MCP Extract geometry and recorded no sampled finite-validator allocation in the MCP Extract profile; it is not normal-run memory acceptance. See the [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) for limits and results.

The selection ripple now stores one byte per triangle corner and reconstructs the existing barycentric values in its vertex shader. Focused outline and shader tests, a reduced-motion rendered comparison, and the manufactured GUI/public-MCP lifecycle pass. The normal original-scan replay on `scanforge-5bf5da7b96bfba8d` timed out at the GUI digest with a 4,295,598,080-byte peak. The [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) records the visual comparison and its limits; large-scan and native acceptance remain open.

Precise Split now releases unreferenced worker transport buffers after restoring coordinates, preserving result and input aliases and retaining a fallback when transfer is unavailable. Ownership tests, the finite Split GUI/public-MCP lifecycle and the manufactured component lifecycle pass. On `scanforge-8c7a6481c8d1f97a`, the original-scan GUI Split digest completed and browser-reported heap at inventory was about 659 MB; the subsequent Extract digest timed out with a 4,295,593,984-byte job peak. A separate diagnostic observed page-heartbeat timeouts without collection and responsive heartbeats with explicit collection; the latter is not normal-run memory acceptance. See the [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) for measurement limits and remaining gates.

Retiring a selection overlay now releases its privately allocated position, corner and line-instance buffers after disposal, while preserving source and shared line geometry and falling back when buffer transfer is unavailable. Ownership tests and a rendered GUI/public-MCP component lifecycle pass; the selected region matches the prior reduced-motion control pixel-for-pixel. The original-scan replay on `scanforge-5f1c43970a02fe59` timed out at the GUI digest with a 4,295,180,288-byte peak. The [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json) records the comparison limits; large-scan and native acceptance remain open.

Three [pinned STL controls](../tests/fixtures/m2-split-point-radius/manifest.json) place a nominal cutter intersection below, at and above the statically inferred native point-search radius. The shared Split test verifies file hashes, imported coordinates, repeatability, unchanged inputs and conservation of the source triangle's area. The [GUI/public-MCP replay](evidence/m2-split-point-radius-gui-mcp-20261029.json) compares precise positions and indexed topology, GUI and MCP Undo/Redo and binary reopening; each output has nine facets and preserves the source area and cutter. Its job peaked at 697,716,736 bytes and cleaned up under the 4 GiB cap. A stricter initial digest comparison failed because Redo exposed additional normal caches; normal-cache lifecycle equivalence is not established by the core-geometry comparison. Native routing, binding and actual boundary behavior remain unverified; the nominal exact-boundary case may be affected by the native intersection calculation.

The [normal lifecycle replay](evidence/m2-split-radius-normal-lifecycle-20261029.json) traces that digest difference to history activation, which computes missing geometry and facet normals. For these three planar controls, the computed vectors match the positive-Z plane normal and their Float32 hashes agree after GUI Redo, MCP Redo and binary reopening. The initial successor has no stored normal caches, so its full digest still differs after activation. The replay does not establish pixel-level equivalence or behavior for curved meshes and authored normals.

The [held-result cancellation replay](evidence/m2-split-radius-cancellation-20261029.json) also passes for all three controls: public MCP cancellation and closing the GUI panel each preserve the source, cutter, object state and history. It exercises cancellation after the worker result is held before publication, not interruption of active geometry computation. The guarded job peaked at 703,963,136 bytes and cleaned up.

On the same three planar controls, a [rendered history replay](evidence/m2-split-radius-render-history-20261029.json) shows byte-identical viewport screenshots before Undo and after GUI Redo with a centered camera, reduced motion and SwiftShader. This covers one view and lighting configuration; it does not establish general curved or authored-normal rendering equivalence. The earlier partially framed screenshots are excluded from this result.

An isolated [numeric transfer probe](evidence/m2-reopen-transfer-probe-20261029.json) modeled the four measured decoder buffer sizes and checked every restored value, including signed zero. Transferring and reconstructing one buffer at a time while retaining the worker's arrays peaked at 1,526,923,264 bytes; transferring all and waiting for worker exit before reconstruction peaked at 1,017,249,792 bytes. Repeats showed the same direction. This Node model does not cover Chromium, the old project, aliases or cancellation, and does not rule out streaming with a different ownership strategy; the in-place 4 GiB gate remains open.

A subsequent [ownership probe](evidence/m2-reopen-ownership-probe-20261029.json) dropped each worker array reference before transferring its numeric buffer. Its 1,526,202,368-byte peak was similar to the retained-array streaming control, versus approximately 1.02 GB for the batch control. Releasing references does not guarantee collection; this synthetic Node result does not establish browser behavior or rule out other ownership designs.

The M2 candidate now includes the combined preview's shared-backed BREP text decoding fix. The [isolated browser replay](evidence/m2-shared-brep-project-reopen-20261029.json) reproduces the previous TextDecoder failure through public MCP on a generated CAD sphere and then passes GUI and MCP binary project reopening on the corrected build, with matching geometry digests. The shared numeric backing regression and 41 focused restore, transport and backup tests pass. The browser job peaked at 1,501,003,776 bytes under the 4 GiB cap and cleaned up. This one CAD control does not establish the original-scan in-place memory gate or native CAD equivalence.

A [mixed-project replay](evidence/m2-mixed-cad-scan-reopen-20261029.json) adds the hash-pinned 273,139-facet original scan and applies Flip Normals through public MCP alongside the CAD sphere. After saving and reopening through both public MCP and GUI, CAD and edited scan digests match; public-MCP Undo/Redo after each reopen restores the original and edited scan core geometry while preserving the CAD geometry. Peak job memory was 2,114,146,304 bytes under the 4 GiB cap, with cleanup confirmed. This control does not replace the larger original PLY-3 Split/Extract in-place resource gate or native comparison.

The [concave Split import-order control](evidence/m2-split-concave-native-import-order-20261029.json) identifies an indexed cutter mesh in the saved native scene and matches all 28 input facet and corner sequences. The existing binary STL topology importer also matches the native vertex and index arrays in a portable regression test. This rules out an import-order difference for this control; it does not establish native spatial-tree ordering or fix the still-expected native Split facet mismatch. No application behavior or MCP contract changed in this check.

A [read-only inspection of the previously split native square source](evidence/m2-split-native-tree-source-depth-20261029.json) found eight leaf children, two containing 18 facet references each, with no deeper subdivision. This constrains an unconditional facet-reference threshold but does not reveal the native subdivision rule; the cached tree was not reconstructed during the inspection. The guarded process peaked at 17,039,360 bytes and cleaned up. No application behavior or MCP contract changed.

The [native evaluator construction trace](evidence/m2-split-native-evaluator-construction-20261029.json) connects the observed cached evaluator to its allocation and tree-member initialization in the analysis snapshot. It locates the member owning the observed root pointer, but does not establish the subsequent tree population or subdivision policy. The largest static-analysis job peaked at 705,191,936 bytes under the 4 GiB cap; cleanup completed. This evidence does not change application behavior or MCP coverage.

A [bounded static search](evidence/m2-split-native-tree-global-search-20261029.json) found other recursive query routines with the same node layout, but no verified tree builder. The search is heuristic and can miss code. Its initial unchunked attempt hit the 4 GiB guard; the chunked searches and focused decompilation completed, and all jobs cleaned up. Native subdivision and Split parity remain open.

A subsequent [candidate construction and subdivision trace](evidence/m2-split-native-tree-subdivision-rule-20261029.json) identifies a recursive branch that subdivides when a node has at least 25 facet references, its x-width exceeds a caller-supplied size, and its depth is below the configured limit of 10. The observed small leaves contain fewer than 25 references, consistent with the condition. Eight candidate function entry prefixes match the running native image, but their runtime reachability and the size parameter are not established; no captured tree exercises these boundaries. The earlier root-cube prototype also omits some native Float32 rounding steps. Split behavior and MCP coverage are unchanged.

A [live configuration and rounding check](evidence/m2-split-native-tree-live-settings-and-rounding-20261029.json) reads a 0.5 minimum width, 25-reference threshold and depth limit 10 from four cached native trees. An offline reconstruction using the Float32 operations inferred from the native initialization matches three captured root bounds; a synthetic input demonstrates a difference from the earlier simplified cube hypothesis. Neither the synthetic case nor the subdivision boundaries have been observed in native construction. The two guarded checks peaked at 27,004,928 bytes and cleaned up; application and MCP behavior are unchanged.

An [offline concave point-order comparison](evidence/m2-split-reordered-app-point-comparison-20261029.json) reorders captured application hits by the observed native facet order and pools their endpoints. Neither existing application endpoint order nor lexical endpoint order reproduces both native face point vectors; reversing every endpoint pair matches one face only. Traversal order alone therefore does not reproduce the point vectors. The check peaked at 15,040,512 bytes and cleaned up; it does not execute a new native operation or change GUI/MCP behavior.

A [cavity follow-up](evidence/m2-split-app-order-cavity-20261029.json) maps those app-collected point-order variants to captured native projected coordinates. All three endpoint variants reproduce the captured initial triangles on both concave faces in the offline prototype, despite their different point vectors. Endpoint ordering is therefore not established as the cause of this control's facet mismatch. The check uses observed native facet order and projection; constraints, production behavior and general parity remain open.

An [isolated integration experiment](evidence/m2-cavity-integration-experiment-20261029.json) used exact-incircle cavity insertion for interior points while retaining the application's boundary insertion and constraint recovery. It passed 144 focused tests, but native facet matches changed from 12 to 11 on convex, 22 to 15 on concave and 10 to 11 on cyclic; all three native assertions still fail. The experimental implementation was not applied. Native point/tree ordering, constraints and general performance remain unresolved.

An additional [collector-order experiment](evidence/m2-collector-order-experiments-20261029.json) retained current application segment order instead of sorting it, while still canonicalizing endpoints. Existing insertion matched 11, 16 and 11 native facets on the convex, concave and cyclic controls. Combining that order with the mixed cavity experiment caused the concave control to fail the overlapping/non-manifold assembly check. Neither variant was applied; this is not the recovered native tree order.

An [isolated frame experiment](evidence/m2-native-frame-cavity-experiment-20261029.json) combines one-level native-style traversal and cavity insertion. An orthonormalized metric improves facet matches to 13/18, 25/34 and 16/18. Injecting each face's captured native projection instead yields 16/18, 34/34 and 16/18. One captured original face is non-uniformly scaled, so an assumption that all native projections preserve relative distances is incorrect. The native routine's static trace constructs a local frame and independently normalizes its axes. Injected oracle frames are diagnostic only; general frame construction, remaining facets, orientation, constraints, performance and GUI/MCP validation remain open. No candidate was applied.

A [frame reconstruction follow-up](evidence/m2-native-frame-reconstruction-20261029.json) derives the ordered-corner projection with Float32 rounding and independent axis normalization; it exactly reproduces all captured projected points on six planar faces. Replacing injected frames with this formula in the isolated experiment retains 16/18, 34/34 and 16/18 facet matches. The concave native assertion passes there, but two native assertions and five focused constraint/precision tests fail. This prototype is not safe to apply and does not validate general or non-axis-aligned native projection.

The [bounded triangle-intersection analysis attempts](evidence/m2-split-intersection-static-bounds-20261029.json) extended the candidate's disassembly to 89,468 instructions, but the decompiler still reported incomplete flow. The launcher exits were successful while the decompilations were not. The largest guarded attempt peaked at 1,506,140,160 bytes and cleaned up; these attempts do not establish endpoint ordering or change application behavior.

The [real-face precision check](evidence/m2-split-real-face-precision-20261029.json) verifies two components, positive facet orientation and signed projected area conservation through the shared precise Split operation on one original scan face. Signed area alone cannot rule out compensating overlaps or gaps. Two trial Float32 seam guards were removed after each rejected the existing real-scan regression; the Float32 coverage expected failure remains. The focused batch passed 27 tests with four expected failures. No application or MCP behavior changed.

A [coverage follow-up](evidence/m2-split-coverage-controls-20261029.json) checks source containment, plane agreement and pairwise projected overlap on both the original face and dense-cutter controls, in addition to positive orientation and projected area. All three tests pass using the stated floating-point tolerances. These finite checks do not establish general geometry coverage or native, GUI or MCP equivalence.

A [prepared 128-facet tree-depth control](evidence/m2-native-tree-depth-fixture-20261029.json) is predicted to place 49 or 50 facet references in each root child, above the inferred 25-reference subdivision threshold. Its pinned application control passes the shared Split operation with unchanged inputs, one connected component, positive orientation and conserved projected area. A follow-up also checks every output corner lies in the source rectangle and every pair of projected output facets overlaps by less than 1e-10 square units; this is a floating-point test of one control. Native input still returned `GetCursorPos` access denied, so the fixture has not been imported or validated in QuickSurface.

The [dense-cutter browser replay](evidence/m2-dense-split-gui-mcp-20261029.json) subsequently compared GUI and public MCP geometry, Undo/Redo, held-result cancellation and MCP binary reopen on retained build `scanforge-0c3cfeae80a65b03`. The GUI initial and Redo canvas screenshots match byte-for-byte, though the seam is not visually distinguishable in that view. The guarded run peaked at 925,454,336 bytes and cleaned up. Native equivalence and GUI file-open remain unverified.

On the older shared-BREP build, two original PLY-3 Split/Extract in-place reopen runs completed project import but timed out before the next recorded stage. This build predates and does not contain the later numeric-reuse candidate, so these runs do not validate current source. The harness then attempts artifact deletion followed by an Extract digest, but the retained records do not distinguish which call stalled. The first used the existing 2 GiB Chrome V8 heap flag; the second raised that internal allowance to 3 GiB while retaining the 4 GiB aggregate job cap. Their peaks were 4,295,847,936 and 4,295,229,440 bytes respectively; both guards cleaned up. Neither run establishes post-reopen geometry equality or memory acceptance, and the timeout does not isolate its cause. See the [diagnostic](evidence/m2-extract-allocation-diagnostic-20261028.json).

An [instrumented repeat on that older build](evidence/m2-inplace-reopen-attribution-20261029.json) separately confirms import and artifact deletion completed, then a `job_get` request timed out while polling the Extract digest. The guarded peak was 4,295,741,440 bytes and cleanup completed. This identifies the failed request in this run, but not whether hashing, scheduling, the bridge or memory pressure caused it; post-reopen equality and the 4 GiB gate remain open.

A further [heartbeat replay](evidence/m2-inplace-reopen-heartbeat-20261029.json) observed the digest job reporting hashing at about 3.6%. The page answered two heartbeat checks after that observation, then a three-second heartbeat and a `job_get` request timed out. Peak job memory was 4,313,718,784 bytes and cleanup completed. The heartbeat does not identify why the page stopped responding, and this instrumented run does not establish post-reopen equality or the memory gate.

After identifying that those two diagnostic repeats used the older build, a [fresh current-source replay](evidence/m2-current-source-inplace-reopen-20261029.json) included numeric reuse and the offline manifest. It completed GUI Split/Extract and Undo/Redo, public MCP export/in-place import, and matching post-reopen Extract, source and cutter digests. Its guarded peak was 4,212,957,184 bytes, below 4 GiB, and cleanup completed. One heartbeat exceeded three seconds but the run completed. This single instrumented replay does not establish general resource repeatability, GUI file-open or post-reopen history, nor native Split equivalence.

A fresh native dense-cutter Split control imported the pinned 2-facet source and 128-facet grid in millimetres, used mesh Split with Envelope unchecked, previewed and applied the result, and exported 36 facets. The native viewport capture was blank, so geometry is assessed from the export, not rendered appearance. The [read-only cutter tree snapshot](evidence/m2-dense-grid-native-tree-20261029.json) contains 73 nodes and 56 nonempty leaves through depth 3. An isolated recursive prototype matches all captured leaf bounds and ordered memberships after using double-precision child midpoints; this is one fixture, not general proof. That prototype produces 68 facets against the native 36, so dense Split parity remains open. The pinned native output and an expected-failure regression are retained under `tests/fixtures/m2-tree-depth-control-20261029/` and `tests/m2-split-dense-cutter.test.ts`. These experimental changes have not been adopted in the shared GUI/MCP operation.

A follow-up diagnostic found all dense cutter-hit endpoints already occur in the native output; the extra experimental facets came from seam materialization inserting a midpoint on every edge of an open cut. In the isolated candidate, retaining existing cut vertices for multi-edge chains while preserving a midpoint for isolated one-edge cuts matches all 36 unordered native Float32 facets, with 36 boundary edges, one connected component and no non-manifold edges in this fixture. A broader isolated run reports 335 passed, five skipped and one expected failure (rounded midpoint area distortion). The guarded peak was 464,617,472 bytes. This does not validate all branching/mixed cut components, output ordering, native topology, GUI/MCP, or production resource behavior; the candidate has not been adopted.

The midpoint change has since been applied to the M2 shared operation. The [seam validation](evidence/m2-seam-branching-gui-mcp-20261029.json) records branching and mixed-component unit controls and the current build's GUI/public-MCP dense-cutter lifecycle, including matching geometry, undo/redo, cancellation and reopening. The rendered control shows the mesh but does not make the seam visible. Dense output has 36 facets in both applications but still differs in triangulation; its native comparison remains an expected failure, and M2 is not closed.

The isolated native-order candidate also passes the [dense GUI/public-MCP lifecycle](evidence/m2-native-order-dense-browser-20261029.json): GUI unordered Float32 facets match the native export, and public MCP matches GUI, including history, cancellation and reopen checks. The same native assertion fails on the seam-only build, as expected. The candidate passes a source-only typecheck, but remains isolated while its point identity, memory admission, broader geometry and native behavior are assessed.

A rotated and translated version of the dense control was imported into QuickSurface, split with Envelope unchecked, and exported as 36 facets. Both the current shared Split operation and the isolated native-order candidate with a conservative topology fallback preserve finite positive-area faces and source area on this input, but produce 38 facets and do not match the native export. Two output points differ by one Float32 step and create two small extra facets; the remaining triangulation also differs. The pinned files and expected-failure comparison are in `tests/fixtures/m2-native-rotated-dense-20261029/` and `tests/m2-rotated-dense.test.ts`. The candidate without fallback rejected this control as non-manifold; the fallback remains experimental. Native viewport capture was blank, so this records exported geometry rather than rendered appearance. GUI/MCP and general native equivalence for the rotated control remain unverified.

The [intersection trace](../tests/m2-rotated-contact-trace.test.ts) locates a 2.1554e-8 mm segment where cutter face 73 crosses source face 1. One endpoint is on the shared source edge and is also returned for source face 0; the other matches the adjacent cutter face 70. Thus the application's two nearby vertices arise in contact collection before triangulation, rather than solely in the cavity insertion. QuickSurface's export has one corresponding vertex, but this observation alone does not prove which native tolerance or rule removes the other; welding them globally could erase real small features. The guarded contact and rotated controls passed two tests with one expected native mismatch, peaking at 352,542,720 bytes and cleaning up.

A [rotated GUI/public-MCP replay](evidence/m2-rotated-dense-gui-mcp-20261029.json) on the retained seam-change build verified matching 38-facet output, Undo/Redo, binary reopen and held-result cancellation. Native output remains 36 facets. The replay's axis-aligned normal error metric is inapplicable to this rotated fixture, and rendered seam appearance and GUI file-open remain unverified. The guarded run peaked at 918,712,320 bytes and cleaned up.

QuickSurface 8.0.123 imported the pinned `source-triangle.stl` and `cutter-below.stl` in millimetres, edited the one-facet source, selected the two-facet cutter, previewed Split with Envelope unchecked, and applied it. Its object tree reported two source facets; the exported binary STL is pinned as `tests/fixtures/m2-split-point-radius/native-below-20261029.stl` and checked in `tests/m2-native-point-radius.test.ts`. Those two triangles have total area `0.5 - x/2`, where `x` is the imported Float32 cutter coordinate, versus source area 0.5 square mm. The current shared operation's direct result contains five facets and its unordered Float32 comparison is an expected failure. The earlier GUI/MCP radius replay with nine total facets used an older build and is not a current-build comparison. Native viewport capture remains white, and the at/above controls were not run; one sample cannot establish the native threshold rule. The focused guard peaked at 322,949,120 bytes and cleaned up.

A [newer seam-change GUI/public-MCP replay](evidence/m2-native-point-radius-below-20261029.json) confirms both application paths produce the same five-facet result with area 0.5 square mm, including Undo/Redo, binary reopen and cancellation checks. This validates application parity for the fixture while confirming the two-facet native geometry and area differ. The earlier nine-facet result was from the older build. The guarded replay peaked at 921,788,416 bytes and cleaned up; native rendered appearance and the at/above controls remain open.

The [below-threshold contact trace](../tests/m2-native-point-radius.test.ts) identifies the application's two boundary contacts `(x, 0, 0)` and `(x, 1-x, 0)` and their shared interior cutter-diagonal point `(x, 0.5, 0)`. The native export contains the interior point and neither boundary contact. The latter nominal contact lies about 0.0001273 mm from the nearest source corner, above the statically inferred 0.0001 mm search radius. This rules out a simple global Euclidean corner-merge rule applied to those nominal contacts as a complete explanation; native intermediate contacts and the actual mechanism are not observed. The guarded trace passed two tests with one expected native mismatch, peaked at 343,023,616 bytes and cleaned up.

The [at-radius native Split](evidence/m2-native-point-radius-at-20261029.json) used the same source and the pinned `cutter-at.stl` in millimetres, with Envelope unchecked. QuickSurface exported two facets with the same corner arrangement as the below-radius control, retaining the cutter-diagonal crossing and omitting both nominal boundary crossings. The source tree reported two facets; its viewport remained white. The native output is pinned as `tests/fixtures/m2-split-point-radius/native-at-20261029.stl`. The newer retained application build produced five facets on each of the below, at and above controls; GUI/public MCP geometry, undo/redo, cancellation and binary reopen matched within each case. The guarded three-case replay peaked at 925,003,776 bytes and cleaned up. Focused native comparisons report three passed and two expected mismatches; above-radius native output and exact native intermediate arithmetic remain unknown.

An independent point-containment control in `tests/m2-native-point-radius.test.ts` checks `(x/4, 0.75, 0)` for the below-radius input. That point lies in the original source and in the current shared Split result but outside both facets of the native export. This confirms a concrete uncovered region in this finite native case; it does not establish native behavior on other scales or cases. The guarded batch passed four controls with two expected native mismatches, peaked at 341,364,736 bytes and cleaned up.

The above-radius native Split used the same pinned source and `cutter-above.stl` in millimetres, with Envelope unchecked. QuickSurface's object tree and binary STL export again show two facets, in the same arrangement as the below and at controls; the input cutter's Float32 x-coordinate is approximately 0.00011 mm. The export is pinned as `tests/fixtures/m2-split-point-radius/native-above-20261029.stl` (SHA-256 `225f62796f16f8e249b15df46c16c07f32473cc17fad5e8753c742a389914313`). This finite triplet shows no observed output-topology change around the statically inferred 0.0001 mm candidate radius; native intermediate values and the operative threshold remain unknown. The above-radius native comparison is added to the focused test and awaits a free validation lane.

Two additional [prepared controls](../tests/fixtures/m2-split-wide-radius-20261029/manifest.json) place the same cutter at approximately 0.0009 and 0.0011 mm, bracketing a separate 0.001 constant observed in the native call chain. Their input files are pinned; neither native output nor an operative tolerance is inferred from the constant. The shared-operation checks in `tests/m2-native-wide-radius-control.test.ts` and the new above-radius native comparison were prepared but have not run because the shared validation lane is occupied by another task's guarded build.

The previously queued focused batch has since completed: seven checks passed, including both wider controls, with three expected native facet mismatches on the first triplet. The wider controls retained their inputs, finite positively wound facets and source area through the shared operation. The guarded job peaked at 347,037,696 bytes and cleaned up. Their native output and GUI/MCP lifecycle are still unobserved.

Two [wider native Split controls](evidence/m2-native-wide-radius-20261029.json) used the same source and pinned cutters, millimetre imports, Envelope unchecked, preview and apply. QuickSurface returned four facets and two individual components at x≈0.0009 mm, and five facets and two components at x≈0.0011 mm. Its viewport remained white; exported binary STL provides the geometry evidence. At 0.0009 the native result omits the near-origin contact; at 0.0011 it retains that point but uses a different diagonal from ScanForge. The exact transition and its cause are unknown. The retained seam build's GUI and public MCP results match each other for each control, with history, cancellation and binary reopen checks; they each have five facets. Both native facet comparisons fail as expected. The guarded two-control browser replay peaked at 917,155,840 bytes; the focused unit batch passed seven checks with five expected native mismatches, peaked at 350,433,280 bytes, and both jobs cleaned up.

An [isolated native-order follow-up](evidence/m2-native-wide-radius-snap-experiment-20261029.json) matches the 0.0011 mm native export's unordered Float32 facets but still produces five facets against native's four at 0.0009 mm. A diagnostic postprocessing experiment snapped each output corner within 0.001 mm of an original source corner and dropped zero-area triangles. It matched both wider exports but left three facets versus the native two on each smaller-radius control. This falsifies that postprocessing rule as a complete explanation for the five controls; it does not reveal native intermediate calculations or justify applying a snap to the shared operation. Both guarded jobs cleaned up; neither changed GUI or MCP behavior.

A deliberately [fitted offline hypothesis](evidence/m2-native-radius-fitted-hypothesis-20261029.json) adds removal of planar triangles smaller than 0.0001 square mm to the prior 0.001 mm corner-snap experiment. It matches all five existing unordered Float32 native facet sets, but those thresholds were chosen after seeing the examples; this is not independent evidence or a production change. A new pinned source scaled tenfold with the cutter x unchanged is prepared to distinguish this absolute-area hypothesis from scale-dependent behavior. Its shared Split control preserves finite positive-area faces, source and cutter identity, and area 50 square mm; native output is not yet observed. The guarded hypothesis and scale-control jobs cleaned up and peaked at 338,554,880 and 321,576,960 bytes respectively.

The [scaled control's pre-native prediction](evidence/m2-scaled-radius-pre-native-20261029.json) is three facets under that fitted hypothesis. The retained seam build instead produces five facets, with matching GUI/public-MCP geometry, Undo/Redo, cancellation and binary reopen; its output area is 50 square mm. The guarded browser run peaked at 920,711,168 bytes and cleaned up. A separate QuickSurface window was opened for native comparison, but activation failed twice, so no native operation or export was performed. The older retained build does not prove current-source or native parity.

An [isolated rotated-candidate diagnostic](evidence/m2-rotated-candidate-coverage-20261029.json) compared Float32-rounded area and exact-coordinate edge incidence with the pinned native export. Both have four boundary edges and no edges incident to more than two triangles; projected pairwise overlap is zero for native and approximately 1.18e-23 square mm for the candidate, a value that may be numerical clipping noise. The candidate still has 38 facets against native's 36, and its smallest facet is approximately 1.54e-7 square mm. These measurements do not establish general coverage or native parity. The guarded job peaked at 339,976,192 bytes and cleaned up.

An [oracle-directed rotated-point experiment](evidence/m2-rotated-oracle-snap-diagnostic-20261029.json) found that all 21 distinct native Float32 vertices appear in the candidate, which has one additional vertex one Float32 step away from a native point. Replacing that candidate point with the native point and dropping duplicate-corner facets reduces its count to 36, but only 32 unordered facets match the native output. This uses knowledge of the native result and is not a validated merge rule; the original short input segment is nonzero. The guarded job peaked at 347,213,824 bytes and cleaned up.

The [remaining rotated facets](evidence/m2-rotated-facet-boundary-diagnostic-20261029.json) have the same six exact-coordinate boundary edges after that oracle-directed replacement: four unmatched triangles on each side use different interior diagonals. This localizes the residual discrepancy but does not validate the replacement or establish native triangulation rules. The guarded diagnostic peaked at 357,257,216 bytes and cleaned up.

An [instrumented candidate trace](evidence/m2-rotated-branch-trace-20261029.json) shows the experimental point-order path triggers its directed-edge safety fallback on the second source face, which contains the remaining post-oracle facet differences. The first face does not trigger it. This identifies an application path to investigate; removing the safety check is not justified. The trace ran in a separate copy, peaked at 338,685,952 bytes and cleaned up.

The [connected-cavity experiment](evidence/m2-connected-cavity-experiment-20261029.json) traced the first duplicate directed edges to point insertion 10, where the selected incircle triangles share only a vertex. Restricting the candidate cavity to the edge-connected component around the containing triangle avoided neither all invalidity nor the need for safeguards: assembly rejected an interior boundary edge. The experiment is rejected and remains isolated. Its guarded run peaked at 344,240,128 bytes and cleaned up.

The [cavity edge-recovery experiment](evidence/m2-cavity-edge-recovery-experiment-20261029.json) identifies an exactly collinear insertion on an interior edge as the source of that rejected experiment's missing edge. Splitting every detected edge avoids the rotated fallback but regresses four previously matching native controls. A narrower isolated recovery for an interior point whose cavity would leave a zero-orientation boundary avoids that fallback while retaining those controls. Its focused batch has 168 passes, one expected failure, and the pre-existing wider-radius native mismatch; the rotated 36-facet match still requires an oracle-directed vertex replacement. The candidate is not integrated, and memory, broader geometry, GUI/MCP and native gates remain open. Its guarded batch peaked at 390,340,608 bytes and cleaned up.

The [projected-point trace](evidence/m2-cavity-projection-trace-20261029.json) shows that, in the experimental reconstructed frame, the near-coincident rotated points share one projected coordinate but differ by approximately 9.58e-9 in the other. They are not exactly equal in this candidate projection. The trace does not reveal native point identity or justify a merge rule. Its guarded run peaked at 338,210,816 bytes and cleaned up.

A [static caller slice](evidence/m2-native-point-search-caller-slice-20261029.json) independently decodes the candidate's point-search call and the branch that stores a non-null returned value or constructs and inserts a Float32-coordinate record when the search returns null. This supports the decompiled reuse interpretation, but does not establish tree membership or reachability for the rotated fixture, nor a global merge tolerance. The guarded decoder peaked at 66,334,720 bytes and cleaned up.

An [offline nearest-point check](evidence/m2-rotated-nearest-point-hypothesis-20261029.json) uses the native export as an oracle: both precise endpoints of the short rotated contact are within the statically inferred conditional radius of the same native output vertex, and the first rounds to that vertex. This is consistent with point reuse if that vertex was already in the searched tree, but native membership and insertion order remain unobserved; it does not justify a general weld. The guarded diagnostic peaked at 322,945,024 bytes and cleaned up.

The [isolated collector-order diagnostic](evidence/m2-rotated-collected-order-20261029.json) places the native-matching point before the nearby extra point in the application's experimental face/hit traversal. This makes first-seen point reuse testable, but native traversal and tree contents remain unobserved. The guarded diagnostic peaked at 336,732,160 bytes and cleaned up.

A [first-seen radius model](evidence/m2-point-reuse-model-diagnostic-20261029.json) matches the rotated and wider-above native vertex sets, but retains one or two extra vertices in each of the other four pinned controls. It is therefore not a complete explanation and has not been applied. This compares vertex sets only, not facets or native runtime behavior. The guarded diagnostic peaked at 342,532,096 bytes and cleaned up.

An [offline 0.001 mm variant](evidence/m2-wide-point-reuse-hypothesis-20261029.json) matches all six existing native vertex sets, but the radius was chosen after those observations and has not been established as the native search rule. Before a native scaled run, it predicts the three source corners plus the cutter midpoint as the four output vertices; the smaller-radius model predicts six. These are vertex predictions only, not facet or coverage claims. The guarded jobs peaked at 342,659,072 bytes and cleaned up; no application change was made.

The same [offline model on four broader controls](evidence/m2-point-reuse-broader-controls-20261029.json) matches the convex, concave, cyclic and dense native output vertex sets. These previously known fixtures have well-separated points and do not independently establish the threshold or facet equivalence. The guarded job peaked at 348,323,840 bytes and cleaned up.

A [bounded 0.001 constant scan](evidence/m2-native-001-constant-references-20261029.json) found a second Split-related candidate caller passing that constant to the same kernel and later comparing it with a value returned by an indirect call. This is evidence of a separate comparison, not proof that 0.001 is a point-search radius or that the candidate path handles the scaled fixture. The guarded decoder peaked at 89,067,520 bytes and cleaned up.

The shared [source and seam coverage checks](evidence/m2-source-seam-coverage-20261029.json) now reject a reproduced material face-coverage loss before publication, including through GUI and public MCP while preserving source, cutter and history. They allow a relative 1e-9 projected-area drift in precise assembly before the exact-coverage fallback; this is not a general exact-shape guarantee. The focused batch reports 161 passed and one expected native mismatch, all 14 typecheck batches pass, and a precise PLY-3 control preserves inputs and area. PLY-1's test expects two parts while both this candidate and its unchanged baseline produce 30; that acceptance remains open. The verified Split files are present in the 5173 preview; wider M2 and native gates remain open.

The [PLY-1 component investigation](evidence/m2-ply1-component-assumption-20261029.json) supersedes that test-assumption failure: PLY-1 has 27 source groups under Split's indexed-edge rule, while the topology analyzer counts 31 components because it excludes four zero-area faces from adjacency. The corrected generic test checks each output part's cutter sidedness and both sides; it passes PLY-1 with 30 parts. It retains the two-part assertion for the pinned PLY-3, which also passes. Baseline and candidate PLY-1 geometry receipts match. This does not establish native equivalence or a PLY-1 GUI/MCP lifecycle.

The first subsequent full suite exposed a Float32 seam regression, so the [seam tolerance correction](evidence/m2-seam-tolerance-correction-20261029.json) supersedes the original midpoint threshold: precise output allows 1e-9 relative area-vector drift and the internal Float32 helper allows 1e-3. The real-face control and material-loss regressions pass in the focused batch, and the revised build passes GUI/public-MCP normal-cut and failure-rollback checks. The corrected full suite reports 50,546 passed, 10 expected native mismatches and 76 skipped, with a 1,412,759,552-byte peak and clean guarded cleanup. These allowances are not exact coverage guarantees, and the expected failures and M2 native gates remain open.
