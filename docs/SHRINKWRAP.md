# ShrinkWrap

ShrinkWrap is a separate Scan Data operation. Re-polygonize retains its existing
voxel-wrap behavior. ShrinkWrap extracts a sampled, oriented source field and creates
closure geometry where data is absent. It is an independently implemented
workflow inspired by Magics controls, not a reproduction of Materialise's kernel.

## Controls

- **Sample interval (mm):** generated sampling scale; default 0.5. Smaller values
  cost more memory and work. The requested value is never silently coarsened.
- **Gap fill (mm):** additional closure scale; default zero. Whole wrapping adds
  half this value to the inward continuation radius. Its matching inward shift
  keeps the captured planar front fixed. Local wrapping
  attempts eligible closed holes within this diameter. Intentional separations
  can close; inspect the preview. Zero disables deliberate gap closing but is not
  a guarantee that features below the sampling scale can be reconstructed.
- **Organic shape:** broader continuation of generated regions; default off.
  Whole wrapping increases the base inward continuation radius by 50 percent.
  Local wrapping preserves measured facets and fairs generated hole interiors.
- **Add extra thickness (mm):** added outward offset; default zero. It is separate
  from sample interval and is not a prescribed wall thickness. Local offsets
  taper to zero at the fixed parent seam. A selection too narrow to accommodate
  the requested offset fails with a grow-selection message.
- **Maximum surface deviation (mm):** source-fit acceptance setting; default 0.1.
  Errors are measured relative to the requested offset. Diagnostics identify the
  measurement and its supported regions. Sampled coverage is not a certified
  global maximum or Hausdorff bound.
- **Scope:** whole mesh object, selected triangles, or isolated visible triangles.
  Selected scope excludes hidden triangles. Isolated scope requires a hidden
  subset and uses the remaining visible triangles. Empty local masks fail.

Whole scope can include up to 32 additional visible aligned raw mesh references.
References remain unchanged. Local scope processes one parent and accepts no
additional references. CAD objects need an explicit mesh copy first.

Whole wrapping uses an inward continuation radius of `0.75 * sampleInterval +
gapFill / 2`, or `1.125 * sampleInterval + gapFill / 2` with Organic shape. The
initial inferred backing depth is twice this radius; source clipping and enclosed
volume filling can change the resulting shape. Added thickness offsets the
exterior independently. These values describe generated backing, not measured
wall thickness.

The final mesh is extracted from shared grid-edge crossings of the sampled field.
Clipping against the original oriented source prevents inferred backing from
covering captured surfaces. The nearest-facet clipping approximation can change
across facet boundaries; the grid interpolant is continuous. Physical contour,
topology and sampled coverage checks remain required. If the requested interval
cannot resolve a thin captured region or sharp corner, the operation fails and
asks for a finer interval instead of silently relaxing the deviation setting.

## Local preservation and closure

Local wrapping retains measured source facets geometrically through conforming
refinement. The selected/unselected seam stays fixed and unsplit. Unselected
facets are copied first in their original relative order; diagnostics report
`preservedTriangleCount`. New hole interiors follow the selected boundary.
Source refinement and generated hole counts are reported separately.

Selected patch topology is checked after processing. This does not establish
whole-parent watertightness: unrelated holes outside the scope can remain.
Whole wrapping reports its verified topology separately. Self-intersections are
not certified in either mode.

## GUI and MCP

The ShrinkWrap panel supports Preview, Compare to source, Accept, Cancel and
Create new object. These actions use the same guarded `scan_preview` controller
as MCP. Preview creation does not replace source geometry or create a history
entry. Acceptance creates one history step. Source or reference changes
invalidate a retained preview. The disposable preview expires after 60 seconds;
cancel, expiry and API disposal release its buffers and matching worker preview.

MCP preview creation:

```json
{
  "action": "create",
  "entityId": "scan-id",
  "operation": {
    "kind": "shrinkwrap",
    "sampleInterval": 0.5,
    "gapFill": 0,
    "organicShape": false,
    "extraThickness": 0,
    "maxDeviation": 0.1,
    "scope": "whole"
  },
  "expectedRevision": 42,
  "requestId": "unique-request-id"
}
```

Call `scan_preview`, then poll `job_get`. Retain its `previewId`. Use action
`compare` with a positive `deviation`, `accept` with optional `createNew:true`,
or `cancel`, supplying `entityId`, `previewId` and normal revision/request guards.
Use a fresh revision for each new mutation. Both GUI-created and MCP-created
previews are controlled by this same operation. Additional references use
top-level `targetIds` on creation. Public requests never carry raw triangle masks
or target coordinates.

For immediate application, call `mesh_process` with
`operation:{kind:"scanTools",operation:{kind:"shrinkwrap",...settings}}`.
Use top-level `targetIds` for whole scope and `createNew:true` to keep the source.
For local scope, set selection using the normal selection tools first, or use
existing triangle isolation. Revision checks, locks, retry protection,
cancellation and history remain shared with other processing jobs.

## Bounds and errors

