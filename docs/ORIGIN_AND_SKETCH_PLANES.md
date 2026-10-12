# World origin and sketch planes

Every document has the same immutable right-handed world coordinate system: origin (0, 0, 0), X/Y/Z axes, millimeter coordinates, and XY/YZ/XZ reference planes. It exists even with no scan or CAD body. These are construction references, excluded from object counts and geometry export. Origin visibility is a display control and does not create model-history steps.

The explorer shows a compact Coordinate System row with a visibility checkbox and a sketch action. Normal viewing shows only the origin marker and axes. Create sketch on plane enters an isometric plane-picking view without requiring a scan. All three planes start at 8% opacity; hovering raises only the hovered plane to 30%. Plane picking tests just the origin planes and takes priority over scan meshes. Clicking creates the sketch immediately and faces the camera normal to its plane, with the local V axis upright. The temporary planes disappear after creation or cancellation. Escape cancels without creating a sketch.

The picker also provides named plane buttons for keyboard access. Custom plane opens placement choices for world planes with a normal offset, existing fitted-plane entities, or a custom origin and nonzero normal. The custom basis is orthonormal and right-handed. Invalid frames are rejected.

Sketch creation stores the complete frame in the saved sketch. Local UV dimensions and points map into world coordinates through that frame. Saved-project reload retains it. With drawing constraints enabled, line endpoints snap to existing endpoints and the local sketch origin; newly snapped origin points receive a fixed relation. Existing dimension and constraint controls operate on the actual drawn point IDs, rather than assuming legacy rectangle IDs.

The original scan-section creation workflow remains available through Use scan section when a scan mesh is selected. This implementation connects existing sketch-frame, dimension and section components; it does not claim new native-handler recovery or full original-application parity.

Remaining boundaries: custom frames currently belong to saved sketches rather than separate named datum-plane objects; world-origin relocation, datum dependency rebuilds, arbitrary CAD-face picking, projected/intersection snapping and complete sketch-to-body workflows are not validated by this slice. Advanced ribbon commands retain their disabled verification status.
