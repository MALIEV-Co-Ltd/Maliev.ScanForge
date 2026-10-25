# Scan Data edit MVP

Import a mesh, select it in Objects and choose **Scan Data → Edit** (or
right-click the object → Edit scan selection). Edit shows live connected-mesh,
hole and boundary counts. Each count opens its own navigation/list panel.

## Selection and access

- Magic wand grows across shared edges whose dihedral angle is within the
  sensitivity in degrees. Select all connected triangles removes angle filtering.
- Filled free hand selects a closed drawn area; free hand selects only its brush
  stroke. Drawing a line produces a straight brush stroke from drag start to end.
- Rectangle, circle, see-through, visible boundary selection, one-ring enlarge
  and shrink, all/invert, isolate, hide/show, delete, copy and cut are available.
  Alt subtracts and Ctrl+wheel adjusts brush size.
- Selection/visibility undo is separate from geometry/model undo. Geometry changes
  invalidate stored triangle slots. Hidden and clipped faces do not occlude the
  visible selection surface.
- Clipping Box clips only the selected mesh. Six canvas face handles and six
  sliders adjust world XYZ limits. Clipping changes view/access, not stored mesh
  geometry. Disable or reset it to restore the view.

## Mesh, hole and boundary panels

Individual meshes list connected components with triangle counts and areas.
Cycle/select them, flip their normals, retain/extract one or remove components
under a triangle-count/area threshold. The source is retained when extracting.

Fill holes lists closed boundary loops. Automatic chooses flat triangulation
for planar boundaries and tangent interpolation otherwise. Flat triangulates
the projected simple polygon; tangent and curvature use distinct boundary-normal
interpolation weights and preserve the rim. Semi hole fills the selected boundary
arc with a chord; Bridge connects the selected nonadjacent rim edges. Start/end
are zero-based indices of the displayed hole's boundary vertices. Multiple fills
use entire-hole mode, optionally filtered by measured geometric diameter.
Nonmanifold/inconsistently wound rims must be repaired first; unsafe intersecting
caps and overlapping flat outer-sheet caps are skipped. Closed borders can be
intentional openings and are not automatically defects.

Boundaries lists closed loops and open chains. Select/highlight, smooth selected
or all, and project to XY/YZ/XZ or an existing reference plane. Projection creates
editable line sketches with properly closed point graphs. Fit tolerance controls
polyline approximation independently of topology welding.

Selected-area smoothing marks vertices referenced by selected facets, including vertices shared with unselected facets. Unmarked vertices remain unchanged. The default six passes at strength0.5 equal three native two-pass clicks on the observed fan control; boundary corners follow the recovered boundary rules. Disconnected fans retain first-facet traversal. General nonmanifold-edge pairing remains an acceptance gap.
Defeature removes a bounded selected patch and triangulates its new closed seam.
Selecting the whole object or a patch joined to an existing open boundary is
rejected rather than replacing unrelated surfaces.

Split chooses another solid display mesh, surface mesh, scan mesh or reference
plane. Intersecting triangles are actually subdivided. Closed convex and concave
cutters partition by volume; finite open surfaces group fragments by signed
nearest surface. Open surfaces do not define global inside/outside: their local
support-plane refinement can add continuation edges inside intersected source
triangles. Reference planes extend infinitely. Split outputs are uncapped mesh
fragments, not new watertight solids.

## Validation scope

Algorithms are independently authored. Reference option coverage and manufactured
geometry/browser workflows do not establish native numerical equivalence,
certified metrology, C1/C2 continuity of interpolated hole patches, or robustness
for every self-intersecting/nested shell. Large-input and physical-device behavior
retain the limits in the validation/input-device documents. Expensive topology
operations run in cancellable workers; closing a panel or changing its source
releases the worker. Nothing is deployed by this slice.
