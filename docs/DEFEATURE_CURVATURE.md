# Curvature-aware Defeature

The GUI's **Defeature selected area** and MCP's `mesh_process` scan edit use
the same reconstruction operation. Select the entire unwanted feature and its
recessed rim, leaving a clean collar of the original panel around it.

```json
{
  "entityId": "panel",
  "selectionOnly": true,
  "operation": { "kind": "scanEdit", "action": "defeature" },
  "expectedRevision": 12,
  "requestId": "remove-badge-1"
}
```

Set the facet selection with `selection_set` first. Read the current revision
from `project_get`, use a unique request ID, and poll the returned job with
`job_get`. Undo/redo uses the existing history operations. Lock validation,
cancellation, retry protection and the existing two-seam limit are unchanged.
There are no new request parameters. `algorithm` remains the hole-fill option;
it does not select a different Defeature mode.

Reconstruction fits a quadratic height field in a local surface frame using
retained, connected surrounding facets. Deleted feature geometry and its normals
do not influence that fit. The projected rim is triangulated, interior diagonals
are improved, and long interior edges are subdivided before lifting the patch
onto the fitted surface. Small boundary residuals are interpolated to blend the
patch into the exact retained seam. Unselected facets and boundary vertices keep
their coordinates at the application's existing Float32 mesh publication precision.
This is a triangle-mesh reconstruction, not a new CAD surface or a guarantee of
mathematical G1/G2 continuity for arbitrary noisy scans.

Work is bounded to2048 rim vertices,8192 connected support faces,4096 inserted vertices and12 refinement rounds. Diagonal legalization reuses the hole patch's bounded edge queue (at most max4096,64 times the patch facet count candidate visits). Updating only affected edges finishes the triangulation instead of refining long slivers left by24 global flip passes. The normalized sampling density and all existing geometry/process memory limits remain unchanged.
Support collection stops expanding at its budget; a dense collar can still be
fitted. Singular fits, sharp/overhanging collars, unsupported boundaries and
unrecoverable refinement limits fall back to the existing spatial-fill path. Fits require
support RMS error at most 1% of patch radius and rim deviation at most 2%.
The selection should not include an intended crease or span multiple surfaces.
If both reconstruction paths fail, the operation fails without adopting a
partial mesh. Cancellation is propagated rather than treated as a fallback.

The job's existing structured `diagnostics` includes:

| Field               | Meaning                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| `curvaturePatches`  | Number of seams rebuilt using the fitted surface                                    |
| `curvatureFitRms`   | Maximum support RMS across fitted seams, in model units; zero when none were fitted |
| `curvatureFallback` | Semicolon-separated fallback reasons, or an empty string                            |
| `insertedVertices`  | Total new vertices across all filled seams                                          |
| `method`            | Fitted reconstruction when at least one seam used it, otherwise spatial fill        |

Existing removed/pruned triangle, filled-hole and attempt counts remain available.
Mixed outcomes are distinguished by the counts and fallback reasons.

GUI and MCP both default to a 0.001 mm topology tolerance. Tolerant adjacency
does not replace the raw Float32 coordinates of retained, unpruned source
facets. When those corners differ from the generated indexed expansion, the
successor drops its derived adjacency and rebuilds it on the next topology
request, keeping diagnostics consistent after reopening.

The owner-approved real-scan regression is recorded in
[the replacement evidence](evidence/m2-defeature-replacement-20261026.json).
To replay a retained external case, set `SCANFORGE_DEFEATURE_CASE_DIR` before
running `node tests/defeature-curvature-browser.mjs` against a production build.
The directory contains a legacy project `input.json`, zero-based selected facet
indices in `selection.json`, and `manifest.json` with their SHA-256 digests,
the Float32 coordinate digest, triangle/selection counts and the seed center
and normal. The driver verifies those identities before import. Optional
`SCANFORGE_QA_DIST` selects a frozen build; `SCANFORGE_DEFEATURE_OUTPUT` selects
a fresh receipt/screenshot directory. Source scan geometry stays outside Git.

Regression coverage checks known planar, doubly curved, rotated and dense panels,
unchanged retained geometry, reconstructed height, seam facet slopes, mesh winding,
closure, fallback and cancellation. The spatial helper still has its independent
native-reference fixture. `node tests/defeature-curvature-browser.mjs` exercises
the real contextual GUI command and MCP on identical facets, compares their exact
output, checks undo/redo and writes screenshots plus a cleanup ledger under
`.resources/defeature-curvature-browser/`.

A manufactured32768-facet panel with an18425-facet selected patch reproduced the previous refinement-budget/iteration-limit failure. The bounded regression now checks closure, consistent winding, unchanged retained Float32 coordinates and less than0.02mm analytic surface error at patch triangle centroids. This is the same selection size and failure class; the original reported selection remains unavailable and no native comparison is inferred from this manufactured control.
