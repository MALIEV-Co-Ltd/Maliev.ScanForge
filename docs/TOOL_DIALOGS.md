# Tool dialog reconstruction ledger

This ledger separates recovered controls from implemented behavior. A matching name or layout does not establish an equivalent solver or input handler. The generic inspector is an independent prototype and is not a verified reproduction of every tool dialog.

## Sources and coverage

- Installed reference manual SHA-256: `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`.
- Installed localization SHA-256: `18e6933e747691560c4d456748737fb6777e5e8fcfa3e06a0756e61f8b274d8c`.
- Retained REA records: `ev_3079f2c83a8851aa2eb804b297ee45adc7fb263f95320576a08103eedb6d4e06`, `ev_578bc12f4f690196d2da7ece3662d1bce3384abd09424dbb1587ade5c37fd85f`, `ev_6efacddf01ef40da65ee3e13cc0cfd6af855af08130bb1514e1312b29781e5fe`. Fresh portable REA bundle inspection confirmed three overview/procedure/string records. None recovers tool-dialog handlers.
- Native UI Automation observation on 2026-10-11 read the running build's title version `8.0.123`, ribbon, and Create Sketch dialog. Its controls included extruded/revolved modes, coordinate planes, offset, interactive definition, snapping, scan slicing, selection restriction, stacked sections, outline filtering, orientation and Create/Create & Stay. Reading this dialog does not establish those algorithms. File-chooser interaction could not complete because indexed controls were unavailable in the automation cache and modal targeting was unreliable. No sample scan or Edit Scan runtime was successfully observed.

On a later 2026-10-11 observation, the user supplied a loaded scan with 1,374,367 triangles. Edit Scan was successfully read: one individual mesh and 16 holes were reported. Checking Select all connected triangles disabled both sensitivity controls. One click selected the visible component from end to end; model history retained only the import and end marker. Unchecking restored sensitivity controls. Slider position 23 corresponded to 1.84 degrees, and setting position 50 produced 4 degrees. This establishes two samples, not a verified endpoint range or formula. Further slider/numeric writes failed; individual-mesh subdialog clicks were rejected by native child-window targeting even after activation and a fresh capture. The inspection left sensitivity at 4 degrees and the temporary native selection active because restoration input was also rejected. No geometry was edited or saved.

REA PE resource inspection `ev_023ef9c9c1c3f76257418c68a0f481b9a7c202c04c03f8a3571f304bcfbdc526` completed with 35 directory entries and 15 resources on the same artifact digest. Resource types were icons, strings, icon groups, version and manifest; no dialog resource type was present in that executable's table. This bounded negative result does not exclude dynamically created dialogs, other carriers or unpacked runtime resources, and supplies no selection handler logic.

Original binaries, localization, manual pages, screenshots and analysis bundles stay outside the public source tree. Source behavior is not claimed from strings or labels alone.

## Edit Scan

Manual PDF pages 26–27 and 219–220 establish a dedicated mesh-edit dialog, rather than a mixed property/modeling inspector. Localization lines 2530–2579, 510–529, 1507–1508 and 7598–7608 corroborate the groups. The user-supplied dialog screenshot establishes placement of mesh diagnostics, selection rows, submesh creation and presentation toggles.

| Control group                        | Current implementation                                                                     | Still unresolved                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Individual meshes, holes, boundaries | Explicit unavailable Edit controls                                                         | Original diagnostics, editing subdialogs, boundary outlines and repair behavior |
| Selection tools                      | Wand, filled brush, rectangle, circle; through mode independent                            | Separate freehand and line tools; exact coverage and native defaults            |
| Sensitivity                          | Slider, number field and Ctrl+wheel replay the last region against its pre-click selection | Native range/default, curvature calculation and threshold mapping               |
| Connectivity                         | Connected-component wand checkbox; sensitivity disabled while checked                      | Exact native adjacency, tolerance, hidden-face traversal and nonmanifold rules  |
| Selection actions                    | Hide, isolate, reveal, invert, clear; existing selection undo/redo                         | Enlarge/shrink and native state/undo equivalence                                |
| Save selection status                | Dedicated naming form; existing sparse-index persistence                                   | Original saved-visibility representation and name editing/undo                  |
| New mesh from selection              | Existing Cut & Create and Copy & Create                                                    | Native result naming, history and export comparisons                            |
| Clipping box                         | Explicit unavailable control                                                               | Interactive box manipulation and clipping semantics                             |
| Presentation                         | Quick selection actions toggle, wireframe toggle, Close                                    | Original floating quick-toolbar arrangement and additional tools                |

ScanForge's existing algorithms are retained for working actions. No new reconstruction algorithm or substitution was added in this dialog correction. Unavailable controls cannot silently invoke smoothing, topology repair, a different selection mode or another modeling operation. Closing mesh editing returns to camera/object mode. Object properties open the property workspace separately.

Connected mode reuses the existing topology component inventory in the processing worker. It includes the seeded edge-connected component regardless of normal angle and front-face visibility, then excludes currently hidden triangles through the existing selection session. It preserves the angle setting when unchecked and records selection undo separately from model history. The native visible-component observation supports the control state and broad outcome; exact hidden-face traversal, nonmanifold connectivity and numeric sensitivity mapping remain unverified. REA's retained overview/procedure/string records still do not recover these handlers. Controls with unresolved behavior remain unavailable rather than presenting an invented operation as recovered logic.

## Primitive extraction

