Final continuation recheck: build passed with zero warnings/errors (offline manifest scanforge-988ed468f9cfd043); focused checks passed 37/37 and full suite passed 267/267 after the document-reset guard correction. Targeted Prettier and diff whitespace checks passed. The retained browser screenshot predates the final inspector-header wording change; fresh browser inventory attempts timed out, so no fresh render claim is made. Codex preview opening returned queued. The existing loopback preview returned HTTP 200 and retains its finite lease.

# Initial workbench validation — 2026-10-11

Scan-section sketch workflow - 2026-10-11

Build passed with zero warnings/errors and28 offline assets. Focused section/geometry/project/dialog/reference-renderer checks passed37/37; the full suite passed267 tests across46 files. Checks cover all coordinate planes, slicing versus projected frame placement, original-slot selected/hidden filtering, empty/stale selection rejection, nonintersection errors, frozen reference persistence in both project paths, saved sketch identities/active selection validation, empty editable geometry, actual processing-worker response ownership, and release of actual/projected reference line geometry/materials. A65000-segment SVG reference test passes without argument-spread overflow or creating editable curves.

Browser: the loaded1452-triangle demonstration scan produces128 actual section segments at Z10. Preview leaves model history at0. Selected-only extraction with no selection fails and disables Create; Cancel preserves history0. Creating a sketch projected onto the reference plane yields offset0, one reference path and zero editable lines. A second sketch retains slice placement at Z20; switching between sketches restores independent geometry and offsets. Four explicitly authored points and a closed four-line profile on the second sketch extrude to exact CAD with bounds20x10x5mm and volume1000mm3, adding exactly one modeling-history entry. Switching afterward confirms the first sketch still has zero editable points and the second retains four. Browser warning/error logs are empty; project download completion is visible, but downloaded-file readback was not completed. Both serializer/parser paths are covered automatically. Proof is retained privately at .resources/scan-section-sketch-proof.png.

The finite native probe exited0 and PID66704 is absent. The prior preview server shut down at its scheduled expiry; the replacement runs in a bounded terminal session with PID42980, loopback port5173 and expiry2026-10-11T18:30:06.996Z. Original algorithm equivalence, interactive drawing, picked primitive planes, stacked/revolved/outline modes, full gigabyte scans and physical SpaceMouse are not validated by this slice.

Sketch world placement - 2026-10-11

Build passed with zero warnings/errors,28 offline assets and manifest scanforge-be82accd6946d0c2. Focused sketch/frame/client/parametric/project tests passed49/49; the full suite passed258 tests across43 files. The actual CAD worker smoke suite passed: legacy XY extrusion, offset OXY/OYZ/OXZ, in-plane rotation and tilted-normal placement, expected world bounds and volumes, STEP export/re-import placement, invalid-frame rejection with unchanged shape ownership, complete native-handle release and virtual-file cleanup. Targeted formatting and git diff --check passed.

Browser: changing the saved draft to OYZ offset21 leaves modeling history at0. Extrusion creates one history entry and exact body bounds20x40x30mm, volume24000mm3. Editing its parametric recipe to OXZ offset-5 and height12 rebuilds to bounds30x12x40mm, volume14400mm3 and a second history entry. Undo restores the first bounds and volume; redo restores the rebuilt operation. Project download completion is visible, but automated download-path retrieval timed out; downloaded-file readback was not completed. Persistence is covered by both project serializer/parser paths in automated tests. Browser error/warning logs were empty. A bounded screenshot of the verified plane controls is retained privately at .resources/sketch-plane-proof.png; a larger screenshot timed out. Full scan-to-sketch/native-UI parity, gigabyte scans and physical SpaceMouse were not tested by this slice.

This validates the implemented 0.1 foundation, not the unimplemented capabilities listed in CAPABILITIES.md.

## Executed automated checks

| Check                                                  | Result                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `npm run build`                                        | Passed: strict TypeScript and production Vite build; zero warnings and errors |
| `npm test`                                             | Passed: 17 tests across 3 files                                               |
| `node --max-old-space-size=768 tests/kernel-smoke.mjs` | Passed: actual WebAssembly CAD exchange and modeling                          |
| `npm run format:check`                                 | Passed                                                                        |
| `npm audit --audit-level=high`                         | Passed: zero reported vulnerabilities after upgrading the test runner         |
| `git diff --check`                                     | Passed                                                                        |

The build was once refused at 1,515 MiB available RAM by the unchanged 1,536 MiB guard. It was rerun successfully when capacity returned. Other tasks were preserved. The machine's default npm shim encountered a broken global dependency; the successful npm commands used the existing Node installation's bundled `npm-cli.js` directly. No global npm repair was performed.

Geometry tests cover analytical fitting, degenerate inputs, transforms, triangle sections, closed-volume translation invariance and mesh cleanup. File tests cover STL/OBJ parsing, point-cloud rejection, project validation and exact-BREP persistence. Client tests cover serial request admission, timeouts, cancellation and worker disposal. Native smoke covers primitives, STEP/IGES/BREP roundtrips, boolean volumes, arbitrary XYZ transforms, concave polygon extrusion, invalid input, native-shape release and temporary-file cleanup.

## Browser checks

Executed through the Codex in-app browser against the compiled static build on a task-owned loopback server:

- Initial Three.js rendering, object selection and viewport fit.
- Picked point-to-point measurement: 43.425 mm on the synthetic bracket.
- Z=10 mm section: 128 segments with 152 mm total length; CSV download succeeded.
- Plane fit, displayed residuals, reference creation and undo. The undo selection regression was fixed and rechecked: the remaining scan became selected and its inspector stayed usable.
- Exact box creation: 30×30×30 mm, 27,000 mm³. STEP download succeeded.
- Project save/reopen restored the box as exact CAD; STEP export succeeded again.
- Polygon extrusion: 40×30×10 mm, 12,000 mm³.
- Box minus extrusion: 18,000 mm³. Original inputs were retained and hidden.
- Exact scale by two plus translation: 60×60×40 mm, 144,000 mm³. STEP export succeeded.
- Production offline reload succeeded under emulated network disconnection, followed by creation of a 27,000 mm³ exact CAD box from locally cached worker/WASM assets.
- No warning/error console entries observed in the checked workbench flows.
- Desktop at 1536×1024; mobile at 390×844. Mobile inspector controls were changed to one column and STL/delete actions made reachable. DOM inspection found no horizontally overflowing controls.

