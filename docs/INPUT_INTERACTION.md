# Mouse interaction evidence

ScanForge implements an independently authored CAD mouse scheme. REA inspection and installed reference documentation establish intended commands; they do not establish runtime equivalence or recover input-handler algorithms.

## Implemented scheme

| Input                     | Behavior                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| Left click in object mode | Pick an object or measurement point                               |
| Middle drag               | Rotate the view                                                   |
| Ctrl + middle drag        | Pan                                                               |
| Shift + middle drag       | Zoom; takes precedence over Ctrl                                  |
| Right click               | Open viewport actions                                             |
| Left drag in mesh edit    | Add a screen brush, rectangle or ellipse region                   |
| Alt + left drag           | Subtract the region                                               |
| Wand click                | Grow a connected triangle region using the local crease threshold |
| Ctrl + wheel              | Change brush pixel radius or wand angle                           |

Visible selection tests selected-mesh self-occlusion at triangle centroids using an indirect BVH. Select through skips that depth test. Indirect indexing preserves original triangle slots, including after acceleration construction. Connected growth follows welded manifold edges and treats ambiguous edges as barriers. Selection changes do not modify source positions. Screen acceleration is discarded when geometry changes or its object/viewport is disposed.

These are deliberate independent choices: centroid inclusion, double-sided visibility rays, additive selection, numerical tolerances and modifier precedence. The reference documentation does not specify their exact equivalents. Other objects are not considered as occluders. Triangles touched only at their edges can be missed. BVH construction and screen selection currently run on the main thread, require memory proportional to the mesh and have not been stress-tested on the full gigabyte source.

## Evidence provenance

Reference manual SHA-256: `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`.
Localization resource SHA-256: `18e6933e747691560c4d456748737fb6777e5e8fcfa3e06a0756e61f8b274d8c`.

Manual PDF pages 8 and 22 describe configurable navigation and context menus. Page 26 describes selection tools, Alt subtraction, Ctrl-wheel adjustment and visible/through modes. Pages 27 and 219 describe selection operations, saved regions and mesh-edit entry. Localization lines 4181–4200 document the default middle-button gestures; alternate presets occupy lines 4205–4317. References identify evidence without distributing the original text or assets.

REA reviewed retained evidence IDs `ev_3079f2c83a8851aa2eb804b297ee45adc7fb263f95320576a08103eedb6d4e06`, `ev_578bc12f4f690196d2da7ece3662d1bce3384abd09424dbb1587ade5c37fd85f` and `ev_6efacddf01ef40da65ee3e13cc0cfd6af855af08130bb1514e1312b29781e5fe`. Their overview/search metadata does not recover a mouse handler. No original application runtime was observed during this slice.

## Remaining interaction work

- Freehand filled lasso and line selection.
- Region enlargement/shrinking, isolation and per-triangle hide/reveal.
- Persistent named selections and selection-specific undo history.
- Recompute an existing wand region when its angle changes.
- Configurable navigation presets, rotation centers and rotation methods.
- Scene-wide occlusion and scalable asynchronous screen selection.
- Native runtime comparison of click, double-click, modifier and threshold semantics.

Current browser checks and counts are in [validation](VALIDATION.md). This ledger records implemented behavior and unresolved comparisons; complete application equivalence is not claimed.
