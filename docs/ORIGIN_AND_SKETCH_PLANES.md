# World origin and sketch planes

Every document has the same immutable right-handed world coordinate system: origin (0, 0, 0), X/Y/Z axes, millimeter coordinates, and XY/YZ/XZ reference planes. It exists even with no scan or CAD body. These are construction references, excluded from object counts and geometry export. Origin visibility is a display control and does not create model-history steps.

The explorer selects a reference plane and orients the camera normal to it. A viewport click can also select a visible plane when it does not hit model geometry. Create sketch on plane opens placement choices without requiring a scan. Choices include world planes with a normal offset, existing fitted-plane entities, or a custom origin and nonzero normal. The custom basis is orthonormal and right-handed. Invalid frames are rejected.

Sketch creation stores the complete frame in the saved sketch. Local UV dimensions and points map into world coordinates through that frame. Saved-project reload retains it. With drawing constraints enabled, line endpoints snap to existing endpoints and the local sketch origin; newly snapped origin points receive a fixed relation. Existing dimension and constraint controls operate on the actual drawn point IDs, rather than assuming legacy rectangle IDs.

The original scan-section creation workflow remains available through Use scan section when a scan mesh is selected. This implementation connects existing sketch-frame, dimension and section components; it does not claim new native-handler recovery or full original-application parity.

Remaining boundaries: custom frames currently belong to saved sketches rather than separate named datum-plane objects; world-origin relocation, datum dependency rebuilds, arbitrary CAD-face picking, projected/intersection snapping and complete sketch-to-body workflows are not validated by this slice. Advanced ribbon commands retain their disabled verification status.