Offline testing covered an activated production cache. Browser update semantics can leave a new build waiting while an older tab remains open; close all old tabs to activate the next installed cache. Storage eviction and device quota remain browser-dependent.

## Design fidelity ledger

The independent full-screen concept was `exec-efaad86b-05c6-4e1e-a6ca-6d175a2c01d4.png`. The concept and desktop capture were both inspected using `view_image`. Captures are retained locally under ignored `.resources/screenshots/`; no raster screenshot is shipped as UI.

| Comparison            | Implemented evidence / intentional deviation                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout                | Preserved header, horizontal tool strip, left explorer, light central canvas, right inspector and bottom status bar                                  |
| Palette               | Graphite navy chrome, teal selection/accent, pale gray CAD viewport; no photographic overlay                                                         |
| Typography            | Compact explicit system-font controls and a larger two-part product wordmark                                                                         |
| Component anatomy     | Thin panel separators, restrained corners, labeled numeric/vector fields, shading controls and opacity slider                                        |
| 3D scene              | Real WebGL bracket, engineering grid, camera-oriented XYZ triad. Smooth synthetic geometry intentionally replaces the concept's imaginary rough scan |
| Copy and data         | Primary action/tool labels retained. Invented concept statistics replaced by measured values; source object named “Demonstration bracket”            |
| Functional extensions | Exact modeling/sketch panels, real validation/error states and export constraints added because the workflows require them                           |
| Responsive layout     | Tool wrapping and stacked canvas/inspector below 760 px; one-column inspector below 520 px                                                           |

The shell was verified against the design direction; exact screenshot parity is not claimed. The concept's imaginary mesh texture, nested reference folders, three-axis scale fields and fake fitting statistics are intentional deviations. The implemented UI uses actual geometry/data and uniform scaling. Freeform reconstruction and certified metrology were not tested because they are not implemented.

## Remaining release boundaries

Authored source publication is in scope. Hosted website deployment and bundled binary publication are deferred pending the kernel provenance work recorded in CAD_DISTRIBUTION.md. No proprietary implementation/assets or captured sample meshes are included. No runtime CDN or geometry-upload API is used.

# Ribbon and large-scan revision — 2026-10-11

This revision follows owner-supplied ribbon and scan-editing images and video. It is independently authored. Full functional reconstruction remains incomplete; disabled commands identify missing operations.

## Automated validation

- `npm run build`: strict TypeScript and Vite production build passed with zero warnings and errors; unchanged 1,536 MiB admission guard passed.
- `npm test`: 48 tests passed across nine files. New coverage includes typed/chunked imports, worker transfer/cancellation/cleanup, malformed input, cone fitting and reconstruction placement, scan alignment, theme persistence, triangle selection/partition and ribbon availability.
- `npm run test:cad`: actual OpenCascade WebAssembly smoke passed, including oriented cones/frusta and full/partial revolution, analytic volumes, STEP roundtrips and native handle/file cleanup.

## Browser validation

Compiled static build checked in Chrome:

- Uniform light/dark/system appearance and persistence, desktop viewport, and mobile override at 390 by 844. Mobile document client/scroll widths both measured 375 CSS pixels (scrollbar gutter excluded), with no horizontal document overflow. Ribbon strips scroll independently.
- Top workflow tabs and grouped commands, Objects above History, floating scan-edit options. Unsupported commands stay disabled with explicit tooltips.
- Spherical brush selected 47 triangles on the synthetic bracket; copy created a 47-triangle mesh and labeled history entry. History rollback restored the original 1,452-triangle model.
- Cut all 1,452 triangles created a replacement mesh. Deleting every triangle exposed an empty-model state initialization defect; it was fixed. Rechecking deletion and undo restored a usable 1,452-triangle model. No new console warnings/errors after the corrected bundle loaded.
- Earlier in this same revision, a generated 200,000,084-byte binary STL with 4,000,000 triangles loaded and rendered. Bounds 2,000 by 1,000 by 0 mm and area 2,000,000 square mm matched the fixture; undo restored the prior model. This validates that fixture/device, not unbounded browser memory.
- Exact cone and profile-revolution creation, STEP download and project save/reopen were verified during this revision. The kernel smoke independently validates the exact CAD results.

Screenshots are retained in ignored `.resources/screenshots/scanforge-ribbon-dark.png`, `scanforge-ribbon-light.png`, `scanforge-ribbon-mobile.png`, and `scanforge-200mb-import.jpg`. The layout intentionally uses new vector icons and web controls. Mobile stacks contextual options below the viewport rather than covering it.

## Reverse engineering and remaining limits

See FEATURE_EVIDENCE.md for actual REA evidence IDs, native overview/procedure/string inventories and unverified feature handlers. A focused native decompilation exceeded its memory budget and was stopped. All owned analysis processes exited and the original binary hash remained unchanged. One private analysis folder was retained after automatic approval review rejected its cleanup with a generic policy block; this is recorded in the local resource ledger.

No proprietary screenshots, extracted assets, recovered source or private analysis tools are committed. The implementation status at this earlier revision is superseded by the reconstruction slice below. Large text formats/project loads still require whole-file parsing. Brush selection scans triangle centroids on the main thread and may be slow on very large meshes. History stores twenty session snapshots and is not a parametric feature DAG.

## Reconstruction and input slice — 2026-10-11

Executed sequentially with the unchanged resource admission guard:

- `npm run build`: passed strict TypeScript and production Vite build, zero warnings/errors; offline manifest contains 25 local assets including both new workers.
- `npm test`: 105 tests passed across 17 files. New coverage includes rational manufactured surfaces and fitting, sketch constraint convergence/conflicts/DOF, topology repair and segmentation, rigid/ICP synthetic transforms, actual processing-worker messages, worker cancellation/leases/allocation failures, authoring project roundtrips, HID reports/races/disconnect and camera navigation.
- `npm run test:cad`: passed actual OpenCascade WASM checks for exact rational NURBS faces, lofts, straight/bent sweeps, fillet/chamfer, offset, sewing, shell/thickening, analytic volumes, STEP roundtrips, invalid inputs and handle/virtual-file cleanup. The pinned kernel lacks Array2 bindings; authored rational STEP face encoding/import preserves the control grid and requires clamped boundary knots. A nonplanar weighted patch evaluates at `(0.5,0.5)` to `[6,14,3.2]` before and after STEP exchange.
- `npm run format:check`: passed for all matched files. The committed source was searched for private installation paths and the reference product name; none were found in authored source, tests or documentation.

