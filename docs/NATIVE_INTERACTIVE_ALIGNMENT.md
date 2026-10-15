# Interactive alignment control extraction

The original Interactive command is resource `0x8338`, named **Move scan data**.
Its command handler is `0x140805c30`; availability is updated by `0x140805d30`.
It resolves the `MUM_ALIGN_MESH` mode and opens or reactivates its dialog. This
is distinct from the reference-based Align Mesh command at `0x81fe`.

REA recovered the dialog, mode and factory RTTI, message map, constructor,
initialization, data exchange, four manual step callbacks, view alignment,
accept/cancel, matrix application and mouse-move controller. The retained
[evidence](evidence/interactive-alignment-native-controls.json) includes 26
procedure records, their Evidence IDs and pseudocode hashes. The mapped source
image SHA-256 is
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
No activation or licensing behavior is implemented by this work.

## Controls and recovered defaults

The original `Align Interactive` dialog template is resource `0x14a`.

| Control                | Resource ID | Callback      |
| ---------------------- | ----------: | ------------- |
| As Current View        |        1133 | `0x140549cf0` |
| Positive rotation      |        1032 | `0x140549f00` |
| Negative rotation      |        1035 | `0x14054a030` |
| Positive translation   |        1033 | `0x14054a170` |
| Negative translation   |        1034 | `0x14054a430` |
| Show mirrored mesh     |        1039 | `0x14054a700` |
| Mirror plane selection |        1123 | `0x14054a750` |
| Drag strength slider   |        1124 | `0x14054aa20` |
| Accept                 |           1 | `0x140548a90` |
| Cancel                 |           2 | `0x140548d60` |

Constructor instructions initialize rotation and translation steps to Float32
one and the mirror toggle to zero. Initialization populates X/Y/Z rotation
axes, X/Y/Z translation directions and OXY/OYZ/OXZ mirror planes. It selects
Z rotation, X translation and OYZ mirroring, sets drag strength to 100, and sets
the slider range to 0-100. These defaults are static instruction observations;
the initialization callback has not been replayed as an installed GUI.

The original data-exchange callback ran with three different populated dialog
records. All 42 ordered dispatches agree with the retained field bindings, and
all dialog bytes remain unchanged under the controlled exchange recorders.
Rotation and translation occupy offsets `0xdc8` and `0xdcc`; both pass numeric
helper arguments 4 and 6. Those argument values do not establish parsing,
formatting or input-range semantics. The template also exposes an active-mesh
count, so the workflow must account for multiple selected targets.

## Executed step callbacks

All four complete original callbacks were executed with their original rotation
helpers and system UCRT sine/cosine imports. UI methods are controlled adapters.
The unit converter is a Float32 adapter with declared scales 1, 25.4 and 0.001;
this does not verify the original application unit-conversion service. The
geometry-application boundary records the generated matrix instead of changing
targets. The original step arithmetic is not replaced.

The capture contains 640 cases across signed inputs, zero, tiny angles around
the Z threshold, all three axes, two unsupported axis values and the three
translation unit adapters. Every callback emits exactly one apply request with
flag one and leaves its dialog record unchanged.

Rotation reads the Float32 step, takes its absolute value, applies button sign,
and converts degrees using double `0.017453292519943295`. X and Y always invoke
their helpers. Z leaves the matrix unchanged below absolute `1e-5` radians.
Translation applies sign to the absolute Float32 step, calls the unit adapter,
and widens its Float32 result before building the translation matrix. Unsupported
axis selections still submit identity matrices; public argument validation
should distinguish that internal control state from accepted user axis names.

The independent decoded test adapter matches 634 captured matrices byte for
byte. Six 45-degree cases differ by one ULP in double sine coefficients between
JavaScript and the retained UCRT outputs. Every coefficient in all 640 cases
matches after Float32 conversion. The regression preserves original double bytes
and checks both the one-ULP bound and exact Float32 bits. It does not replace
native expected values with JavaScript output. This bound is specific to these
cases and does not prove arbitrary-angle or repeated-transform behavior.

## Integration boundary

This checkpoint adds native evidence and regression tests, with no application
behavior or MCP schema changes. It does not enable the Interactive ribbon entry
or advertise a new agent operation. GUI/MCP session integration must retain the
native control behavior while separately validating:

