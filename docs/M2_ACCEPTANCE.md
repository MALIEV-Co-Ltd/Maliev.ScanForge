# M2 repair and processing acceptance

Tracks [issue #2](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/2), starting 2026-10-25. M1 is owned by another task. M2 remains open; a passing regression suite does not establish complete native equivalence.

The [project replacement preflight](evidence/m2-project-replacement-preflight-20261107.json) asks before decoding when GUI work is unsaved. Declining now reports cancellation without starting a decoder, and public MCP refusal without `replace:true` likewise avoids decoding. GUI and MCP successful binary imports, focused tests and the production build passed. This does not reduce peak memory for confirmed restores or resolve the remaining M2 gates.

The [independent-restore release trace](evidence/m2-independent-restore-buffer-release-20261107.json) observed all four large numeric staging buffers detach after reconstruction. The GUI reported import, but the first post-reopen MCP geometry digest timed out and the run exceeded the 4 GiB guard. Detachment does not show when physical memory was reclaimed; the resource and ownership gates remain open.

The [sampled independent-restore replay](evidence/m2-independent-restore-allocation-sample-20261107.json) completed GUI reopen, geometry and history checks, but failed the 4 GiB guard by 208,896 bytes. Browser heap sampling attributed about 439 MiB of live sampled allocations to numeric transport reconstruction. Sampling changes the workload and does not establish the cause of the peak or a passing resource result.

An [array allocation probe](evidence/m2-restore-double-allocation-probe-20261107.json) reduced peak memory in a synthetic Node conversion, but an isolated browser replay combining that allocation with independent numeric arrays still exceeded 4 GiB and lost the MCP bridge before post-reopen checks. No production change was made; the observations do not establish causality or close the restore resource gate.

A [current-build independent-array diagnostic](evidence/m2-current-no-reuse-ply3-20261107.json) disabled ordinary numeric reuse in the served decoder and repeated the original PLY-3 export/download/GUI-reopen sequence. It exceeded the 4 GiB guard and lost the MCP bridge before reopened geometry or history could be verified. The temporary downloaded project was hash-verified and removed. The diagnostic is not integrated and does not establish the responsible allocation.

The [current original-scan controls](evidence/m2-current-original-split-controls-20261107.json) pass a direct single-plane shared Split on each of the three original PLY inputs, checking area, seam agreement and input preservation. The largest scan also passes a simulated processing-worker dispatcher check. These are scoped controls, not native or public-MCP acceptance.

The [worker staging cleanup record](evidence/m2-encoder-worker-staging-cleanup-20261107.json) covers a separate worker-termination leak in the shared GUI/MCP project encoder. The full suite, build, MCP smoke, real browser byte comparison, an original PLY-3 public MCP cancellation with an injected commit hold, and two full PLY-3 export, GUI reopen and history replays passed within the guarded limit. The second replay peaked at 4,209,803,264 bytes, leaving about 81 MiB. The injected cancellation does not establish a natural race or GUI Save cancellation; the native, restore ownership, resource repeatability and milestone gates remain open.

The [temporary storage cleanup change](evidence/m2-transient-cancellation-cleanup-20261107.json) handles cancellation after a staging write commits. Focused tests, a real browser cancellation control, the full suite, production build and public MCP browser smoke passed. An original PLY-3 GUI Split/Extract replay also passed public MCP cancellation at an injected storage-commit hold, with unchanged revision, artifacts and checked geometry under 4 GiB. It does not establish natural occurrence of that timing or GUI Save cancellation. Native acceptance and the restore ownership and resource gates remain open.

The [integrated result channel record](evidence/m2-result-channel-integrated-20261107.json) pins the committed optional MCP result channel and one original PLY-3 download, GUI reopen and history replay under 4 GiB. A subsequent [independent-array restore experiment](evidence/m2-no-reuse-result-channel-20261107.json) exceeded that limit and is not integrated; [renderer samples](evidence/m2-restore-renderer-profile-20261107.json) narrow investigation without identifying the allocation.

The [restore and selection memory record](evidence/m2-restore-selection-memory-20261105.json) documents a passing original PLY-3 GUI reopen and history replay under the 4 GiB guard, an earlier instrumented over-limit run, GUI/MCP selection checks, and an unresolved low-level numeric-array reuse race. These results do not close M2.

An [isolated reuse-race prototype](evidence/m2-reuse-race-probe-20261106.json) passes the low-level reproducer and 53 related tests by retaining staging bytes through final revalidation. A real browser decoder-worker diagnostic with an injected mutation fails on the integration build and passes with the prototype. A separate low-level test shows that mutation of a reused source after decoding still changes the decoded result; no normal GUI or MCP trigger has been established. A matching-input PLY-3 replay then failed: GUI reopen timed out and reported peak exceeded 4 GiB by 102,400 bytes. The prototype is not integrated, and ownership safety and resource acceptance remain open.

A second prototype replay selected the same downloaded PLY-3 project through local CDP. GUI reopen, geometry and post-reopen Undo/Redo completed, but the guard still failed: reported peak exceeded 4 GiB by 249,856 bytes. This is a different file-selection path, not native chooser acceptance, and it does not resolve the prototype's ownership limitation.

An isolated decoder with ordinary numeric reuse disabled produced independent restored arrays in a browser-worker control, but its matching PLY-3 replay failed: the first post-reopen MCP geometry query timed out and reported peak exceeded 4 GiB by 925,696 bytes. It is not integrated; see the same [restore probe record](evidence/m2-reuse-race-probe-20261106.json).

At the four PLY-3 staging sizes, a synthetic transport diagnostic retained about 439 MB more ArrayBuffer storage at the last lookup with that prototype than with the current code; this is not a real Job-peak measurement. A second fingerprint-and-reject experiment released staging promptly but took roughly 5.47 seconds in the sized Node test, versus 0.85 seconds for the baseline, and has no retry or protection after unpack returns. Neither experiment is integrated or establishes a safe resource and responsiveness tradeoff.

At the 2026-11-06 local integration audit, main `e367262f` was an ancestor of candidate `1a5779ac`. The checked-out main workspace had 492 local files overlapping the candidate's changed paths; 294 matched the candidate content and 198 differed. This is a point-in-time worktree comparison, not a merge or review of those local changes. Preserve and reconcile the local workspace before updating it.

The [integration unit suite](evidence/m2-integration-suite-20261106.json) passed at `9d8280a8`: 50,686 tests passed and 76 were skipped under the Job limit. A subsequent production build at `41679f56` passed all 15 TypeScript batches and generated bundle `scanforge-b4a30452acf5c910`. These checks do not include the isolated restore prototypes or replace the open native, GUI/public-MCP and large-project resource gates.

The [isolated interior Split record](evidence/m2-isolated-interior-native-20261105.json) pins native crossing, coplanar-edge and closed-source controls, including their saved indexed topology. The crossing control and the later [near-corner control](../tests/fixtures/m2-interior-corner-split-20261105/README.md) pass rendered GUI/public-MCP lifecycle replays. Other native differences remain open; these controls are not general Split or milestone acceptance.

The [coplanar shared-edge control](../tests/fixtures/m2-coplanar-shared-edge-native-pending-20261106/README.md) has a saved QuickSurface project and separate exports. QuickSurface produces four faces with a disconnected, nonconforming shared edge; the shared ScanForge operation produces eight faces with a conforming subdivision. Reopening the native project showed the same triangle and component counts. A browser replay imported the same STL bytes and passed GUI/public-MCP geometry and lifecycle checks. This is a recorded native difference, not parity.

## Scope boundary

M2 covers the scan-repair and processing commands listed in issue #2, including Average, Mirror and cylindrical Unroll. Boundary-to-sketch creation and its own publication, history and persistence are M2 processing outcomes; general spatial-sketch editing belongs to [M4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/4) and is not an M2 closure requirement. Re-polygonize is listed in M2; M3's already reviewed alignment and combination acceptance is a separate milestone, not a new M2 gate. Shared CAD restore, MCP, project history and resource protections are verified only as needed by M2 operations; completing all M5, M7 or M8 functionality is not required to close M2. M1 is the sole milestone dependency listed in issue #2 and has been closed.

The [main refresh record](evidence/m2-main-refresh-20261105.json) documents the
integration of main through `b25da68d`, including separate prepared-CAD and
Curvature tessellation paths and focused GUI/public-MCP checks. Native Split
differences and the other M2 closure gates remain open.
The integrated build also passed an original PLY-3 full-download and GUI
reopen/history replay under the 4 GiB limit, with narrow headroom; see the
[large-project record](evidence/m2-main-refresh-ply3-20261105.json).

On the later junction candidate, three [PLY-3 refresh attempts](evidence/m2-junction-ply3-resource-failure-20261106.json) did not meet the 4 GiB reported-peak requirement. Two completed the geometry, GUI reopen and history checks but reported peaks above the limit; the diagnostic run independently matched the downloaded file hash to the artifact stream, then timed out during GUI reopen at the limit. Its peak timeline locates the growth after file selection, before replacement confirmation. The retained file's manifest declares 18 chunks totaling 1,046,558,376 uncompressed bytes; this is file metadata, not a heap-allocation measurement. The responsible allocation is not yet identified. The resource and current-candidate GUI reopen gate therefore remains open despite the earlier main-refresh success.

A [subsequent worker-trace diagnostic](evidence/m2-ply3-preexisting-worker-trace-20261106.json) reopened the retained project after streaming a new export and reported four private decoder buffers totaling 460,474,608 bytes. The reopened objects matched the new session's core geometry digests, and peak memory was below the limit, but the later history check failed because it used an object ID from the new session against the older reopened project. The two project hashes differ, so this is not a same-session round-trip or a replacement for the failed full-download resource runs.

One later [same-session process trace](evidence/m2-ply3-same-session-process-trace-20261106.json) passed full artifact download with an independent file hash, GUI reopen and post-reopen Undo/Redo at a 4,252,835,840-byte Job peak, leaving about 40 MiB of headroom. Nearby process samples show growth in the renderer and another Chrome process without a type argument; they do not identify the responsible allocation. The earlier over-limit runs remain failures, and repeatability and the resource gate remain open.

After the inventory cache correction, one [same-session PLY-3 replay](evidence/m2-inventory-fix-ply3-reopen-20261106.json) passed full artifact streaming with a matching independent file hash, GUI reopen and post-reopen history at a 4,248,031,232-byte Job peak. Its roughly 45 MiB headroom and the earlier over-limit runs leave repeatability and general resource behavior open.

A [current-candidate repeat](evidence/m2-ply3-current-recheck-20261106.json) completed the same geometry and post-reopen history checks, but failed the guard at 4,311,937,024 bytes, 16,969,728 bytes over 4 GiB. The streamed and downloaded project hashes matched, and owned processes and the temporary download were cleaned up. This result does not identify the responsible allocation; the resource gate remains open.

An isolated [viewport trace and deferral prototype](evidence/m2-hidden-viewport-probe-20261106.json) confirmed a hidden large mesh triggers a display rebuild after redo and reopen. The prototype passed focused viewport tests, but its full-size replay failed earlier in decoding with an array allocation error and a peak over 4 GiB. It is not integrated and the two runs do not establish causality.

An isolated [string-body bridge probe](evidence/m2-bridge-string-probe-20261106.json) lowered peak memory in a synthetic request comparison but failed the real same-session replay: the project opened, a later geometry query timed out, and reported peak memory exceeded 4 GiB. The candidate was not integrated; this result does not establish a resource fix.

An isolated [byte-array bridge probe](evidence/m2-bridge-byte-body-probe-20261106.json) also lowered a synthetic peak but failed the real same-session replay: the bridge disconnected before post-reopen geometry verification, and the reported peak exceeded 4 GiB. This candidate was not integrated either.

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

A manufactured single-triangle control exposed a shared Split defect in the 2026-10-27 implementation: an open cutter intersecting only an interior segment extended the seam to the source boundary. The [failure and bounded static candidate trace](evidence/m2-split-finite-support-20261027.json) retain that historical result. A later finite-mesh implementation addresses this control; the current-branch verification below does not establish arbitrary-cutter or native parity.

## Split contact-copy precision, 2026-10-28

The shared Split path now collapses consecutive numerical copies of the same observed contact when they round to the same Float32 output, while retaining original source corners. The original `ply-1` face 7207 previously rejected; it now passes direct winding/area checks and GUI/public-MCP geometry, history, reopening and cancellation checks. Direct one-cutter runs on the three original scans retain source and cutter buffers and pass area and seam-edge-set checks under the 4 GiB guard. [Scoped evidence](evidence/m2-split-contact-copy-20261028.json) records the browser, suite and typecheck boundaries. The independent review found no concrete blocker for this incremental correction. Native and milestone gates remain open.

The [current finite-interior control](evidence/m2-finite-interior-current-control-20261029.json) passes the shared regression and a GUI/public-MCP replay, including the bounded seam, matching geometry, undo/redo, cancellation and project reopening. It is a manufactured control; native Split equivalence and general finite-cutter behavior remain open.

## Split corner association investigation, 2026-10-29

The [static worker and offline diagnostic](evidence/m2-split-worker-corner-tolerance-20261029.json) suggest separate corner-association and point-reuse tolerances. A two-stage model reproduces the vertex sets of ten previously observed native controls, but does not compare facets or establish runtime order or safe general behavior. No application behavior changed; native Split and the other M2 acceptance gates remain open.

A subsequent [facet diagnostic](evidence/m2-two-stage-facet-diagnostic-20261029.json) applies the modeled associations after triangulation in an older experimental candidate. Seven of ten retained controls match unordered native facet sets; each of the other three has one additional nonzero-area facet. The native triangle-area sums are smaller than the source sums in those three controls. This diagnostic does not establish a general removal rule or validate production, and no geometry change was applied.

A [current shared-operation comparison](evidence/m2-current-native-facet-diff-20261029.json) shows that the convex, concave and cyclic controls already have the same Float32 vertex sets and face counts as their retained native outputs. Their unordered facet multisets still differ by 6, 12 and 8 facets respectively, locating these particular mismatches in connectivity. Winding, native runtime ordering and general behavior remain unverified.

The subsequent [cavity triangulation update](evidence/m2-native-cavity-split-candidate-20261029.json) matches those three retained native facet multisets through the shared operation and GUI/public MCP, while retaining the current area guards. A PLY-3 browser Split/Extract and direct PLY-3 control also pass under the guard; earlier candidate versions passed direct PLY-1/2/3 controls. These are bounded controls, not general native equivalence; the small-radius and full-download/reopen gates remain open.

The [current-build PLY-3 replay](evidence/m2-ply3-exact-head-extract-reopen-20261029.json) completed GUI Split/Extract and public-MCP pre-save undo/redo, project export and in-place import, with matching extracted-part, source and cutter geometry after reopen. The guarded run peaked at 4,151,283,712 bytes and cleaned up. This single instrumented run does not establish a general resource guarantee, GUI undo/redo or file-open, post-reopen history, public-MCP Extract, or native Split equivalence.

Separate [GUI file-open diagnostics](evidence/m2-ply3-gui-reopen-resource-failure-20261029.json) did not complete under the 4 GiB guard. One traced run crashed after decoder startup; another selected the local file directly, started decoding and timed out with an unresponsive page. Both cleaned up and recorded peaks above the nominal job limit. The precise allocation or scheduling cause is not established; the GUI in-place reopen gate remains open.

The [follow-up attribution controls](evidence/m2-ply3-open-download-attribution-20261029.json) narrow that result: GUI opening an existing file after an export, without downloading the artifact, passed with matching core geometry under the guard. In the otherwise matched case that first read the entire exported artifact through public MCP, the decoder reported an allocation failure at its first 266 MB chunk. Two isolated allocation-reduction candidates also failed. These single-run controls do not establish a general GUI-open failure or a production fix; artifact-read followed by reopen remains an open resource gate.

Further [worker, hashing and diagnostic-collection experiments](evidence/m2-artifact-worker-memory-experiments-20261029.json) did not pass that sequence. Worker isolation alone timed out after the first chunk was read; with incremental hashing the decoder processed two chunks before a later allocation failure. Forced collection let all chunks be read and hashed, but the session did not complete. Neither diagnostic candidate is integrated, and the resource gate remains open.

An additional [reconstruction trace and isolated prototype](evidence/m2-deferred-project-reconstruction-experiment-20261029.json) located the last reported worker stage in reconstruction of large numeric arrays. The prototype passed 42 focused tests, but the normal full-download and GUI-reopen replay timed out. With diagnostic garbage collection, reopened geometry matched, while peak memory exceeded the 4 GiB limit. The prototype is not integrated and requires further validation; the resource gate remains open.

The [combined deferred reconstruction and incremental hashing experiment](evidence/m2-deferred-reconstruction-hash-experiment-20261029.json) also timed out after the full MCP download and exceeded the nominal 4 GiB limit. Its 45 focused tests passed, but no successful reopen or geometry comparison was obtained. This experiment is not integrated.

Two [process-memory profiles](evidence/m2-artifact-read-process-profile-20261029.json) localized much of the post-download growth to Chrome's renderer rather than the MCP server. Diagnostic collection reduced the browser process substantially but left the renderer well above its pre-download measurement. These are snapshots, not proof of which allocations remain or a successful reopen; the resource gate remains open.

An isolated [synthetic-response comparison](evidence/m2-artifact-synthetic-response-profile-20261029.json) showed much greater renderer growth when the same number of requests returned full-size rather than empty payloads, even without reading the artifact Blob. The synthetic responses are deliberately invalid and were not integrated. The observation narrows the large-response path but does not establish a remedy or satisfy the resource gate.

A [combined response-worker and decoder experiment](evidence/m2-response-worker-reopen-experiment-20261029.json) completed a real full artifact read and GUI reopen with matching core geometry and no forced collection. Its peak exceeded the nominal 4 GiB limit, and the downloaded hash lacks an independent reference. A response-worker-only control with the original decoder timed out and exceeded the limit. The prototype remains isolated and the resource gate remains open.

Another combined run opened the actual MCP-downloaded file, whose on-disk hash matched the incremental download hash. The decoder validated the project chunks and returned, but GUI open timed out and the nominal memory limit was exceeded. It did not verify reopened geometry or establish equality to an independent original export.

An instrumented repeat localized its last reported main-thread stage: the first numeric buffer reused an existing array, while the second buffer's reuse check started without reporting completion before timeout. This trace does not establish the exact cause of the stall or close the resource gate.

On the later shared-index candidate, one [original PLY-3 replay](evidence/m2-ply3-shared-indices-reopen-20261029.json) completed GUI Split/Extract, full public-MCP artifact download and GUI reopen with matching core geometry. Its reported Job peak was 4,259,962,880 bytes, 35,004,416 bytes below 4 GiB. A subsequent extended replay timed out before reopening and recorded a peak above the strict threshold. GUI post-reopen Undo/Redo passed on the smaller PLY-1 control but was not reached on PLY-3. Repeatability, PLY-3 post-reopen history, independent download-hash comparison and broader resource and native acceptance remain open. Earlier failed receipts remain recorded.

Further [reuse and native-base64 diagnostics](evidence/m2-response-worker-reopen-experiment-20261029.json) include one run that timed out before decoder return and one that reopened the actual downloaded project with matching geometry. The latter reused all four numeric arrays but peaked 720896 bytes above the nominal 4 GiB limit. These isolated runs do not prove the cause of the difference or satisfy resource acceptance.

Moving Blob reading into the experimental response worker passed a small public-MCP byte and offset control but failed the large download with a bridge timeout and an above-limit peak. That diagnostic was reverted; it did not reach reopen or establish a remedy.

The retained [small-radius native exports](evidence/m2-native-point-radius-triplet-20261029.json) and [wider-radius exports](evidence/m2-native-wide-radius-20261029.json) are pinned fixtures. The shared Split operation matches the wider above-radius facet multiset; below, at, above and wider below-radius facets differ. The owner chose to preserve source coverage and through-plane separation for these four cases. Their tests explicitly assert source area, cutter-plane separation and the native difference, while the existing exact coverage guard remains in place. Three native point-radius exports lose source area; the wider below-radius export includes a triangle spanning the cutter plane. This decision is scoped to those cases and does not establish general native equivalence or waive other M2 gates. Native viewport observations were white; these are exported-STL comparisons, not rendered native acceptance. On the integration build, the [radius safety replay](evidence/m2-radius-safety-decision-20261106.json) found GUI/public-MCP geometry parity and cutter-plane separation for all five inputs, with history, cancellation and binary reopen checks; all 13 focused tests passed.

The safety-decision revision passed the integration build, a full suite of 50,684 tests with 76 skips, both CAD smoke checks and the repository formatting check under bounded jobs. The four radius controls are explicit safety assertions, not exact-native parity claims. The repository browser harness subsequently gained the repeatable five-fixture plane-side checks and passed both fixture sets. The earlier unformatted evidence files and first formatting failure are retained in the validation record; broader milestone gates remain open.

The [shared-edge junction candidate](evidence/m2-shared-edge-junction-experiment-20261105.json), first tested in an isolated worktree, matches the retained shared-edge and thin-face native facets and QSF-supported indexed incidence; its GUI and public MCP checks agree on the same indexed geometry, history, reopen and cancellation. It also passed the recorded original PLY replay, full suite and newer non-manifold and through-plane guards under bounded jobs. Its separate intersection-and-junction memory estimate may reject operations before the nominal intersection limit and is not a combined heap bound. The documented radius differences remain, and other M2 acceptance, review and main-integration gates are open.

The [integration-branch replay](evidence/m2-junction-integration-20261105.json) passed the full suite with 50,680 tests, four expected radius failures and 76 skips. Both pinned native cases passed GUI/public-MCP indexed-geometry, history, reopen and cancellation checks on the integration build. The first focused run caught a stale expected-failure marker for the now-passing folded-boundary fixture; the marker was corrected and the retry passed. These are scoped branch checks, not milestone completion.

### Folded Split native topology control (2026-11-05)

QuickSurface Pro 8.0.123 split the two-triangle source with the four-triangle folded cutter in [this fixture](../tests/fixtures/m2-folded-open-native-20261105/README.md), with Envelope off. The saved native source has 11 faces and a perimeter boundary length of 8 mm; the tested cut path edges are shared. The earlier shared application operation instead produced an open seam with boundary length 13 mm and different triangulation. The prior application-only folded seam expectation does not establish native behavior. That mismatch was initially pinned as an expected failure; general folded geometry remains unverified. A component-level prototype reproduced the native boundary topology but was withheld after review identified a resource regression for unrelated large cut components. Those prototype results did not establish GUI/MCP acceptance.

The follow-up component prototype was also withheld: although the guarded Split subset passed, a one-million-vertex sparse input with a small two-edge path exceeded a 5 MB stage allowance, and a 5,000-arm subdivided branch exceeded a tight allowance that the existing seam code accepts. Regression controls now pin those resource boundaries, mixed loop and branch cases, and the previously unresolved retained-path behavior. Those earlier prototypes are not application or MCP acceptance.

The subsequent packed-degree implementation retains eligible nonseparating boundary-to-interior paths without typed scratch proportional to the source vertex count. The folded and subdivided native controls match their respective exported facet multisets and shared-edge topology. On production bundle `scanforge-45ac513066238984`, isolated browser GUI and public-MCP replays agree on indexed geometry, undo/redo, binary reopen, held-result cancellation and GUI Close cancellation for both controls; no page errors were reported. The guarded Split suite on the prior edge-sort revision passed 400 tests with six expected failures and five skips; the final revision passed the full suite with 50,648 tests, seven expected failures and 76 skips; the original PLY-3 low-level candidate check passed under the 4 GiB Job cap. A 100,000-edge mixed-loop control passed its tight typed-stage allowance; the packed-value and lookup-entry estimates remain separate and do not constitute a combined process-memory limit. The first folded replay timed out waiting for held GUI cancellation after matching native facets; the retry passed, but the cause of the timeout remains unknown. These controls do not establish general native Split parity, the remaining radius/corner cases, full-size GUI/MCP lifecycle repeatability or M2 completion.

A [subdivided near-corner control](../tests/fixtures/m2-subdivided-corner-native-20261105/README.md) confirms that QuickSurface associates the same near endpoint with the source corner when the cutter is split into two triangles. Its five-facet indexed result shares both path edges and its cutter round-trip preserves the input facet multiset. The earlier ScanForge operation retained the unsnapped endpoint and produced seven facets; the current candidate matches the retained facets. This evidence does not establish a safe general snapping rule for source-edge contacts or permit coverage loss.

A [shared-edge near-corner control](../tests/fixtures/m2-shared-edge-corner-native-20261105/README.md) exercises a contact 0.0004 mm from a shared corner. QuickSurface snaps it to the corner, retains the neighboring face, and produces four facets. The earlier ScanForge operation propagated the unsnapped contact to the neighbor and produced six facets; the current candidate matches the retained facets and tested indexed incidence. This observation does not establish a general tolerance rule or permit coverage loss.

A [thin-face control](../tests/fixtures/m2-ambiguous-corner-native-20261105/README.md) places that contact within 0.001 mm of two source corners. The native four-facet output contains both potential corner-to-interior edges, so it does not identify which corner was associated with the cut. An exploratory first-matching-corner rewrite matched those facets and several earlier fixtures, but removed an exact edge witness from the existing large-coordinate collector test; it was withdrawn. The current candidate matches the saved facets and tested indexed incidence without asserting which corner native associated.

A later [corner-association experiment](evidence/m2-corner-snap-separation-experiment-20261105.json) preserved the collector's default behavior and matched the small corner controls, but failed the original PLY-3 component-side assertion: a result crossed the cutter plane. The restored code passed the same guarded check. A reduced [plane-cut safety test](../tests/m2-split-near-vertex-plane-safety.test.ts) passes on the restored code and showed that the experiment could collapse a real cut entirely. Corner association must account for separation as well as native facet parity.

A [corner-to-boundary control](../tests/fixtures/m2-corner-boundary-native-20261105/README.md) produced two native facets with disjoint indexed vertices, and a [folded-junction control](../tests/fixtures/m2-folded-junction-native-20261105/README.md) produced five facets in one mesh. The latter was saved and reopened in QuickSurface. The current candidate matches both retained controls. A per-cutter-triangle association prototype created an extra junction between the folded cutter branches and was withdrawn; the retained connectivity test detects that regression.

A separate [folded boundary control](../tests/fixtures/m2-folded-boundary-native-20261105/README.md) produced three native facets and three individual meshes, with disjoint indices. The exported source facets and saved QSF agree, and the exported cutter retains the input facets. QuickSurface reopened the QSF and reported three source triangles and two cutter triangles; a black desktop capture prevented visual verification on reopen. A subsequent [inventory cache correction](evidence/m2-component-inventory-cache-fix-20261106.json) fixed a mismatch in which component-only MCP inventory reported three components while full MCP inventory and the GUI panel reported one. The corrected GUI panel and both MCP inventory modes report three one-triangle components; geometry, history, reopening and cancellation also passed on this fixture. The source boundary endpoint's Float32 coordinates sum slightly above one, so this is evidence for these exact inputs, not a general rule about two-piece cuts. Earlier [global-junction evidence](evidence/m2-global-junction-experiment-20261105.json) records a narrower prototype; later shared-edge evidence is scoped above. Neither establishes general native equivalence or replaces whole-milestone validation.

On the corrected build, an [original PLY-3 replay](evidence/m2-inventory-cache-large-replay-20261106.json) reported 456 components in both scoped and full MCP inventory after GUI Split. A follow-up compared sorted face-membership hashes for all 3,695,945 faces and component areas within a declared tolerance; both replays completed component Flip and Undo/Redo under the Job limit. These are application comparisons, not native output or a substitute for the separate full-download resource gate.

The checked-in browser regression exercises scoped and full MCP inventory followed by the GUI component panel on the folded-boundary fixture. A historical coplanar midpoint assertion failed on the current result. Direct comparison locates the change at `c3620bf3`: the older midpoint opened a seam with duplicated indexed edges, whereas the current interval is shared. The test now verifies current indexed incidence as well as the cut endpoints; the full default browser suite passes. The [browser regression record](evidence/m2-browser-inventory-regression-20261106.json) retains the earlier failure; a later [native control](../tests/fixtures/m2-coplanar-shared-edge-native-pending-20261106/README.md) records a distinct nonconforming native result for the imported Float32 inputs.

The browser folded-cutter assertion now checks the retained native 11-facet export and shared seam rather than the earlier application-only open seam. A preceding diagnostic run excluded the coplanar case; the later full default suite includes it. [Evidence](evidence/m2-browser-inventory-regression-20261106.json).
