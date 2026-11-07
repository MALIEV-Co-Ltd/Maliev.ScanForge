# Defeature and persistent topology

The current default first attempts the [curvature surface extension](DEFEATURE_CURVATURE.md), then uses the spatial fallback described here. The observed native comparison below binds that spatial helper and its historical default, not the current fitted patch topology.

Defeature now uses the recovered spatial advancing-corner fill path rather than the general projected hole filler. The port preserves pre-edit angle-weighted vertex normals, chooses the smallest valid oriented corner, uses the recovered 75-degree/chord branches and cubic midpoint step, and bounds each fill loop at 10,000 iterations. It retains the largest marked component by triangle area, preserves unrelated components, and makes at most two boundary-fill attempts.

Facet deletion and insertion reuse indexed vertices and update existing edge uses. Derived component and boundary summaries refresh after edits; vertices are compacted without spatial welding. Normals refresh between fill attempts. The published successor includes valid indexed topology, so diagnostics and selection actions reuse it immediately.

One selected-geometry worker owns the cache until the geometry is disposed, replaced externally, cancelled or the page closes. Successful edits adopt the successor geometry and transfer a separate output copy; transfer cannot detach cached buffers. A failed edit cannot replace the canonical input with temporary geometry. Requests retain the two-minute inactivity and fifteen-minute hard execution leases; there is no arbitrary 60-second idle cache expiry or background worker pool.

## Observed native comparison

The native application and browser implementation used the same deterministic noisy annular STL (96 triangles) and the same 16 selected facets. A native selection export was checked against the exact Float32 triangle coordinate sets before defeature. The observed native output is stored as a neutral regression fixture in `tests/fixtures/defeature-annular.json`.

- Both outputs contain 100 triangles, including 20 new patch triangles and five inserted vertices.
- Both retain one outside boundary, with zero nonmanifold edges and zero winding conflicts.
- All 80 retained triangles remain unchanged.
- Triangle coordinate sets match at 0.00001 mm precision. Maximum symmetric nearest-vertex distance is 0.000000238419 mm.
- Cached output contains 65 referenced vertices, without orphaned deleted-patch vertices.
- Warmed defeature and successor analysis emit no welding or adjacency-building stages.

Input STL SHA-256: `58fc9e3ebc25559a3963580529fe6645cb26afb963287803c0c1d48cf96cedd6`.
Native output STL SHA-256: `8f1a32ddfec66e7a8b4e061a0e0ec37a0f431e67c739e44630ae2c57b1423561`.

Raw native evidence, exports, analysis tools and runtime ownership records remain outside the application repository. This confirms the named fixture; it does not establish universal numerical parity or the exact result of the earlier screenshot's 18,425-triangle selection. That selection was not supplied as reproducible data.

## Validation and deliberate safety boundary

The build/type check passes without warnings or errors. Focused coverage checks native geometry, exact selected facets, two boundary attempts, marked-island pruning, untouched unrelated components, indexed compaction, cancellation, successor buffer transfer, reuse after failure and geometry disposal. The full application suite and formatting checks are run before committing this slice.

The native core may return true before a loop is fully closed. The application explicitly checks completion and retains the original mesh on an incomplete patch instead of publishing false success. Progress stays operation-specific and reaches 100% only after successful publication. Existing error-banner styling is retained.