Manual PDF pages 28–31 and localization lines 2665–2687, 7817–7836 and 8237–8268 establish a staged dialog: select an area, choose plane/cylinder/cone/sphere, preview, analyze, constrain, create. The reference includes a constraint selector initially showing an unconstrained state, optional automatic constraint tolerances for tilt/coincidence, primitive labels and quick tools. Demonstrated constraints include perpendicular, parallel and coincident-axis relationships.

ScanForge's existing generic fitting panel does not reproduce this staged dialog or its constraints. Complete type-specific constraint inventories, defaults, fitting/constraint algorithms and runtime transitions remain unrecovered. It must not be described as complete primitive extraction parity.

## Remaining application-wide work

### Sketch placement and exact CAD boundary - 2026-10-11

The installed manual PDF55-61 documents coordinate planes, offsets and placing a sketch on the slicing plane or projecting it onto the reference plane. Sketches now persist an optional rigid world frame; legacy sketches retain XY at Z=0. The editor exposes coordinate-plane placement and offset without adding a model-history operation. Exact extrusion builds the polygon at its world placement and extrudes along the frame normal. Parametric recipes retain the frame and rebuild through the same CAD request; STEP therefore contains the placed geometry. Invalid scaled, sheared, reflected or nonfinite frames are rejected before native shape registration.

The declared right-handed conventions are OXY U=X/V=Y/+Z, OYZ U=Y/V=Z/+X, and OXZ U=Z/V=X/+Y. The native screen-axis conventions remain unobserved; these conventions do not claim equivalence to recovered native implementation. This fixes a placement boundary required by scan-to-sketch creation. The scan slicing/selected-visible extraction, separate reference-data persistence, per-sketch object ownership, interactive plane handle and full Create Sketch dialog remain unfinished. The existing editor still opens its saved global draft, initially a rectangle, rather than a newly extracted scan sketch.

### Sketch dimensions and construction references - 2026-10-11

Installed manual PDF84 documents straight, horizontal and vertical point distances; PDF86 documents construction geometry as a reference excluded from solid creation. Sketch constraints now distinguish Euclidean, horizontal and vertical distances. Directional dimensions are nonnegative coordinate separations, solved independently of the orthogonal coordinate. New relations solve before replacing the draft; conflicting or unsolved additions preserve the previous sketch. Construction lines/arcs remain in the constraint graph and are dashed in the preview, but profile extraction omits them. Existing sketches without construction flags retain their behavior; the project/sketch parsers validate the new fields and dimensions.

Deleting a point cascades only into incident lines/arcs and dependent relations; deleting a curve retains surviving point dimensions and independent constraints. This corrects the prior blanket constraint removal. Native deletion policy, sign/annotation conventions, constraint solver and interactive dimension placement remain unrecovered. The current editor still lacks the documented Create Sketch slicing stage and viewport drawing/contextual dimension workflow; these changes do not establish full sketch parity.

### Fit Surface transaction - 2026-10-11

The installed manual PDF38-39 documents selected scan data, initial U/V10, Apply, Analysis and OK. Fit Surface now opens a dedicated session with a copied selected-visible region, axis orientation, U/V counts and temporary surface preview. Apply does not alter entities or modeling history; Cancel discards the preview; OK creates one linked purple surface while preserving the scan. Changing options requires Apply again, and source geometry changes invalidate the session. Fitting runs in the existing cancellable, leased worker.

This is partial workflow parity using the independently authored height-field solver. Selection-bounds minimum-box orientation, surface smoothness, adaptive tolerance fitting through50x50 and native deviation visualization remain missing. Analysis currently reports projected residual statistics, not a native deviation map. Control counts remain bounded4-16 until larger solver memory and numerical behavior are validated. Exact native fitting computation is unrecovered. Generic Freeform authoring remains a separate unfinished workflow.

### Alignment input coverage - 2026-10-11

Manual PDF pages 49 and 54 describe fine alignment of an approximately aligned scan, using selected regions as priority data when available. Fine alignment now passes the selected visible triangle mask to the worker, or uses visible triangles when selection is empty. Sampling is bounded within that region; the derived rigid pose is applied to the entire source scan. The fixed target geometry is not changed. This uses independently authored sampled point-to-point ICP, not recovered native CAD-surface registration. Dedicated Preview/OK/Cancel dialogs, coordinate-system and interactive alignment, ordered viewport landmarks, simultaneous multi-scan fine alignment and original convergence policies remain unfinished.

Create Sketch's observed controls differ from the current polygon/constraint editor. Freeform, surfacing, CAD operations, scan preparation, registration and analysis still need separate field/default/state inventories, handler traces and original-versus-browser workflow checks. Current OpenCascade operations and authored geometry algorithms remain independent implementations. Full dialog parity and full original logic recovery are not complete.

### N-points alignment workflow - 2026-10-11

Manual PDF48-49 establishes corresponding ordered points on two objects, at least three pairs, numbered points, removal controls, Preview then OK. The dedicated N-points panel now selects an explicit fixed target and records moving/fixed viewport picks separately. Pick modes restrict raycasting to the requested object so overlapping objects can be picked independently. Numbered M/F markers follow the camera and the temporary preview pose. Remove last deletes the most recent recorded pick; Remove all clears both sets. Their exact native scope remains unverified.

Preview uses the existing independently authored paired-point worker, displays a temporary pose and leaves the model/history unchanged. Cancel restores the model pose and clears markers. OK commits one whole-scan transform, preserves triangle-slot metadata and selection state, and leaves the fixed target unchanged. New picks, removal, target changes or geometry changes invalidate a preview. To edit after Preview, choosing a pick mode first restores the original pose. Hidden objects must be shown before point picking. Factory pick sequencing, native marker manipulation, original solver weighting and exact dialog layout are not established. This closes the documented workflow gap, not complete native algorithm parity.