Whole reconstruction admits at most three million aggregate source triangles,
one billion lattice points, sixteen million output triangles and 500 million
sampling candidates. Local processing admits at most 500,000 selected or
generated triangles/vertices. Fixed seams can retain larger edges than the
requested generated sample spacing; the transition is graded inside the region.
Precision, source-fit, detected sheet-loss, unsafe contour and resource failures
leave the source unchanged. A higher deviation setting is an explicit user
choice; the kernel does not relax it automatically.

## Validation record

Read-only validation used `Z:/scanforge (2).stl`, with 1,998,344 source triangles.
Settings: sample interval 0.5 mm, gap fill 0.5 mm, Organic shape off, added
thickness zero, maximum deviation 0.3 mm, whole scope. Source SHA-256 remains
`d25fb01797575f1824483752e7992f59512fbf58216cc987a6e4ed0aefb48f32`.

The accepted geometry has 8,319,632 triangles and 46 closed components. Streamed
topology verification and a separate exact-Float32-coordinate welding pass both
reported zero boundary edges, nonmanifold edges or vertices, inconsistent winding,
duplicate triangles and degenerate triangles. This is a collection of closed
components, not a claim of one connected solid. The subsequent exhaustive self-intersection audit below found zero intersecting triangle pairs.

| Sampled source-to-result error | ShrinkWrap  | Earlier voxel result |
| ------------------------------ | ----------- | -------------------- |
| RMS                            | 0.006805 mm | 0.312958 mm          |
| 95th percentile                | 0.006497 mm | 0.436371 mm          |
| Maximum                        | 0.256770 mm | 0.517016 mm          |

These are 4,096 deterministic vertex samples, not global bounds. The independent
internal coverage test sampled source-facet corners and centroids: maximum
0.277048 mm, below the requested 0.3 mm. Output-to-source distance includes the
generated backing: RMS 0.888080 mm, 95th percentile 1.250186 mm, maximum
1.273278 mm. Nominal inferred backing depth was 1.25 mm. Rendered overview and
detail comparisons against the original and earlier voxel result were inspected.

The local test selected 32 actual source triangles and preserved all 1,998,312
outside triangles bit-for-bit, with maximum measured source residual 0.000011654 mm.

The intended commit was validated independently from unrelated working-tree edits:

- `npm run build`: TypeScript and production bundle passed.
- Focused Vitest batch: 10 files, 74 tests passed.
- `npm test`: 475 files passed, 15 skipped; 46,473 tests passed, 53 skipped.
- Prettier check: all 46 feature files passed.

Browser validation passed whole, selected and isolated GUI/MCP equality, preview
source preservation, compare/accept/cancel, create-new, error preservation and
undo/redo, with no unexpected failed jobs or page errors. Active MCP-job
cancellation through the GUI shared Cancel operation also passed focused tests.
Browser parity used synthetic fixtures; the full exported STL used the kernel,
independent raw-coordinate topology verification and rendered comparisons above.
All owned browser/MCP helpers exited and their loopback ports closed.

## Self-intersection verification

Whole ShrinkWrap now checks every spatially overlapping triangle pair before
returning an accepted result or retained preview. A conservative BVH broad phase
is followed by adaptive orientation tests with exact BigInt fallback for the
represented Float32 coordinates. Only intersection confined to an exact shared
vertex or edge is permitted; coplanar overlap and crossings are rejected.
Topology checks remain separate: a valid welded vertex fan is still required.
This verifies the represented surface, not source-fit accuracy, one connected
solid, or the intended orientation of nested cavities.

The BVH must have finite bounds and complete, contiguous leaf coverage. Packed
leaf overflow and extreme-coordinate bounds overflow fail explicitly. Processing
is cancellable and bounded to 16 million triangles and 500 million broad-phase
candidate pairs. An interrupted or limited audit never reports a verified zero.

Local wrapping checks all changed-facet pairs and every changed facet against
the unchanged parent. Outside-only pairs are excluded; those results explicitly
report the changed-region scope rather than asserting a globally clean parent.
If all facets are selected, the pair check covers the whole output. Outside
triangles remain bit-for-bit unchanged.

The saved 0.5 mm scan result was audited without changing geometry: 8,319,632
triangles, 313,378,562 broad-phase candidate pairs, 62,045,824 exact narrow-phase
pairs and **zero self-intersections**. Geometry SHA-256:
`b36a68868f6aa5ac5e3d765b46f450da194412f4f07a772368949b345bb04926`.
See [the bounded audit evidence](evidence/shrinkwrap-self-intersections.json).
The final guarded audit completed in 316.86 seconds with a 1,460,412 KiB peak
resident set. It accounted for all 8,319,632 indexed faces. The updated local
STL run tested 1,054 changed-region triangle pairs, found zero intersections,
and preserved all 1,998,312 outside triangles bit-for-bit.

The validation change passed production build, 118 focused tests in 13 files,
and the full suite (46,537 passed, 53 existing skips; 480 files passed and 15
skipped). All 13 changed files pass formatting and scoped whitespace checks.
Browser tests verified whole/local/isolated GUI-MCP parity, verification
diagnostics, preview lifecycle and undo/redo. An intentionally intersecting
local patch produced the same GUI and MCP refusal without changing source or
history. There were no unexpected failed jobs or page errors; all owned
browser/MCP helpers exited and their loopback ports closed.