- Manipulator picking, 15 handle modes, drag sensitivity and movement thresholds.
- Current-view transform construction and mirrored preview.
- Multi-target pose composition, mesh/cloud/CAD publication and target ownership.
- Preview updates, cancel restoration, accepted history and Undo/Redo.
- Same-input native geometry results, including repeated rotations.

The extracted mouse-move controller scales Float32 movement by drag strength
divided by 100 and checks transform determinant magnitude within 0.001 of one
before applying. These observations are not yet runtime verification of dragging.
The four step-button capture does not execute the complete geometry application
routine. It therefore cannot certify complete Interactive alignment parity.

For implementation, the extracted apply routine stores an accumulated double
pose in each mesh model during interaction; Accept later bakes that pose and
resets it. The application currently stores world-space mesh positions, so
rebuilding those buffers on every pointer event would introduce work absent
from that native path. A proposed integration is an immutable geometry buffer
with a temporary viewport matrix during the session, then one bounded CPU
publication at Accept. GUI and MCP must inspect and manipulate the same preview
pose, including cancellation and multi-target state. This is implementation
guidance from the static trace, not a completed or runtime-verified workflow.

## Validation

Build `scanforge-4fd227083888fd39` passed with no warnings or errors. The focused
contract file passed 642 tests. The complete suite with the supplied STL, PLY
and ASC examples enabled passed 28,899 tests across 367 files with no skips.
Scoped formatting, JSON identity/readback, whitespace and prohibited-name
checks passed. Native mappings and analysis helpers were released. This
evidence-only checkpoint changes no GUI behavior or MCP capability, so a new
GUI/MCP browser replay is not applicable. Port 5173 retains the current app.

## Recovered drag and current-view numerical kernels

The internal Interactive math module reconstructs the complete original `0x140aa75a0` update. A compact gzip fixture retains all 28,380,624 original capture bytes: 46,368 inputs across three frames, three original poses, three camera orientations, plane/axis translation, signed rotations, generic scale handles and rejected modes. All return values and both Double output matrices match byte for byte; 36,288 inputs are accepted. The manifest pins the original image, raw and compressed SHA-256 identities. Scale branches are a generic manipulator contract, not evidence that Interactive alignment exposes scaling handles.

Expanded native inputs exposed two errors in the first reconstruction: rotation must begin with an identity delta rather than the old pivot translation, and projected-axis/cross-product sign selects the angular direction. The Ghidra pseudocode omitted that SSE sign branch. Original assembly and runtime outputs determine the implemented behavior.

The complete original As Current View callback `0x140549cf0` supplied 104 matrix/event captures. Its view-point input is rounded to Float32 before composing the negative-anchor translation. The renderer getters and bound-setting procedure identify that point as the view bounds midpoint, distinct from a camera eye. Camera pan remains part of the returned view frame. The numerical composition is verified; an end-to-end application camera adapter is still pending.

Additional direct native probes executed 51 standard-view mode/frame combinations in `0x1408a9740` and 34 base-frame/reset combinations through `0x1408a9ac0` plus its original virtual mode method. The retained `interactive-reset-view-native.json` preserves the latter original outputs, including signed zero and Double matrix bits. Static assembly evidence for the mode method is `ev_0801ac48f8b94a09faed41913c41b6a099ad40843eb4560ad837f964a34dea8f`.

The ordinary As Current View reset uses mode 2 and returns identity. The alternate up-axis path uses mode 4 and retains off-diagonal magnitude `4.371139000186241e-8`: its right-angle rotation constant is a Float32-rounded angle promoted to Double. The implementation composes the original base, rigid inversions and corrected rotation instead of replacing the result with identity. Both paths match all 96 output bytes. These probes use private renderer storage and the original numerical callees; they do not execute a native window, complete viewport publication or geometry Apply/Accept.

The exported rotation helper shares the already-verified Fine Align arithmetic; its operation order is unchanged. The new module is internal and not registered as a user command or an MCP math tool. It does not enable Interactive alignment. Full GUI/MCP preview ownership, native handle eligibility, immutable GPU pose updates, one-time Accept publication, mirrored display and Cancel/Undo behavior still require integration and verification.

## Mesh pose-controller fast path

