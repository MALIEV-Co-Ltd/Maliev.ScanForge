# Capability and evidence ledger

This ledger distinguishes implemented workflows from future engineering work. A named feature is not evidence of parity with any other application.

| Area                       | Implemented                                                               | Limits / remaining work                                                                     |
| -------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Scan import                | STL, OBJ, polygon PLY                                                     | No point clouds, textures, scanner drivers, or proprietary project formats                  |
| CAD import                 | STEP, IGES, BREP                                                          | Flattened tessellation; no assembly tree, names, layer/color preservation                   |
| Navigation                 | Z-up orbit/pan/zoom, isometric/top/front/right, fit view                  | Perspective camera only; no orthographic projection                                         |
| Display                    | Visibility, opacity, color, shaded/wireframe                              | No texture/shader libraries                                                                 |
| Selection                  | Object picking and spherical fitting region around a surface point        | No brush, lasso, triangle-level editable segmentation                                       |
| Measurement                | Surface point-to-point distance, dimensions, area, volume estimate        | Volume assumes closed consistent winding; no certified metrology                            |
| Sections                   | Axis-aligned clipping and triangle intersection, CSV segments             | No fitted section curves, DXF, arbitrary planes, or sketch constraints                      |
| Fitting                    | PCA plane, least-squares sphere, PCA/projected-circle cylinder, residuals | Cylinder expects sampled side surfaces; no cones/torus/robust outlier rejection             |
| Deviation                  | Signed point-to-analytic-surface color map                                | No nearest-distance mesh-to-CAD comparison or uncertainty estimates                         |
| Mesh cleanup               | Degenerate triangle removal                                               | No hole filling, remeshing, smoothing, decimation, normals repair                           |
| Transform                  | XYZ rotation, uniform scale, translation, exact CAD preserved             | Origin-based transforms; no three-point alignment, ICP, reflection                          |
| CAD solids                 | Box, sphere, oriented cylinder, polygon prism                             | No feature history or constraint solver                                                     |
| CAD boolean                | Union, subtraction, intersection                                          | Two exact bodies; failed/empty results rejected                                             |
| Sketch                     | Editable XY polygon and preview, straight-edge extrusion                  | No holes, self-intersections, arcs, dimensions, constraints, sketch-on-face                 |
| Persistence                | Local JSON project, exact BREP restore, bounded undo/redo                 | No cloud autosave, collaboration, fit/session persistence                                   |
| Export                     | STEP exact visible bodies, STL visible meshes, section CSV                | No IGES export, DXF, vendor-native formats                                                  |
| Freeform reconstruction    | Not implemented                                                           | NURBS fitting, patch networks, continuity, quad surfacing, automatic mesh surfacing         |
| Advanced CAD               | Not implemented                                                           | Loft/sweep/revolve, fillets/chamfers, shell/thicken, trimming/sewing, editable feature tree |
| Standalone browser runtime | Local static JS/CSS/WASM; offline production cache                        | Requires initial installation/download; browser storage may evict cached assets             |

## Validation

Automated boundary tests live in `tests/geometry.test.ts`, `tests/io.test.ts`, and `tests/kernel-smoke.mjs`. The kernel smoke executes the actual WebAssembly module, including CAD exchange; mocked API availability does not count as a CAD pass. Browser verification and precise test results are recorded in `docs/VALIDATION.md` when the release slice is finalized.
