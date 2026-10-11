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

No proprietary screenshots, extracted assets, recovered source or private analysis tools are committed. Complex NURBS/freeform reconstruction, constrained sketches, robust registration, topology repair and most advanced CAD commands remain unimplemented. Large text formats/project loads still require whole-file parsing. Brush selection currently scans triangle centroids on the main thread and may be slow on very large meshes. History stores twenty session snapshots and is not a parametric feature DAG.