Browser checks in an isolated Chrome tab:

- Created a 4 by 4 NURBS control grid, changed Z to 15 mm and weight to 2, created an exact CAD face, then fitted its projected heights asynchronously. Reported 564 samples, RMS 0.02694 mm and maximum 0.2117 mm. The edited authoring grid remained available.
- Analyzed the synthetic bracket (718 welded vertices, 1,452 triangles, one nonmanifold edge); repair preserved the diagnostic. Automatic normal segmentation created 17 individually selectable meshes and Undo restored the original object set.
- Changed the rectangle dimension from 40 to 50 mm, solved to zero local DOF and extruded a 50 by 30 by 20 mm exact body with displayed volume 30,000 cubic mm.
- Applied a known 2 mm landmark translation and refined against a matching body using ICP. Landmark RMS was approximately 3.6e-16 mm; ICP converged with 30 pairs and approximately 9.8e-9 mm RMS. This is a manufactured local-alignment test, not evidence of global scan registration.
- Created a 20 by 20 by 30 mm loft (displayed volume 12,000 cubic mm), applied a fillet (volume reduced), and swept a 6 by 6 mm profile through 40 mm (volume 1,440 cubic mm).
- Inspected SpaceMouse settings; adjusted sensitivity/dominant-axis controls and switched to Light. No new warning/error console entries were captured. Synthetic HID tests pass; no physical SpaceMouse was connected or verified.
- Worker operations lock scene mutation and expose an accessible Cancel button. The final source also guards viewport selection while processing and avoids long per-object segmentation history labels.
- Rechecked the final build after deleting its sole object: a NURBS grid can be created in an empty project. Its worker fit used 4,000 samples, reported zero projected RMS/max error, committed an undoable result and restored enabled controls without console errors.

Screenshot: ignored `.resources/screenshots/scanforge-reconstruction-light.png`. Project save reached the application's download status, but the browser automation transport timed out waiting for the download event; new authoring save/reopen is verified by both serialization-path unit roundtrips, not claimed as a completed browser download/reopen check. No new gigabyte browser render or full-topology stress run was admitted in this slice.

At that revision, full professional functionality remained incomplete. The continuation below adds curved/tangent sketches, two-patch joins and coarse global initialization. General closed-body automatic surfacing, persistent patch networks, multi-scan pose graphs, arbitrary nonmanifold repair and dependency-driven parametric rebuild remain absent. REA evidence does not recover original application handlers or algorithms. See CAPABILITIES.md and FEATURE_EVIDENCE.md for the precise boundaries.

## Workflow continuation — 2026-10-11

- `npm run build`: strict TypeScript/Vite production build passed with zero warnings/errors; unchanged 1,536 MiB admission. Offline manifest contains 25 local assets.
- `npm test`: 132 tests passed in 18 files. New coverage includes circular/radius/tangent constraints, exact rational C0/C1 boundaries and knot insertion, global registration, supported/unclassified analytic regions with full residual checks, sampled over-1GB imports/source metadata and combined synthetic SpaceMouse-to-camera lifecycle.
- `npm run test:cad`: actual OpenCascade WASM smoke passed for existing operations plus linear/circular compound patterns, arbitrary-plane mirrors and atomic inside/outside solid splits. Analytic bounds/volumes, STEP roundtrips, injected second-result failure rollback, native handles and virtual-file cleanup are covered.
- Current production parser read a real 1,100,000,084-byte binary STL containing 22,000,000 triangles at full resolution in Node: 792,000,000 position bytes, maximum read 819,200 bytes, approximately 2.865 seconds, observed RSS 885,690,368 bytes. Whole-file buffering was prohibited. Earlier attempts were refused by the unchanged 2,560 MiB parser memory guard; execution occurred only after free capacity rose.
- The same real on-disk source was imported and rendered in Chrome through **explicit bounded preview**, reading/validating every triangle and importing 250,000 uniformly sampled triangles (9 MB position buffer). UI source counts and the sample-only editing/export warning were verified. The sample has incomplete bounds/area compared with the source by design. Undo/redo restored scene history. Screenshot retained locally as `.resources/screenshots/gigabyte-preview-browser.png`.
- Full-resolution browser rendering of the 22-million-triangle source was **not run**: available memory stayed below the unchanged 6,144 MiB guard. Full topology processing of that source was not stress-tested. A bounded preview is not full-resolution validation or a guarantee of unlimited device memory.
- Browser circular preset solved its constraints and extruded to polygonal CAD: 20 × 20 × 20 mm, displayed volume 6,251.334 mm³. Chord tolerance was 0.1 mm; this is an approximation to the analytic circle.
- Browser imported a reference patch, applied C1 joining (active boundary X=30 mm, resulting bounds 70 × 100 × 10 mm), and converted the joined patch into an exact CAD face. Knot insertion and crease preparation preserved 100 × 100 mm planar geometry; interior multiplicity reached degree.
- Browser global registration of matching sampled planar geometry completed with 24 coarse candidates, 3,400 final pairs and RMS approximately 3.146e-15 mm. Analytic segmentation produced a selectable region labeled plane. Arbitrary rotated/reordered asymmetric clouds and ambiguity/failure behavior are additionally covered by unit tests.
- Browser exact CAD continuation created a 20 × 20 × 30 mm loft, a three-copy linear compound with bounds 80 × 20 × 30 mm and volume 36,000 mm³, and an arbitrary-plane mirrored body. Splitting the compound by the original loft produced inside/outside volumes 12,000/24,000 mm³. Original source/cutter visibility and atomic history updates were verified. Screenshot: `.resources/screenshots/scanforge-cad-continuation.png`.
- Chrome reports a secure context and WebHID availability, with no authorized devices. Windows inventory reported a KMJ emulator only. Combined synthetic tests prove report routing, camera movement/buttons, stale expiry and cleanup; no physical SpaceMouse claim is made.
- Project save reached the UI download status, but this automation session did not obtain a download event or saved file. Authoring/source-metadata roundtrips are covered by both serialization-path unit tests; a browser download/reopen of the new authoring data remains unverified.

