# Tool dialog reconstruction ledger

This ledger separates recovered controls from implemented behavior. A matching name or layout does not establish an equivalent solver or input handler. The generic inspector is an independent prototype and is not a verified reproduction of every tool dialog.

## Sources and coverage

- Installed reference manual SHA-256: `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`.
- Installed localization SHA-256: `18e6933e747691560c4d456748737fb6777e5e8fcfa3e06a0756e61f8b274d8c`.
- Retained REA records: `ev_3079f2c83a8851aa2eb804b297ee45adc7fb263f95320576a08103eedb6d4e06`, `ev_578bc12f4f690196d2da7ece3662d1bce3384abd09424dbb1587ade5c37fd85f`, `ev_6efacddf01ef40da65ee3e13cc0cfd6af855af08130bb1514e1312b29781e5fe`. Fresh portable REA bundle inspection confirmed three overview/procedure/string records. None recovers tool-dialog handlers.
- Native UI Automation observation on 2026-10-11 read the running build's title version `8.0.123`, ribbon, and Create Sketch dialog. Its controls included extruded/revolved modes, coordinate planes, offset, interactive definition, snapping, scan slicing, selection restriction, stacked sections, outline filtering, orientation and Create/Create & Stay. Reading this dialog does not establish those algorithms. File-chooser interaction could not complete because indexed controls were unavailable in the automation cache and modal targeting was unreliable. No sample scan or Edit Scan runtime was successfully observed.

Original binaries, localization, manual pages, screenshots and analysis bundles stay outside the public source tree. Source behavior is not claimed from strings or labels alone.

## Edit Scan

Manual PDF pages 26–27 and 219–220 establish a dedicated mesh-edit dialog, rather than a mixed property/modeling inspector. Localization lines 2530–2579, 510–529, 1507–1508 and 7598–7608 corroborate the groups. The user-supplied dialog screenshot establishes placement of mesh diagnostics, selection rows, submesh creation and presentation toggles.

| Control group                        | Current implementation                                                           | Still unresolved                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Individual meshes, holes, boundaries | Explicit unavailable Edit controls                                               | Original diagnostics, editing subdialogs, boundary outlines and repair behavior |
| Selection tools                      | Wand, filled brush, rectangle, circle; through mode independent                  | Separate freehand and line tools; exact coverage and native defaults            |
| Sensitivity                          | Wand angle slider/number input using existing connected-selection implementation | Native range/default, recomputing a prior wand region after sensitivity changes |
| Connectivity                         | Explicit unavailable checkbox                                                    | Exact connected-region and visibility semantics                                 |
| Selection actions                    | Hide, isolate, reveal, invert, clear; existing selection undo/redo               | Enlarge/shrink and native state/undo equivalence                                |
| Save selection status                | Dedicated naming form; existing sparse-index persistence                         | Original saved-visibility representation and name editing/undo                  |
| New mesh from selection              | Existing Cut & Create and Copy & Create                                          | Native result naming, history and export comparisons                            |
| Clipping box                         | Explicit unavailable control                                                     | Interactive box manipulation and clipping semantics                             |
| Presentation                         | Quick selection actions toggle, wireframe toggle, Close                          | Original floating quick-toolbar arrangement and additional tools                |

ScanForge's existing algorithms are retained for working actions. No new reconstruction algorithm or substitution was added in this dialog correction. Unavailable controls cannot silently invoke smoothing, topology repair, a different selection mode or another modeling operation. Closing mesh editing returns to camera/object mode. Object properties open the property workspace separately.

## Primitive extraction

Manual PDF pages 28–31 and localization lines 2665–2687, 7817–7836 and 8237–8268 establish a staged dialog: select an area, choose plane/cylinder/cone/sphere, preview, analyze, constrain, create. The reference includes a constraint selector initially showing an unconstrained state, optional automatic constraint tolerances for tilt/coincidence, primitive labels and quick tools. Demonstrated constraints include perpendicular, parallel and coincident-axis relationships.

ScanForge's existing generic fitting panel does not reproduce this staged dialog or its constraints. Complete type-specific constraint inventories, defaults, fitting/constraint algorithms and runtime transitions remain unrecovered. It must not be described as complete primitive extraction parity.

## Remaining application-wide work

Create Sketch's observed controls differ from the current polygon/constraint editor. Freeform, surfacing, CAD operations, scan preparation, registration and analysis still need separate field/default/state inventories, handler traces and original-versus-browser workflow checks. Current OpenCascade operations and authored geometry algorithms remain independent implementations. Full dialog parity and full original logic recovery are not complete.
