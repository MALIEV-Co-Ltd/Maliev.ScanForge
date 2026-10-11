# Initial workbench validation — 2026-10-11

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