REA portable resource evidence was refreshed; native handler/solver recovery remains unresolved. The new mathematical and kernel workflows are independently authored. No general automatic closed-body reconstruction, dependent feature DAG, certified segmentation, multi-scan pose graph or arbitrary manifold repair is claimed.

## Closed reconstruction, rebuild and repair — 2026-10-11

- `npm run build`: strict TypeScript and Vite build passed with zero warnings/errors; 25 offline assets. Final suite: 157 tests in 20 files. Actual OpenCascade smoke passed, including six-patch closed solid construction, volume 6,000 mm³, STEP roundtrip, open-shell rejection and transient native-handle rollback.
- Manufactured tests cover missing/duplicate/gapped patch shells, orientation and touching-vertex manifold checks; nonmanifold sheet/fan separation, outward orientation, eligible caps and crossing/overlapping-boundary rejection; dependency invalidation, output slots, rollback/cancellation, handle ownership and both project serialization paths.
- Browser six-patch shell: 3,072 triangles, one closed component, zero boundary/nonmanifold edges or vertices, volume 500,000 mm³. Exact solid: 100 × 100 × 50 mm. A three-copy dependent pattern had volume 1,500,000 mm³. Editing source patch depth to 75 mm rebuilt both features; pattern volume became 2,250,000 mm³. Undo/Redo restored both results. A collection-remount bug found in this workflow was fixed and rechecked.
- Browser nonmanifold junction: three triangles, one nonmanifold edge and two nonmanifold vertices. Repair created three separate persistent sheets, retained the hidden source and supported Undo. The first sheet had zero nonmanifold edges/vertices and one open boundary loop. Automated tests verify all outputs.
- Browser opened an independently generated project using real BREP and the production serializer. Its restored primitive and dependent pattern rebuilt after changing source width from 10 to 20 mm; pattern bounds became 80 × 20 × 30 mm and volume 36,000 mm³. The UI save download event still timed out, so this is a fixture reopen check, not a verified browser save-download-reopen roundtrip.
- Fresh real binary STL: 1,100,000,084 bytes, 22,000,000 triangles. Full-resolution production parsing in Node passed with 792,000,000 position bytes, maximum read 819,200 bytes, 1.345 seconds and observed RSS 868,605,952 bytes. Whole-file buffering was prohibited. Chrome bounded preview read/validated the same source and rendered 250,000 sampled triangles, with source counts and sample-only warning verified. Full-resolution browser rendering was not run because capacity remained below the unchanged 6,144 MiB guard; gigabyte topology processing remains untested.
- SpaceMouse synthetic HID/camera coverage passed. Chrome reported secure context and WebHID with no authorized devices; Windows exposed only the KMJ emulator. Physical hardware navigation remains unverified.

Local screenshots: `.resources/screenshots/parametric-reopen-browser.png` and `.resources/screenshots/gigabyte-closed-workflows.png`. Disposable scan fixtures and exited helpers are cleaned; the requested loopback preview has a finite recorded lease. REA recovered one numeric wrapper's ownership behavior only, as recorded in FEATURE_EVIDENCE.md. General automatic closed-scan reconstruction, persistent topology naming, arbitrary self-intersection repair and complete application equivalence remain unresolved.

## CAD gray, connected selection and DXF — 2026-10-11

Newly imported/created parts, including the demonstration, segmented and split outputs, use the shared neutral CAD-gray default. Neutral hemisphere/fill lighting removes the previous blue cast. Existing saved colors remain unchanged. Dark interface shades remain monochrome.

- Strict TypeScript/Vite production build passed without warnings/errors; 25 offline assets. Unit suite: 164 tests in 22 files. New manufactured tests cover coplanar region growth, reversed winding, creases, vertex-only contacts, ambiguous edges, mask validation and cancellation. Worker contract tests verify seed cloning, result-buffer transfer and worker disposal. DXF tests validate units, world endpoints, unique handles, actual section intersections and invalid/zero-length geometry.
- Browser gray material value was `#a6a6a6`. A 33-triangle brush seed grew to 200 triangles at a 5-degree local threshold. Copy created a 200-triangle object, and Undo restored the original scene. Result geometry remains unchanged by selection growth.
- Browser cross section reported 128 segments and 152 mm length. DXF control completed the application export path. The browser download event timed out, so a browser-saved file or third-party CAD import is not claimed. Generated DXF content is verified by automated tests. It represents tessellated LINE entities, not fitted analytic curves.

No native CAD kernel contract changed in this slice; kernel smoke is not rerun locally. General reconstruction, persistent topology naming, arbitrary intersection repair, screen lasso and arbitrary sketch-plane features remain unresolved. Full-size gigabyte rendering and physical SpaceMouse evidence retain their previously documented limits.

## Mouse and screen selection — 2026-10-11

- Strict TypeScript/Vite production build passed without warnings/errors; 25 offline assets. Unit suite: 170 tests in 24 files. New tests cover navigation modifiers, subtraction, visible versus occluded layers, preserved triangle order/winding, reversed rectangles, ellipse/frustum inclusion and invalid geometry/regions.
- Chrome left brush drag selected 11 triangles without changing view orientation. Ctrl-wheel changed brush radius from 24 to approximately 39.569 pixels. The same rectangle selected 453 visible triangles and 991 with Select through; Alt-drag subtracted them. An ellipse selected 825 triangles. A 5-degree wand click selected a 100-triangle connected region.
- Right-click opened the viewport action menu and its clear action removed selection. Middle-drag changed orientation; Ctrl-middle shifted the part with axis endpoints stable within 0.001 pixels; Shift-middle reduced its displayed size. No captured warning/error console entries occurred during these checks.
- Source geometry is preserved; the BVH uses indirect triangle indices. Selection-cache disposal accompanies geometry/object/viewport disposal. Visible mode checks only selected-mesh self-occlusion at triangle centroids. Edge-only inclusion and other-object occlusion are not implemented. Acceleration construction and screen scans remain synchronous and are not validated on the full gigabyte source.

