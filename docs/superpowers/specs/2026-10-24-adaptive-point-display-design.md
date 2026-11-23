# Adaptive point display

Approved direction: Auto density enabled by default, adjustable display density,
and existing manual point size. Reduce visual crowding when zoomed out and restore
detail when zoomed in. Original points, selection, processing and export remain intact.

Approaches: smaller raster points alone cannot reliably overcome hardware minimum
sizes. A full spatial LOD hierarchy requires additional scan-sized storage and
preparation. Use a deterministic GPU sample controlled by projected cloud bounds
instead: bounded CPU work per cloud, no scan-sized copy, stable nested samples.
This is an approximate density control, not a guarantee of one point per pixel.

Implementation calls: per-cloud `pointAutoDensity` defaults true; `pointDensity`
is 10–100 percent, default 50. Expected display budget is projected bounds area
times density / 100 / (pointSize + 1)^2, with a 256-point floor (or all for smaller
clouds). Camera near-plane intersections conservatively show all points. Keep
point size at its existing 1–10 px range. GPU rejection uses original vertex IDs,
preserving RGB/hidden-point indexing and deviation colors. Picking and editing
continue to address the full visible source geometry. Density does not promise
preservation of every tiny or sparsely sampled feature; disable Auto density for
full point display. Avoid CPU traversal or geometry reallocation on camera changes.

GUI and MCP use `object_update` for the same fields and validation. `object_get`
returns defaults and `viewport_get.pointCloudDisplay` returns current source count,
sampling fraction and estimated drawn count. Persist settings across project
codecs, backups and modeling undo; retain existing retry/revision/lock semantics.
