# Keyboard shortcut recovery and routing

The installed English localization resource includes a shortcut catalog at lines5524–5736. Its SHA-256 is `18e6933e747691560c4d456748737fb6777e5e8fcfa3e06a0756e61f8b274d8c`. This is shipped UI evidence of the documented chords, not a recovered accelerator table or runtime proof of dispatch precedence. The installed manual also describes navigation-angle configuration and mode-specific mouse modifiers. Private evidence retains the original paths; no vendor code or assets are included in this repository.

| Context           | Chords                 | Documented action                                                      |
| ----------------- | ---------------------- | ---------------------------------------------------------------------- |
| Any mode          | A; T, K, L, R, F, M, I | Fit all; top, back, left, right, front, bottom, isometric              |
| Any mode          | Arrows; Ctrl+arrows    | Rotate90 degrees; use configured navigation angle                      |
| Main              | Ctrl+N/O/S             | New/open/save document                                                 |
| Main              | H; Ctrl+H; S; D; W     | Hide selected; hide visible meshes; new sketch; compare; wand          |
| Main              | Ctrl+Q/T/F             | Clear mesh facets; trim; fillet                                        |
| Main              | Ctrl+Z/Y               | Undo/redo                                                              |
| Main              | Ctrl+1/2/3/4/5/6       | Toggle meshes/point clouds/surfaces/solids/sketches/reference geometry |
| Main              | Ctrl+7/8/9/0/P         | Toggle planes/cylinders/cones/spheres/all primitives                   |
| Sketch            | L/C/R/D/T/M/O/J        | Line/center circle/arc/dimensions/trim/mirror/offset/join              |
| Freeform          | S/Q/D; Ctrl+R          | Split edge/smooth/bridge; refine every quad into four                  |
| Primitive fitting | P/C/O/E; Shift+L       | Plane/cylinder/cone/sphere/reference line                              |

The resolver gives mode-specific bindings precedence over global view letters. A reserved mode binding cannot accidentally switch the camera when its command is unavailable. Native precedence has not yet been observed. Undo dispatch goes to selection or sketch authoring when those editors own the session, and model history otherwise. Selection undo's Ctrl+Z chord is separately documented by the shipped resource at lines1212–1213; per-sketch transaction ownership remains an independently chosen application behavior.

The host must supply `availableActions` for commands it can execute now. Catalog coverage alone does not implement unsupported geometry operations. Unavailable chords pass through without preventing browser defaults. Busy operations, modal dialogs, editable ancestors, IME composition, repeated keydowns, already-handled events and unsupported modifier combinations do not dispatch. Arrow keys remain native inside buttons/menus/tab lists. Browser Meta shortcuts are preserved because the source catalog documents Ctrl chords.

Existing ScanForge B (brush), U (through selection) and Ctrl+Shift+Z (redo) remain opt-in extensions; they have no native shortcut evidence. Escape belongs to the active gesture/dialog and is handled by those components. Pointer modifiers (Alt subtraction, Ctrl-wheel sizing, sketch fitting and freeform brush smoothing) require their own gesture handlers and are not inferred from this keydown router.

Implementation plan: integrate the resolver into the application's command dispatcher; expose only executable commands; route view changes through shared viewport methods and visibility changes through display-only state; present enabled bindings in Help; test real key events across main/selection/sketch modes, text fields and modal dialogs. Advanced sketch trim/mirror/offset/join, freeform split/bridge/refinement and reference-line fitting still require their missing workflows before shortcut parity can be claimed.