Screenshot retained locally as `.resources/screenshots/mouse-selection-workflows.png`. No native kernel contract changed; the kernel smoke was not rerun in this slice. No new gigabyte import or physical SpaceMouse check was performed. Their existing limits remain unchanged. INPUT_INTERACTION.md lists unfinished selection/navigation operations and the unrecovered original handler boundary.

## Context menus and preview freshness — 2026-10-11

The user's existing in-app tab still displayed an earlier build (world-space brush radius and right-drag navigation), with an imported scan and unsaved changes. It was preserved without reloading. A separate current in-app preview was opened. This explains absence of the new viewport menu in the observed old tab; cache or hot-reload failure was not independently established.

Context menus now cover the viewport, object rows and model history. Actions reuse existing selection, visibility, deletion, dependency validation and revision handlers. A shared body portal prevents panel clipping; measured bounds clamp menu placement to the window. Menus focus enabled actions, support Arrow/Home/End, restore focus, and dismiss on Escape, outside pointer input, Tab, resize or an action. Mutation actions are disabled while processing. Exact original menu equivalence remains unverified.

- Production build passed strict TypeScript/Vite with zero warnings/errors; 25 offline assets.
- Unit suite: 172 tests in 25 files, including placement and enabled-action keyboard traversal.
- In-app browser: right-click opened object, history and viewport menus. Hide produced a history step; Restore returned the visible original; viewport Select All then Copy created a 1,452-triangle second object and one undo step. Undo restored the single object. ArrowDown focus, Escape and outside-click dismissal passed. No captured warning/error console entries.
- Screenshot: ignored `.resources/screenshots/context-menu-in-app.png`. Existing unsaved scan tab remains intact. No native kernel contract changed and its smoke was not rerun.

## Selection state and display history — 2026-10-11

REA 6.4.0 re-inspected the retained native bundle (three records; existing overview/search evidence IDs recorded in INPUT_INTERACTION.md). Installed reference manual pages 27 and 219, plus localization shortcut entries, establish hide/isolate/reveal, mesh-child named regions, double-click restoration and selection undo. No original selection handler, saved format or opacity-history behavior was recovered. Display/history separation follows the user's explicit instruction.

- Final strict TypeScript/Vite build passed with zero warnings/errors and 25 offline assets. Unit suite: 200 tests in 27 files. Coverage includes gesture grouping, no-op/redo branching, hide/isolate/reveal snapshots, cloned masks, hidden/non-occluding faces, all-hidden meshes, display-history separation, and 22 storage cases across both serializers and parsing. Older projects remain compatible; malformed names, IDs and sparse indices are rejected.
- In-app browser: all 1,452 triangles selected/saved/hidden; Undo selection restored both mask and visibility, Redo rehid them, Show hidden revealed them. A 5-degree wand selected 100 triangles; isolation hid 1,352. Select All while isolated selected only the visible 100. Named double-click/Restore and saved-context Restore/Delete worked. Save-selection menu opened authoring controls. Every newly added viewport menu action (hide, isolate, reveal, undo, redo, save) was executed through the menu.
- Opacity moved to 0.2 with zero model undo steps. Copy created one modeling step; model Undo retained opacity 0.2. Ctrl+Z restored selection after Clear; Ctrl+Shift+Z cleared again. Saved-name deletion and selection visibility changes produced zero model steps.
- Actual browser Save downloaded a project; readback contained opacity 0.2 and a named selection. Browser reopening restored the named child and its 1,452 slots. A second actual saved project retained 1,352 hidden slots after reopening. Saved test projects remain user-visible downloads; session selection undo is intentionally transient.
- Final visible preview: 100 selected, 1,352 hidden, saved child and zero model steps; no captured browser warning/error logs. Screenshot: `.resources/screenshots/selection-state-menu.png`. Existing user project tabs were preserved. A stale test preview after server restart was explicitly refreshed before final menu validation.

One build attempt was refused at 1,368 MiB by the unchanged 1,536 MiB memory guard; later builds were admitted after capacity rose. The previous preview expired and exited before its replacement started; an earlier duplicate launch was refused by strict port binding and exited. The replacement is loopback-only with a two-hour lease. Native CAD smoke was not rerun because no kernel contract changed. No new gigabyte topology or physical SpaceMouse run occurred. Complete original context-menu parity remains unverified; INPUT_INTERACTION.md lists unresolved operations and export semantics.

## Auto-hidden project header — 2026-10-11

Removed the SF mark and moved the project header into a floating ribbon slot. The pointer trigger occupies only the six-pixel top edge of the blank space after Help; tabs retain their own row. Keyboard focus also reveals the controls.

Validation: `npm run build` passed with zero warnings/errors and 25 offline assets; `npm test` passed 200 tests in 27 files; Prettier and `git diff --check` passed. Browser checks verified hidden initial state, no reveal over Help, reveal over the top edge after Help, retention over the actions, dismissal when leaving, keyboard access to Open scan and dismissal after focusing a tab. The mark is absent from the DOM. Screenshots remain in ignored local evidence. The isolated test tab was closed; existing user tabs and unsaved projects were preserved. The existing loopback preview process was re-observed and retained within its finite lease.

## New document and colored command icons — 2026-10-11

Main → File now offers New. Clean documents reset immediately; unsaved documents show an in-app Cancel/Save project/Discard dialog. Accepted reset releases the old CAD worker and selection buffers, clears entities and both history stacks, replaces the sketch draft and resets project-local measurement/fitting state while retaining appearance and device preferences. Edit scan and Plane use generated transparent local images; cylinder/cone/sphere/box use colored vector illustrations. Disabled icons are muted.

Validation: `npm run build` passed with zero warnings/errors, `npm test` passed 201 tests in 27 files. The new availability regression checks empty-document and busy states. Browser inspection verified both images loaded at 34px. Cancel preserved the renamed project and its object; Discard produced zero objects, zero history steps, unchanged state and disabled selection-dependent commands. The Save-from-dialog download and clean-New repeat were attempted but not verified because the browser session reset during the action; follow-up must check download completion and parsed project contents. No result is claimed for those two checks. Existing save/serialization tests passed in the suite. Screenshot: ignored local `new-document-colored-icons.png`.

The final visual test tab closed successfully. Two earlier interrupted task-created Chrome test tabs (196953957 and 196953962) could not be released through supported APIs because of a modal/focus timeout and an unattached debugger; cleanup failure is retained in the private resource ledger. They contain only synthetic test projects. User tabs were preserved. The existing loopback dev server remains within its recorded lease.

