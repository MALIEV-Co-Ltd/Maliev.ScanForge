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

Work is bounded to 2048 rim vertices, 8192 connected support faces, 4096 inserted
vertices, 12 refinement rounds and 24 diagonal-improvement passes per round.
Support collection stops expanding at its budget; a dense collar can still be
fitted. Singular fits, sharp/overhanging collars, unsupported boundaries and
refinement limits fall back to the existing spatial-fill path. Fits require
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

Regression coverage checks known planar, doubly curved, rotated and dense panels,
unchanged retained geometry, reconstructed height, seam facet slopes, mesh winding,
closure, fallback and cancellation. The spatial helper still has its independent
native-reference fixture. `node tests/defeature-curvature-browser.mjs` exercises
the real contextual GUI command and MCP on identical facets, compares their exact
output, checks undo/redo and writes screenshots plus a cleanup ledger under
`.resources/defeature-curvature-browser/`.