A further 72 direct executions of original `0x1405490c0` cover zero, one and two mesh targets; drag and step refresh flags; identity, translation and two rotation deltas; and three existing stored poses. Static trace evidence is `ev_5bc4fef47e867bad0cd57e5f4c1e16e8ea5be0741051d985410bd639a9183366`. The retained [controller capture](evidence/interactive-pose-controller-native.json) records every stored pose, pivot, dirty flag and adapter call.

The complete mesh-only controller executes original matrix/pivot arithmetic with controlled interface resolution, world-bounds getters and redraw callbacks. All captured stored poses match the application's existing shared `composeCloudPose(delta, previous)` byte for byte. Drag mode makes zero bounds-getter calls. Step mode makes 36 across the captured target combinations, one per target per call. No local-bounds rebuild callback is reached, and the separate sentinel payload is preserved. These observations verify the controller's branch and pose contract; the bounds values are adapters, not native bounds computed from real scan geometry. CAD branches, Accept geometry baking, rendering and history remain outside this probe.

### Kernel checkpoint validation

`npm run build` passed with no warnings/errors and retained application fingerprint `scanforge-704dc834947a5bb2`; the unused internal kernel adds no active UI behavior. Focused kernel/control/refinement validation passed 922 tests. The complete suite with `SCANFORGE_ALIGNMENT_EXAMPLES` set to the supplied folder passed 29,011 tests across 370 files, with no skips. The command allowed one retry while retaining the existing test timeouts; no failing or retrying cases were reported. The full official-SDK/browser smoke passed against this same application build, including GUI/MCP axis parity, viewport picks and history. A source-derived bundled check additionally matches all 72 native pose-controller cases. Scoped formatting, UTF-8, JSON readback and compressed-fixture digests passed. Native probe mappings, disposable browsers and bridge processes exited; port 5173 remains available for the owner. Interactive itself remains gated until the complete shared session is integrated.

## Immutable pose sessions and native world bounds

The internal session now retains original geometry and per-target Double poses throughout preview. Each accepted delta composes with the target's previous stored pose in the native order; Apply transforms original buffers once. A precision regression uses two 3 mm steps at X=100,000,000 mm: one final Float32 store yields 100,000,008, while intermediate stores would lose both changes. Cancelled and no-op publication do not create model history. The display helper changes only object matrices, preserving geometry, normals, buffers and picking indices. These helpers are preparatory integration code; the Interactive ribbon entry remains gated.

REA traced original world-bounds entry `0x140b30100` to identity kernel `0x140b2dbe0` and transformed kernel `0x140b2d870`. It scans vertices rather than transforming local-box corners. Eight ordered logical ranges skip vertices whose flags contain bits `0x9`. Strict comparisons retain the first equal vertex within each range; non-strict reduction retains the later equal range, including signed zero. The application preserves these rules with at most two physical workers and copies each source buffer once per worker cache. Idle workers expire after 60 seconds; explicit session close permanently cancels pending queries and forbids fallback publication. Serial fallback uses the same reducer. The source cache is bounded to 512 MiB and worker requests to 30 seconds.

The [kernel capture](../tests/fixtures/interactive-world-bounds-native.json) contains 99 direct original executions, including masked points and signed zero. Transformed-kernel REA evidence is `ev_805b343c2e83c7c32568a0a3f91f90eacb3f1d95396c185ce18bf8df9fa62ecb`; identity-kernel evidence is `ev_2a83e6751706a8a655b9c4918e8d8d6d7d58f085a2843be3934894e9a8c9ec04`. Native scheduling is replaced by a controlled sequential adapter; these captures verify the original partition, kernels and reduction, not the original scheduler.

A second [capture](../tests/fixtures/interactive-owner-bounds-native.json) executes those original kernels against every source-order vertex/point from all three owner PLY files and all three ASC files, at identity, translation and rotation poses. All 18 bounds outputs match the application's production-compiled browser worker byte for byte. [Browser evidence](evidence/interactive-bounds-browser-native.json) records two physical workers, all 99 kernel cases, all 18 full-source cases, cache reuse and zero live workers after cleanup. The six sources contain 6,762,910 points total. Warm full-source pose queries measured about 1-29 ms in this run; these are bounds-query timings, not end-to-end registration or complete Interactive UI timings. Source-file and coordinate-buffer SHA-256 values bind the comparisons. The standalone browser regression imports the supplied PLY/ASC files through the application importers and checks both file and coordinate-buffer hashes. It compiles the worker directly with Vite, so this test does not depend on the unfinished GUI entry. Run `SCANFORGE_ALIGNMENT_EXAMPLES` against the owner folder with `node tests/interactive-bounds-browser.mjs` while the development server is running. Native file import and the full native window are outside this probe.