## Camera dragging correction — 2026-10-11

Removed unconditional left-camera disabling outside mesh edit and added an explicit Navigate control. `npm run build` passed with zero warnings/errors; `npm test` passed 202 tests across 27 files. Regression coverage verifies mode-dependent button routing and modifier zoom precedence. Browser CDP mouse input changed the rendered world-axis projections for left and middle orbit, including middle orbit in scan editing. Ctrl-middle pan moved the rendered model; Shift-middle zoom changed its rendered size, with essentially unchanged axis orientation aside from residual damping. Rectangle selection produced 688 triangles without camera orbit; Navigate restored left orbit. All tested camera/selection actions left model history at zero steps. Screenshot evidence remains ignored and the disposable camera test tab closed successfully. The existing preview PID/start/executable/loopback listener was re-observed within its finite lease. No original input handler was recovered or runtime parity claimed.

## Complete ribbon artwork - 2026-10-11

Replaced the entire ribbon icon renderer with independently authored local SVG artwork for all 122 unique command IDs (142 placements across ten tabs). Generic line-icon fallback is removed. Command-specific geometry differentiates view directions, Boolean operations, mesh processing, surface operations, export formats and edge treatments. Unimplemented tools remain disabled. The icon registry consumes command IDs without changing action dispatch or availability contracts.

Validation: `npm run build` passed with zero warnings/errors and 28 offline assets; `npm test` passed 205 tests across 28 files; `npm run format:check` and `git diff --check` passed. New tests render every command, check complete inventory coverage, reject fallback and distinguish geometric operations. Browser inspection visited all ten tabs and found one custom icon per button and zero Lucide ribbon icons. Main/dark and CAD/light screenshots were visually checked, disabled controls remained disabled, and captured browser warning/error logs were empty. Evidence: ignored `.resources/ribbon-icons-main.png` and `.resources/ribbon-icons-cad-light.png`. The isolated browser tab closed and the original dark preference was restored. Existing preview server was retained within its finite lease. Native CAD smoke and large-file/device workflows were not rerun because this slice changes only ribbon artwork.

## Ribbon overflow indicators - 2026-10-11

Hidden the native horizontal ribbon scrollbar while preserving the scrollable tool panel. Edge fades and accessible previous/more buttons appear only where offscreen tools remain. Buttons scroll by a viewport-relative amount; keyboard arrows, Home and End work on the focused panel, and reduced-motion preferences avoid animation. ResizeObserver updates hints when layout changes and disconnects on tab changes/unmount; changing categories resets the panel position. Tool dispatch and availability are unchanged.

Validation: `npm run build` passed with zero warnings/errors; `npm test` passed 208 tests across 29 files, including overflow/resize/fractional-edge regressions. Prettier and `git diff --check` passed. Browser checks at 1840px verified a hidden scrollbar and forward hint, then the back hint at the end. At 1000px, a page scroll exposed both directions midway and keyboard End reached the last tools. Help showed no hints; switching to Main reset scrolling; restoring the 2560px viewport removed all hints. Console warning/error capture was empty. Screenshot: ignored `.resources/ribbon-overflow.png`. Temporary viewport override was reset and the disposable test tab closed. The existing loopback preview was re-observed and retained within its recorded lease. CAD/device/large-file workflows were not rerun for this UI-only change.

## Continuous screen brush - 2026-10-11

Used the reverse-engineer-anything skill and REA portable retained-bundle inspection, corroborated with the installed manual PDF page 26 (digest rechecked). The retained native records do not recover a paint handler. The user identified fast-drag gaps, and source inspection established isolated circular stamps throttled to 80ms with no connecting path. This slice implements continuous buffered/coalesced paths, brush footprint/triangle contact, a fractionally inward visibility probe and pointer capture. Original algorithm equivalence remains unverified; details and remaining selection differences are in INPUT_INTERACTION.md.

Validation: final `npm run build` passed with zero warnings/errors and 28 offline assets. Focused selection checks passed 14 tests; the full suite passed 212 tests across 30 files. Prettier and `git diff --check` passed. New tests cover sparse and curved strokes, edge-only contacts, twenty intervening triangles, through depth, hidden slots and unchanged source geometry. Browser CDP testing selected 69 triangles using either endpoint-only or dense input. One selection Undo returned to zero and Redo restored 69. Alt endpoint stroke subtracted to zero. Through mode selected 138 across both layers. Release over the explorer selected 43; one Undo returned to zero. Model history remained at zero steps. Captured console warning/error logs were empty. Final screenshot is ignored `.resources/continuous-mesh-painting.png`; the disposable test tab closed successfully. Hot reload reset the synthetic test view during source/documentation edits; final endpoint testing was repeated after those reloads.

A build attempt was refused at 155MiB by the unchanged 1536MiB guard; later admitted after capacity returned. A bounded 128MiB REA attempt exhausted its heap; a subsequent 384MiB portable inspection completed successfully. Both helper PIDs were verified absent; no native JVM or original application runtime was launched. Existing loopback preview was re-observed and retained within its recorded lease. Full-resolution gigabyte painting and native runtime parity were not validated. CAD smoke and physical-device tests were not rerun because kernel/device contracts were unchanged.

## Geometry color families - 2026-10-11

Freeform authoring objects and commands now use purple, reference primitive commands and newly fitted reference planes use teal, and exact CAD commands and newly created STEP-exportable geometry use neutral grey. Scan commands retain yellow artwork. Exact CAD primitives remain grey, including fitted primitives materialized through the CAD kernel. Existing project colors remain authored data. Action dispatch, project serialization and STEP eligibility are unchanged.

Validation: `npm run build` passed with zero warnings/errors and 28 offline assets; `npm test` passed 214 tests across 30 files. New icon tests cover every Freeform and CAD tab command and distinguish reference fitting from exact CAD creation. `npm run format:check` passed. Browser creation confirmed a purple NURBS surface (`#aa83cf`), conversion to a grey exact NURBS CAD face (`#a6a6a6`), and a teal fitted reference plane (`#60b6ad`) excluded from STEP. Main ribbon and rendered geometry were visually checked; captured warning/error logs were empty. Screenshot: ignored `.resources/geometry-color-families.png`. The disposable test tab closed, releasing its CAD worker. Large-file and physical-device tests were not rerun for this appearance-only slice. The existing loopback preview remains running within its recorded lease.

