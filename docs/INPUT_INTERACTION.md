# Mouse interaction evidence

ScanForge implements an independently authored CAD mouse scheme. REA inspection and installed reference documentation establish intended commands; they do not establish runtime equivalence or recover input-handler algorithms.

## Implemented scheme

| Input                               | Behavior                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| Left click in object mode           | Pick an object or measurement point                               |
| Left drag outside mesh edit         | Rotate the view (ScanForge convenience gesture)                   |
| Ctrl + left drag outside mesh edit  | Pan                                                               |
| Shift + left drag outside mesh edit | Zoom                                                              |
| Middle drag                         | Rotate the view                                                   |
| Ctrl + middle drag                  | Pan                                                               |
| Shift + middle drag                 | Zoom; takes precedence over Ctrl                                  |
| Right click                         | Open viewport actions                                             |
| Left drag in mesh edit              | Add a screen brush, rectangle or ellipse region                   |
| Alt + left drag                     | Subtract the region                                               |
| Wand click                          | Grow a connected triangle region using the local crease threshold |
| Ctrl + wheel                        | Change brush pixel radius or wand angle                           |

Rectangle/ellipse selection tests selected-mesh self-occlusion at triangle centroids using an indirect BVH. The screen brush tests a continuous pointer path expanded by its pixel radius against projected triangle footprints, then checks visibility at a touched point. Select through skips that depth test. Indirect indexing preserves original triangle slots, including after acceleration construction. Connected growth follows welded manifold edges and treats ambiguous edges as barriers. Selection changes do not modify source positions. Screen acceleration is discarded when geometry changes or its object/viewport is disposed.

These are deliberate independent choices: centroid inclusion, double-sided visibility rays, additive selection, numerical tolerances and modifier precedence. The reference documentation does not specify their exact equivalents. Other objects are not considered as occluders. The brush includes edge contacts; rectangle/ellipse tools remain centroid-based. Brush visibility currently samples one touched point per triangle, so partially occluded triangle coverage remains limited. BVH construction and screen selection currently run on the main thread, require memory proportional to the mesh and have not been stress-tested on the full gigabyte source.

## Evidence provenance

Reference manual SHA-256: `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`.
Localization resource SHA-256: `18e6933e747691560c4d456748737fb6777e5e8fcfa3e06a0756e61f8b274d8c`.

Manual PDF pages 8 and 22 describe configurable navigation and context menus. Page 26 describes selection tools, Alt subtraction, Ctrl-wheel adjustment and visible/through modes. Pages 27 and 219 describe selection operations, saved regions and mesh-edit entry. Localization lines 4181–4200 document the default middle-button gestures; alternate presets occupy lines 4205–4317. References identify evidence without distributing the original text or assets.

REA reviewed retained evidence IDs `ev_3079f2c83a8851aa2eb804b297ee45adc7fb263f95320576a08103eedb6d4e06`, `ev_578bc12f4f690196d2da7ece3662d1bce3384abd09424dbb1587ade5c37fd85f` and `ev_6efacddf01ef40da65ee3e13cc0cfd6af855af08130bb1514e1312b29781e5fe`. Their overview/search metadata does not recover a mouse handler. No original application runtime was observed during this slice.

## Remaining interaction work

- Freehand filled lasso and line selection.
- Region enlargement/shrinking.
- Named selection rename and undo of saved-name creation/deletion; exact reference saved-visibility semantics.
- Recompute an existing wand region when its angle changes.
- Configurable navigation presets, rotation centers and rotation methods.
- Scene-wide occlusion and scalable asynchronous screen selection.
- Native runtime comparison of click, double-click, modifier and threshold semantics.

Current browser checks and counts are in [validation](VALIDATION.md). This ledger records implemented behavior and unresolved comparisons; complete application equivalence is not claimed.

## Context menus

Right-click object rows for properties, visibility, scan editing and dependency-checked deletion. Right-click history for Undo/Redo; eligible earlier revision rows also offer restoration. Viewport actions include fitting, properties, selection editing, select/invert/clear and copy/cut/delete. These reuse the existing undoable commands. Menus support keyboard focus, Escape/outside dismissal and window-edge placement. They are independently designed; complete reference menu coverage remains unresolved.