## Drag movement controller

REA evidence `ev_18a912ddf327d034befa01efb711d79c550c9324c643755d47edfd548961292d` and assembly `ev_db0f572119e83e1a1109b223daaaa109a72bf7800f9ecf42bcdb3035ba913470` recover original `0x14020fc50`. Its squared length and square root are Float32, but reciprocal and products are Double before Float32 stores. An initially rounded reciprocal disagreed in 88 of 262 direct native cases; preserving the assembly arithmetic matches every byte. This is distinct from the screen-direction normalizer used by the already-verified manipulator kernel.

The [movement capture](../tests/fixtures/interactive-movement-controller-native.json) executes the complete original `0x14069e220` with controlled pixel-to-plane conversion, view getters and no-op UI callbacks. It covers 864 cases and 648 manipulator submissions across six handle IDs, four strength settings, three view frames, three pixel scales and threshold transitions. Both signed-integer pixel differences must remain within seven to retain the initial waiting state; exceeding seven on either axis begins the drag. Translation uses the Float32 plane difference transformed by the Double view transpose. Rotation handles normalize it first. Strength is converted and divided by 100 in Float32, then multiplied in Double before Float32 stores. All captured movement bytes and waiting flags match. Actual renderer projection and GUI pointer routing remain separate integration work; controlled projection is not evidence of full camera parity.

### Pose/bounds checkpoint validation

The build passed with zero warnings/errors (`scanforge-037516f0b3fba0c8`). The focused foundation suite passed 1,924 tests across seven files. The configured full suite, with the owner scan folder enabled and `.resources` excluded, passed 30,297 tests across 377 files with no skips. The standalone production-compiled worker replay passed all 99 kernel and 18 full-source cases, with two physical workers, source-cache reuse and zero live workers after cleanup. Scoped formatting, fixture parsing, source-token audit and diff checks passed. No public Interactive GUI/MCP entry is enabled by this internal checkpoint; renderer projection, gizmo routing and complete shared-session publication remain integration work.

## Viewport camera adapter checkpoint

The shared viewport now has an imperative Interactive preview sink and native drag-input adapter. Canvas and `viewport_pick` continue to use the same display objects. Preview changes only matrices and conservative clipping bounds; it leaves geometry, source buffers and picking indices intact. Cancel restores the exact original matrices and cached scene bounds. Rebuilding a rotated cloud's bounds from transformed box corners would enlarge them, so cancellation explicitly restores the cached box instead. Tests exercise the real viewport methods and agent picker against the same preview.

Original renderer pixel conversion `0x140832bc0` matches 150 captured cases, including integer wraparound, offset/empty viewports and both coordinate modes. Original `0x1408332c0` matches 192 cases: affine projection subtracts the stored view anchor and applies the raw Double frame; its alternate path uses GLU screen projection, stores XY through Float32, and retains affine Double depth. The probe binds GL matrix/viewport getters to controlled values and uses the system GLU32 numerical function. It does not capture a live OpenGL window. Renderer `0x1408a8e20` confirms the flag selects the orthographic versus GLU perspective path. The adapter reads the application's current camera matrices instead of assuming a fixed view orientation. Seventeen actual Three camera/drag cases compare its output with retained native projection results and threshold behavior.

The complete native frame-publication/fit chain (`0x140832930`, `0x140832680`, `0x140832980`, `0x1408458c0`, `0x1408a96b0`, `0x1408a9500`) matches all 24 direct executions, including invalid/point bounds and prior clipping preservation. It clears frame Z translation, fits the projected box with native 15% padding, stores bounds through the original mixed Float32/Double arithmetic, and updates clipping only above its threshold. The scene bounding-box producer is controlled in this probe. Original `0x1408a6e40` aspect correction matches all 80 additional cases. It averages the required XY aspect correction and retains the previous depth bounds; using conventional maximum-side fitting would differ. All fitted bounds, centers, frames and clipping bits are checked against original outputs.

