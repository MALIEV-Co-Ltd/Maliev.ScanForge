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