## Selection state and modeling history

Hide selected adds triangle slots to a display mask and clears selection. Isolate hides every unselected slot, leaving the selected region. Show hidden clears the display mask. Hidden triangles are excluded from picking, screen selection and occlusion tests without modifying source coordinates. A compact render index maps picked faces back to original triangle slots. Geometry replacement clears stale triangle authoring metadata; model undo can restore the metadata valid for its earlier geometry.

Each mesh has a separate session selection undo/redo stack (20 steps). A screen brush/rectangle/ellipse gesture produces one step; wand, select/clear/invert and hide/isolate/reveal are individual steps. Ctrl+Z and Ctrl+Shift+Z/Ctrl+Y operate on selection in mesh-edit mode and model history outside it. Text fields retain their native editing shortcuts. W/B choose wand/brush; U toggles through; Ctrl+Q clears. These undo grouping and redo semantics are independently chosen, not recovered handlers. Session stacks are transient and require memory proportional to stored masks.

Named selections persist under `Entity.meshSelection` as sorted original triangle slots with IDs/names. The mesh-child entry restores by double-click, an explicit Restore button or its context menu. Restoration reveals selected slots and keeps unrelated hidden slots; the reference's exact saved-visibility format is unknown. Saved-name deletion is available, but saved-name create/delete/rename undo is not implemented. Both save paths and project parsing validate sparse indices and remain compatible with older projects.

Model history now records object creation/removal and geometry, kernel or parametric authoring changes. Opacity, color, names, object visibility, hidden triangles and named selections do not create steps or clear model redo. Model restoration retains current display settings for surviving objects. This display/history separation follows the user's instruction, not an inferred original implementation. Hidden triangles are display state: current mesh/STEP export retains source geometry. Export-visible triangle parity, region morphology, freehand/line tools, configurable navigation and native handler equivalence remain unresolved.

## Camera drag correction � 2026-10-11

Object-mode left dragging was disabled both when constructing the viewport and when switching selection modes. It now drives OrbitControls while a stationary click still picks an object/measurement point. Capture-phase routing applies Shift zoom precedence before OrbitControls starts the gesture; Ctrl/Meta pan uses OrbitControls' existing modifier handling. Mesh-edit left dragging remains reserved for selection, middle navigation remains enabled in every mode and right-click remains reserved for context menus. Navigate explicitly returns to object/camera mode without changing project geometry or model history.

Left-drag camera navigation is a ScanForge convenience gesture, not a recovered original mouse handler. Documented middle-button behavior remains available. Numerical orbit behavior, pivot selection and navigation presets are still independent implementation choices.

## Continuous painting correction - 2026-10-11

The installed manual PDF page 26 documents a manual brush, Ctrl+wheel sizing and Alt+left-drag removal. It does not specify event interpolation or triangle-footprint rules. A fresh REA portable inspection of the retained native bundle confirmed the three evidence records listed above; none contains a recovered paint handler. The installed manual digest was rechecked. No original runtime comparison was possible on this pass.

The reported gap was traced directly to ScanForge: each accepted event stamped one circle, with an 80ms throttle and no connecting stroke. The brush now retains intermediate/coalesced pointer positions and covers their connected path in one screen-selection pass. Pointer capture keeps the gesture active until release over another UI area. The final buffered segment is applied before closing its single selection-undo step. Triangles touched by the brush boundary are included even when their centroids lie outside it; the visibility probe moves fractionally inward to avoid ray/edge roundoff. Alt subtraction, through mode, hidden masks and unchanged source geometry remain supported. These are independently authored corrections to documented intent, not claims that the original implementation was recovered.

Remaining original comparisons include exact coverage, sampling, visibility and modifier semantics. Wand sensitivity replay, distinct freehand/line modes and other interaction work above remain unresolved. Brush selection still runs on the main thread, tests only self-occlusion and has not been validated at full gigabyte scale.