The [trace index](evidence/interactive-camera-native-trace.json) binds procedure Evidence IDs and target hashes. Runtime captures are retained in the pixel-plane, world-projection, view-fit and aspect-adjustment test fixtures. These adapters are internal. Complete gizmo pointer routing, mirrored display, dialog admission, GUI/MCP discovery and end-to-end session publication still require integration before enabling the ribbon command.

### Camera/viewport validation

The updated build passed with zero warnings/errors (`scanforge-318a2c6da4af8764`). Focused validation passed 2,261 checks across 14 files, including preparatory host/session checks. The repository default suite passed 30,735 tests; 31 optional owner-data tests in seven files were skipped. Those unchanged owner registration algorithms passed with the supplied folder enabled in the preceding pose/bounds checkpoint and were not rerun in this camera/display slice.

A separate [actual GPU viewport replay](evidence/interactive-camera-viewport-browser.json) imported the two owner PLY scans, rendered 2,972,031 triangles, and applied 60 immutable pose previews. Median update plus synchronous GPU rendering was about 0.6 ms on the recorded device. Both orthographic and perspective contexts produced accepted native drag inputs. Source buffers and geometries remained attached, nine ray comparisons preserved hits/facet IDs/coordinates, idle hover made zero redraw calls, and cancellation restored the exact original matrices and cached scene bounds. The disposable browser and workers exited; port 5173 remains available. This is internal adapter/display verification, not completion of the full Interactive GUI/MCP workflow.

## Buffered viewport gizmo bridge

The viewport now owns a lazy display-only gizmo with the recovered translation IDs 1–6 and rotation IDs 10–12. The three axis arrows, three plane pads, and three rotation rings use world axes at the Float32 pivot. Perspective and orthographic scaling keep the controls approximately 85 pixels in radius. Display dimensions, hit-overlap precedence, and native pixel-identical rendering remain unverified; these graphics do not establish native drawing parity.

Pointer input goes through an injected asynchronous shared-operation callback. Only one command is submitted at a time; pending pointer moves coalesce to the latest position. Rejected subthreshold moves retain their original anchor, while accepted moves become the next incremental origin. Gesture cancellation prevents obsolete responses from changing the next gesture's anchor. Modified drags remain available for camera navigation. The external pose store publishes stable snapshots without workbench state updates on each frame.

The [owner-scan pointer replay](evidence/interactive-gizmo-viewport-browser.json) exercised the in-progress shared Interactive operation factory with both PLY scans, 2,972,031 triangles, and a real Chrome pointer drag. A three-pixel gesture preserved version zero; a larger gesture produced 17 accepted pose publications. Preview committed no history, retained source buffers and geometry objects, and Cancel restored exact cached bounds and poses. This was an isolated source harness, not the user's browser session or proof of public MCP discovery. The native arithmetic remains covered by the retained controller, movement, step, and camera fixtures above; this replay did not execute the original window controller at those newly generated mouse coordinates.

The public Interactive ribbon command remains gated. The dialog, complete editor admission, mirror display, Current View reset wiring, public schemas/discovery, and full GUI/MCP Apply/Undo workflow still require integration and validation. The new bridge does not advertise additional supported tools.

Retained Ghidra evidence `ev_542a5d044f7b71b08532810b9bb8b68e8ece25fb96d6133f5e34b9d3e840210a` for original mouse-up callback `0x14069de00` clears the interaction flags and ends the ordinary captured gesture; it does not resubmit the drag movement processor. The viewport therefore drains its existing movement queue on release without inventing another movement event. A regression check covers this distinction. This is a static control-flow observation, not a new execution of the original GUI mouse-up callback.

### Viewport input bridge validation

The final build passed with zero warnings/errors (`scanforge-a61fb8d48fe6b0c9`). The focused run passed 1,827 tests across 15 files. The default suite passed 30,743 tests across 380 files; 31 optional owner-data checks in seven files were skipped. The new real-pointer replay used both owner PLY scans separately from those optional registration checks. The first full-suite attempt exposed non-owned cursor cleanup and incomplete synthetic-pointer admission; those were corrected and covered before the successful rerun. Formatting, staged whitespace, and forbidden-token checks passed. No public MCP descriptor or ribbon availability was added by this internal bridge checkpoint.
