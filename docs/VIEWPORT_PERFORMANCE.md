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
- Latest full suite with the owner scans enabled: 29,011 tests passed across 370 files, no skips. An earlier release-history timeout also passed on its focused rerun with the original timeout unchanged.
- Isolated large-scan browser replay: both indices ready; nine shared picker comparisons matched ordinary queries; passive movement submitted zero scene renders.
- The broader MCP browser smoke initially compared the native primary-plane GUI default (Z) against an explicitly requested MCP X axis. That test-input mismatch is corrected: the complete built-app smoke now passes, separately verifying both the captured native Z default and an explicit X choice, matching GUI/MCP bounds, Apply and Undo. Application axis behavior was unchanged.

## Camera gestures before picking-index readiness

The three-owner-PLY replay (6,663,164 triangles, 1183 x 944 CSS pixels, device scale 2, Chrome / NVIDIA RTX A4000) exposed a cold-start stall: an orbit gesture performed ordinary Three triangle intersection while a background index was still pending. CPU samples were dominated by `getVertexPosition`, `intersectTriangle` and the ordinary intersection loop. Background construction alone did not prevent this synchronous fallback.

Camera-only surface-pivot queries now defer until every visible large possible occluder has an index. Until then, mouse orbit retains its existing pivot/controls target and SpaceMouse retains its existing bounds-based fallback. Small scans keep ordinary surface pivots. Large point clouds use the same camera fallback instead of a linear measured-point scan. Once mesh indices are ready, exact surface pivots resume on the next gesture. Object/facet selection and MCP `viewport_pick` retain their exact ordinary fallback; no geometry, clipping or selection result changes.

In the same twenty alternating left/middle orbit and wheel gestures, worst measured frame interval dropped from 400.35 ms to 33.40 ms; median was 16.68 ms and p95 16.84 ms after the change. The original 409/216 ms long tasks were absent; one 50 ms task remained. These are short local hardware measurements, not a guarantee for every device or the embedded browser. Full-resolution rendering was retained. See [three-scan camera evidence](evidence/viewport-navigation-cold.json).