## Dedicated scan-edit controls - 2026-10-11

Used the reverse-engineer-anything skill, fresh REA portable retained-bundle inspection, installed manual/localization, supplied screenshots and a limited native UI observation. The native workspace and Create Sketch controls were read, but native file import and Edit Scan runtime observation could not complete because the automation could not target modal/indexed controls reliably. Retained REA metadata does not recover dialog handlers. Complete source-logic recovery and application-wide tool-dialog equivalence remain unresolved; the inventory and evidence boundaries are in TOOL_DIALOGS.md.

Replaced the mixed Edit Scan inspector with a dedicated component using verified mesh-edit control groups. Reused existing working selection actions. Unrecovered individual-mesh/hole/boundary editing, distinct freehand/line tools, connected-all, enlarge/shrink and clipping controls remain explicitly unavailable. Statistics, transforms, display sliders and unrelated modeling panels no longer appear in Edit Scan. Property commands open a separate workspace; Close exits mesh selection mode. No new mesh or fitting algorithm was introduced.

Validation: final `npm run build` passed with zero warnings/errors and 28 offline assets; full `npm test` passed 217 tests across 31 files. New component checks cover unavailable-operation substitution, independent through/tool state, sensitivity and selection-dependent action availability. Prettier and `git diff --check` passed. Browser tests verified all four available tool switches, numeric sensitivity, through mode, invert/clear, named selection saving, hide/reveal, selection undo/redo, isolate of a fully selected mesh, quick-tools visibility, wireframe, copy/cut/delete with model undo, Close returning to camera mode, and separate object properties. Hide changed 1452 selected triangles to 1452 hidden; one selection Undo restored the selected region. Selection/display actions kept model history at zero; copy/cut/delete created one modeling step each. Partial-region isolate, native runtime parity and unavailable actions were not validated. Browser warning/error logs were empty. Screenshot: ignored `.resources/edit-scan-dialog.png`.

The disposable browser tab closed. The first native inspection process was closed by the user; the second task-owned native inspection process was released after the modal-targeting blocker and its absence verified. The existing loopback preview was retained within its finite lease. CAD kernel, gigabyte imports and physical-device checks were not rerun because their contracts were unchanged.

## Flat hover header - 2026-10-11

The revealed project header fills the remaining tab-row width after Help, with no border, rounded corners or popup shadow. At widths below 1050px it spans the full tab row so actions remain usable. Hover dismissal and keyboard focus access are preserved; command dispatch is unchanged.

Validation: the first build attempt was refused by the unchanged 1536 MiB memory guard. After capacity recovered, `npm run build` passed with zero warnings/errors and 28 offline assets. `npm test` passed all 217 tests across 31 files; Prettier and `git diff --check` passed. Browser checks at 1840px measured identical header and remaining-space bounds; at 900px the header spanned the full viewport. Both had zero border and shadow. Hover reveal, pointer dismissal and keyboard access passed; captured warning/error logs were empty. Screenshot: ignored `.resources/flat-hover-header.png`. The temporary viewport was reset and disposable browser tab closed. The requested preview remains running within its recorded lease. CAD/device/large-file workflows were not rerun for this CSS-only change.

The user subsequently opened a loaded scan in the native application. Its Edit Scan dialog was successfully read and its control inventory retained privately. The observed sensitivity edit showed 1.84 degrees while its slider exposed position 23; the conversion, range and selection handlers remain unrecovered. This observation does not establish algorithm equivalence. The user-owned native process was preserved.

## Connected-component wand control - 2026-10-11

Used the reverse-engineer-anything skill and portable REA retained-bundle inspection (three existing records), followed by native runtime observation on the user-loaded scan. Checking the connected-triangle checkbox disabled sensitivity; clicking the scan colored its entire visible component red without adding model history. Implemented that control state and whole-component outcome using the existing topology component inventory. No native handler was recovered. Exact adjacency, hidden traversal, sensitivity endpoint mapping and other unavailable Edit Scan operations remain unresolved in TOOL_DIALOGS.md.

`npm run build` passed with zero warnings/errors and 28 offline assets. `npm test` passed 219 tests across 31 files, including a bent connected component, disconnected island, unchanged angle/seeds and disabled sensitivity controls. Prettier and `git diff --check` passed. Browser checks selected all 1452 demo triangles with one click, verified undo to zero and redo to 1452 with model history at zero, and restored enabled sensitivity when unchecked. At 1.84 degrees the same click selected 100 triangles. Hiding that region then using connected mode selected 1352 triangles with 100 remaining hidden; Alt-click removed the selected component while retaining hidden faces. Browser warning/error logs were empty. Private screenshot: `.resources/connected-selection-proof.png`. The disposable browser tab closed and its worker was released; the requested loopback preview and user-owned native application remain running. Native diagnostic subdialog tests and restoration of the temporary native selection/sensitivity could not complete because cached controls and child-window targeting were rejected. Large-file, device and CAD workflows were not rerun for this selection-only slice.

## Wand sensitivity replay - 2026-10-11

The installed manual PDF219 establishes post-click sensitivity expansion and shrinkage. This slice implements that interaction with the existing independent region-growth algorithm; original curvature computation and numeric mapping remain unrecovered. Changes retain the pre-click mask, debounce and cancel superseded worker requests, and invalidate replay after selection undo, visibility changes, named restore or changed geometry.

Build passed without warnings/errors. Focused wand tests passed 3/3; the full suite passed 226 tests across 33 files. Prettier and diff checks passed. Browser tests changed one clicked region from 100 to 200 triangles at 90 degrees and back to 100 at 4 degrees. A second click retained the first region (365 total). Connected mode expanded to 1452 and unchecked restored 365. Alt subtraction retained 265 other triangles, expanded connected subtraction to zero, then restored 265 when unchecked. Hiding produced 265 hidden/zero selected; selection undo restored 265 selected/zero hidden. Angle changes after hiding did not resurrect the cancelled region. Model history remained at zero throughout. Ignored screenshot: `.resources/wand-replay-proof.png`; the disposable test tab closed. Large-file, device and kernel workflows were not rerun because those boundaries were unchanged.

