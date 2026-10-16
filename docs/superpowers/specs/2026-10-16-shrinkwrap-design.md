# ShrinkWrap design proposal

Status: owner approved; implemented and validated. See docs/SHRINKWRAP.md for measured results and limitations.

## Intended outcome

Add ShrinkWrap as a separate Scan Data operation, available through the GUI and
MCP. It should produce a smooth, detailed reconstruction with independently
controlled gap closing and added thickness. Existing Re-polygonize remains
available. This is an independently implemented workflow inspired by documented
Magics controls, not a claim of numerical or algorithmic equivalence.

## Controls and semantics

| Control                        | Proposed behavior                                                                                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sample interval (mm)           | Positive reconstruction spacing, initially 0.5 mm; controls generated detail independently of thickness and gap fill. It is not a maximum-deviation guarantee.                                                                                              |
| Gap fill (mm)                  | Nonnegative maximum gap scale to attempt to bridge; zero disables deliberate gap bridging. Nearby intentional separations can also close and must be previewed. This is an algorithmic scale, not a guarantee that every irregular gap below it will close. |
| Organic shape                  | Off: favor close surface fitting and feature retention. On: fair generated geometry with source constraints, including smooth continuation across gaps. Neither option globally smooths the source without a deviation constraint.                          |
| Add extra thickness (mm)       | Nonnegative added outward offset, independent of sample interval; zero adds no requested offset. This is not a prescribed wall thickness and does not establish an unscanned back surface.                                                                  |
| Scope                          | Whole selected mesh object(s), selected triangles, or isolated visible triangles. An empty local scope fails explicitly.                                                                                                                                    |
| Maximum surface deviation (mm) | Separate source-fit constraint for supported measured areas, with reported achieved deviation and failure rather than silent relaxation. Default requires validation before adoption.                                                                       |

Selecting objects and selecting triangles are distinct scopes. Hidden objects do
not become inputs implicitly. Isolation is a way to define the local mask, not
permission to change hidden geometry.

## Local wrapping

Local wrapping modifies a region within its parent mesh and rejoins it at a fixed
seam. Unselected geometry stays unchanged. A narrow transition is permitted only
inside the selected region; a grow-selection control can give the user more room
to blend. Extra thickness tapers to zero at the fixed seam. A scope that cannot
accommodate the requested transition fails with an actionable error.

Disconnected selected regions are handled explicitly and reported. Local repair
does not claim the whole parent is watertight if unrelated holes remain.
Wrapping an extracted selection into a separate closed object is a different
operation and is not the default meaning of local wrapping.

## Reconstruction approach

Do not reuse binary midpoint voxel extraction as the final measured surface.
Use a bounded sampled field built from inward-shifted finite source facets and
clipped against the original oriented source. Extract shared grid-edge zero
crossings from that field, with two grid layers of cached scalar samples. The
final grid interpolant is continuous; nearest-facet orientation is an
approximation, so physical contour and sampled source-coverage checks remain
required. Post-fitting binary scaffold triangles was rejected after full-scan
tests exposed folds and intersections. Local wrapping retains and conformingly
refines measured facets instead of projecting them. Gap closing increases inward
continuation separately from added outward offset. Organic shape broadens the
generated continuation under the same fit acceptance setting.

Sparse or tiled storage should make cost depend primarily on the affected region.
Requested settings must never be silently coarsened or increased. Maintain bounded
resource admission, work limits, progress and cancellation throughout.

Prototype acceptance must establish source fitting, thin-wall behavior, sharp
features, gap closure and local seam correctness before production integration.
If the candidate cannot meet those requirements, revise this design rather than
shipping the current voxel wrap under another name.

## Shared operation and GUI/MCP boundaries

Introduce a shared scanTools/shrinkwrap operation with sampleInterval, gapFill,
organicShape, extraThickness, maxDeviation and explicit scope. Resolve object IDs
and triangle masks at the application boundary, then use the same worker kernel
for GUI and MCP. Inspect existing selection and isolation producers before
finalizing the wire schema. Schema discovery must not advertise unimplemented
options.

Provide preview, comparison to input, accept, cancel, create-new, undo and redo
through shared operations. Preserve revision guards, retry protection, locks and
reference ownership. Report actual settings, source/generated regions, achieved
deviation with its measurement method, topology defects, components, affected
triangle counts and whether the entire result is verified watertight.

Update the catalog, executor, editor adapter, agent guide and architecture docs
together with the feature. Existing unrelated dirty changes remain untouched.

## Validation and delivery

Build first, then focused tests and the relevant suite, static checks and GUI/MCP
integration tests. Test control independence, thin walls, close parallel sheets,
sharp creases, deliberate gaps, missing regions and fixed local seams. Check
bitwise preservation outside a local scope and matching GUI/MCP results, including
preview, cancellation, errors and history.

Validate the full exported Z:/scanforge (2).stl at 0.5 mm and a selected-region
case. Compare captured-region deviation and visual smoothness against both the
original and the existing voxel result. Distinguish sampled deviation from any
certified bound. Preserve the source file; export comparison artifacts separately.
Commit only coherent validated implementation slices and release owned helpers.

## Review decisions

Confirm that local wrapping means repairing and stitching back into the parent
mesh, and that Add extra thickness means additional outward offset rather than
an explicit shell wall thickness. Full-body completion and preserve-original-
triangles shell creation remain distinct workflows.
