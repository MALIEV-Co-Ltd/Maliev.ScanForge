# Large-scan viewport responsiveness

Viewport surface queries use a disposable, indirect triangle BVH prepared in a background worker. Canvas selection, orbit-pivot picking, pick-through and MCP `viewport_pick` query the same display objects. This changes query cost, not geometry, triangle numbering, clipping rules, history or the public tool schema.

Worker replies transfer only BVH roots and the indirect facet mapping. The receiver preserves the live geometry index, so replies omit the disposable construction index. An original-data diagnostic measured 35,664,372 bytes of unused index replies across the first two scans; omitting them reduces transport volume, while peak-memory impact requires a separate guarded replay.

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

## Viewport responsiveness after alignment

The full-scan replay exposed UI-thread stalls after accepting landmark alignment. Periodic backup encoding revalidated indexed topology and packed every current/history geometry buffer on the main thread. Selecting newly aligned geometry also calculated full mesh statistics. Rendering itself stayed near 60 FPS between these stalls.

Project backup, GUI Save and MCP `project_export` now share a serial background encoding lane. It uses the same lossless encoder, never transfers authored/history buffers, preserves native cloud placement across structured cloning, and releases each worker on success, failure, page exit or its two-minute lease. Errors reject the operation without replacing an existing successful backup. Non-browser hosts retain the local encoder. Structured cloning still copies the snapshot; this change does not promise zero-copy storage.

Indexed mesh landmark alignment prepares its existing weld-based display normals, bounds and statistics in the processing worker. The main thread caches the transferred display data against the exact output buffer identity. Metadata and selection changes reuse it; replacement geometry receives a different cache entry. Numerical registration, authored normals, topology and saved geometry are unchanged.

[Recorded replay](evidence/viewport-post-landmark-performance.json): all three complete owner scans, 6,663,164 triangles, isolated Chrome, 1183 x 944 CSS pixels, DPR 2, NVIDIA RTX A4000. After accepting landmark alignment, the profiled worst frame dropped from 617.225 ms to 33.360 ms; the final replay recorded one 50 ms long task. Median frame time remained 16.68 ms. A separate unprofiled baseline caught a 183.485 ms frame. These are short local measurements with independently timed backup intervals, not a universal performance guarantee.

Validation:

- `npm run build` builds the browser worker and offline manifest.
- Focused project encoding, recovery, cloud placement, processing-client and display-cache tests cover byte parity, shared history, lazy cloud coordinates, failures, cancellation, finite leases and cache replacement.
- `node tests/project-encoding-browser.mjs` compares worker/local file bytes, checks cloud poses and attached authored buffers, rejects invalid geometry, verifies queue recovery and worker release.
- Set `SCANFORGE_ALIGNMENT_EXAMPLES=B:/temp/alignment-example-files`, then run `node tests/viewport-post-landmark-browser.mjs`. This optional real-data test verifies source hashes/counts, public MCP export, public landmark preview/accept, camera gestures, browser errors and a 100 ms maximum-frame budget on the test machine. CPU profiles, screenshots and resource ledgers remain in ignored `.resources/`.

This fixes the measured post-alignment viewport stalls. Full import, modeling and native algorithm verification remain separate workstreams.

## Imports and speculative topology preparation

The original full three-PLY import diagnostic found the second scan's speculative
topology preparation still running while the third scan imported. The Job reported
a memory-limit event. GUI and MCP scan imports now share an import lease: before
creating an import worker, they yield preparation that has no foreground owner.
Scheduled preparation waits until all active imports finish. A foreground diagnostics
observer or queued topology consumer retains its preparation; stateful previews keep
their owning worker. After an import fails or is cancelled, preparation of the same
selected source can resume under its existing lease. Disposal and replacement cancel
that retry. Import completion callback exceptions reject the import, releasing the
lease. Public parameters, schemas, geometry and history semantics are unchanged.

The repeated original-file diagnostic confirmed that the speculative topology worker
terminated before the third import worker started, with preparation reported as
`scheduled` during import. It still hit the unchanged 2 GiB Job limit. Reported Job
peaks were 2,244,792,320 bytes before the change and 2,254,524,416 bytes afterward;
both observations ended at a memory-limit failure and do not establish a reduction
in peak memory. Full three-scan import and native alignment equivalence remain
unverified.

Validation for this change passed the source build and 66 focused tests.
`tests/parallel-import-browser.mjs` passed GUI parallel import with two workers,
three objects and three undo steps, plus MCP progress and cancellation, with zero
active import workers or browser errors afterward. `tests/global-alignment-browser.mjs`
passed Preview, Cancel, cached Apply, Undo/Redo and timeline checks using two synthetic
STL scans of 5,120 facets each. These browser checks cover shared workflow behavior;
the original full-scan memory failure remains open.