## Selected-area fine alignment - 2026-10-11

Manual PDF49/54 establishes priority-region input for fine alignment. The selected visible triangle mask now crosses App, MeshTools and the processing-worker boundary. Hidden triangles are excluded; without selection, visible triangles are eligible. Region sampling is bounded and does not copy a full subset mesh. The existing independent ICP algorithm derives the rigid pose, then the worker transforms the whole moving scan. Native convergence, CAD-surface matching and dialog parity are not established.

Build passed without warnings/errors. Focused registration/worker/client/UI checks passed 16 tests across 4 files; the complete suite passed 232 tests across 36 files. Prettier and diff checks passed. Tests cover priority/hidden masks, invalid or stale masks, bounded sampling, preserved input buffers and full-scan transformation of an unselected outlier patch. Browser validation imported a five-triangle scan and a four-triangle target, selected the four-triangle source component, then aligned at 1mm search distance. It reported ten retained correspondence samples, convergence in one iteration and RMS 1.792e-7mm. History advanced from two import steps to three with exactly one alignment step. Browser warning/error logs were empty. Project export reported dispatch, but the browser download-event observer timed out; exported-file geometry readback was not verified. Whole-scan movement and target immutability were verified through the actual worker test instead. Private screenshot: `.resources/alignment-priority-proof.png`. The temporary tab closed; CAD, large-file and physical-device workflows were not rerun.

## Dedicated N-points alignment - 2026-10-11

REA skill, retained native overview/search evidence and installed manual PDF48-49 establish the ordered landmark/Preview/OK contract; native paired-point computation remains unrecovered. The command now opens a dedicated session instead of generic coordinate textareas. Inputs, temporary pose and acceptance are separated. Markers are projected from world coordinates and cleared on exit; picking can be restricted to either overlapping object. Accepted rigid transforms preserve source triangle-slot state; the fixed entity is retained.

Final build passed with zero warnings/errors and 28 offline assets. Focused tests passed 5/5; the complete suite passed 237 tests across 38 files. Prettier/diff checks passed. Tests cover interleaved pick order, minimum/matched counts, nonfinite and degenerate inputs, preview without source mutation, stale target rejection, marker pose and preserved target/source metadata. Browser tests picked three points on each overlapping imported scan, removed the last point (Preview disabled), removed all points (zero markers), recreated six points, previewed, cancelled, then previewed and accepted. Approximate clicks yielded RMS0.2295mm. Preview/Cancel retained two import steps; OK added exactly one alignment step. Undo/Redo and zero markers after exit passed. Final markup showed the dedicated panel visible and properties hidden. Browser warning/error logs were empty. Camera-following marker pixels and rendered preview appearance were not visually verified: repeated screenshot requests timed out, and view-based capture was unsupported. DOM/picking/state checks succeeded; private final DOM is `.resources/landmark-browser-state.txt`. The disposable tab closed. CAD, gigabyte and hardware workflows were not rerun. Exact native solver/dialog equivalence remains incomplete.

## Selected-region surface fitting - 2026-10-11

## REA evidence and the installed manual establish a selected-region Apply/OK workflow; the native fit solver remains unrecovered. Tests cover selected-visible filtering, frozen input ownership, empty/mismatched selection rejection, scan preservation, preview without model mutation, stale source rejection, linked accepted geometry and patch serialization. A tilted planar region plus an unselected distant outlier fits with maximum residual below0.001mm. Dialog checks cover initial U/V10, disabled acceptance and cancellation during work. A selection-overlay regression test rejects old-object triangle masks before they can upload nonfinite vertices.

Browser checks exercised the empty-selection prerequisite, worker failure on an underconstrained whole bracket without committing, successful Apply on an authored288-triangle tilted planar scan, residual statistics (RMS1.861e-13mm), Cancel without history, changed U count disabling OK, re-Apply and OK adding exactly one Fit surface history operation, and Undo/Redo. The browser initially logged a nonfinite bounding sphere during import when an old selection mask reached new geometry; the new overlay guard fixes that transient mismatch. Repeating that import on the final source produced no newer warning/error log. A bounded panel screenshot succeeds; full viewport capture remains unreliable. Larger STL, exact CAD and physical SpaceMouse workflows were not rerun for this slice. Full native surface parity remains incomplete; Analysis exposes projected fit statistics only.

Final checks: npm run build passed with zero warnings/errors and28 offline assets; focused surface/overlay checks passed5/5; npm test passed242 tests across41 files; targeted Prettier and git diff --check passed. The corrected panel was visually inspected in a bounded screenshot saved privately at .resources/surface-fit-panel-proof.png. The disposable browser tab closed, the finite REA worker exited, and the user-requested loopback dev server remains healthy under its existing lease.

Directional sketch dimensions and construction references - 2026-10-11

The installed manual PDF84/PDF86 establishes directional distances and construction designation; native solver/annotation behavior remains unrecovered. Focused sketch tests cover positive/negative coordinate sides, reversed references, preserving the unmeasured coordinate/degree of freedom, invalid values/references, atomic rejection of conflicting dimensions, scoped deletion through arcs/tangency and construction geometry exclusion from closed profiles. Serialization round-trips retain dimensions and construction flags. Browser checks remove segment s1 and only its horizontal constraint while keeping c3 and point dimension c6; reject an incompatible90mm horizontal dimension against the existing40mm relation; add valid40mm horizontal and30mm vertical dimensions; mark a new diagonal as construction and verify its dashed SVG stroke; then extrude to exact CAD. Result bounds40x30x20mm, volume24000mm3 and one history step confirm construction did not alter the rectangle boundary. Browser warning/error logs were empty. Scan-to-sketch, contextual viewport editing, original solver equivalence, gigabyte imports and physical-device workflows were not validated by this slice.

Final validation: npm run build passed with zero warnings/errors and28 local offline assets. Focused sketch tests passed20/20; npm test passed252 tests across42 files. Final browser readback confirmed both human-readable distance labels and solved diagnostics; the bounded screenshot is .resources/sketch-editing-proof.png. Exact-CAD extrusion boundaries were verified in the browser; its kernel worker is disposed with the closed test tab. REA's finite probe exited0 and PID44944 is absent. The healthy existing preview remains at127.0.0.1:5173 under its finite lease.
