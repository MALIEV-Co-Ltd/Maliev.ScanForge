# Large-scan viewport responsiveness

Viewport surface queries use a disposable, indirect triangle BVH prepared in a background worker. Canvas selection, orbit-pivot picking, pick-through and MCP `viewport_pick` query the same display objects. This changes query cost, not geometry, triangle numbering, clipping rules, history or the public tool schema.

The build starts when display geometry is installed and is serialized across the viewport. Live positions and indices remain attached; only private copies are transferred. Meshes below 10,000 rendered triangles retain ordinary picking. The worker terminates on completion, failure, geometry disposal or its 120-second lease. Replacing geometry cancels obsolete queued/active builds and releases its index. Before readiness, or if a worker fails, ordinary picking remains available. Clouds continue to use measured-point picking.

Passive pointer movement updates the navigation cursor without submitting a full scene. Button drags, touch navigation, origin-plane highlighting and sketch/selection overlays retain their redraw paths. Explicit MCP viewport presentation remains available.

## Measured owner-scan scenario

Chrome, NVIDIA RTX A4000, 1183 x 944 viewport, owner `ply-1.ply` and `ply-2.ply`, 2,972,031 triangles. Same camera and geometry before/after; full-resolution rendering retained.

| Measurement                                                       |   Before |     After |
| ----------------------------------------------------------------- | -------: | --------: |
| Median surface query, five samples                                | 166.1 ms |    0.2 ms |
| Render submissions during 30 passive pointer moves                |       60 |         0 |
| Shared agent-picker comparisons against ordinary triangle queries | baseline | 9 matched |

All nine comparisons preserve hit count, entity IDs and triangle indices; world coordinates agree within 1e-9 mm. Unit coverage additionally checks clipping, transforms, hidden triangle indices, cancellation, serialized construction, cache reuse and worker failure fallback. This measures surface-query latency after index readiness, not end-to-end frame rate or geometry-processing speed. Initial index construction and point-cloud query performance are separate costs.

Machine-readable measurements: [viewport responsiveness evidence](evidence/viewport-responsiveness.json).

## Validation record

- Build passed with no warnings or errors.
- Focused viewport/navigation tests: 139 passed.
- Full suite with the owner scans enabled: 29,009 passed, one existing release-history test exceeded its unchanged 5-second timeout. Rerun: 20 release-related tests passed.
- Isolated large-scan browser replay: both indices ready; nine shared picker comparisons matched ordinary queries; passive movement submitted zero scene renders.
- The broader MCP browser smoke still fails at its reference-alignment GUI/MCP bounds assertion, before its viewport-picking check. A separately built comparison with only the viewport changes removed reproduces exactly the same bounds mismatch. This alignment issue remains unresolved; the complete browser smoke is not claimed passing.
