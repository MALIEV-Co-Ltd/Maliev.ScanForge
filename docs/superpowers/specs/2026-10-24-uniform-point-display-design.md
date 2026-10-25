# Uniform adaptive point display

**Status: reverted at the user's request.** The grid produced an unwanted flat
appearance. The application again uses stable adaptive vertex sampling, enabled
by default at 100% density, with no display displacement. The design below is
retained as historical context, not the current application contract.

User request: keep Auto off at full source resolution, default Auto density to
100%, and replace randomly thinned noise with a uniform detail-oriented display.
This refinement supersedes the vertex-ID hash described in the earlier adaptive
display spec. Explicit saved density choices remain unchanged.

Use a regular screen grid for dense projected geometry. Cell spacing is
`(pointSize + 1) * sqrt(100 / density)` CSS pixels. All source points contribute
to their projected cell center while retaining their original clip depth; for
opaque clouds the ordinary depth test retains the front surface. Align centers
to physical pixel centers to avoid MSAA spreading a small dot across neighboring
pixels. The grid appears only where the projected budget is lower than the source
count; sparse and near-plane cases retain full display.

This is a display approximation, not destructive resampling: authored XYZ, RGB,
hidden slots, selection, measurements and exports remain intact. The display can
move a point by half a cell plus half a device pixel on each screen axis. Turning
Auto off disables this displacement. Thin features can merge within a cell;
increase density or zoom, or use full display for exact inspection. Transparent
clouds retain normal blending/depth semantics and are not promised one opaque
surface sample per cell. No new scan-sized buffers, indexes, CPU scan traversal,
or GPU render targets are introduced. Submitted vertex counts are unchanged.

MCP uses the existing `object_update` settings. `object_get` reports effective
100% defaults. `viewport_get.pointCloudDisplay` reports `samplingMethod`, CSS
`cellSizePx`, and radial `maxScreenOffsetPx` including device-pixel alignment.
Existing count/fraction fields are projected budget estimates, not selected
source vertex counts. Shared validation, codecs, retries and history continue
unchanged. The GUI and MCP use the same default constant and renderer.

Validation: unit tests cover defaults, grid spacing, density, full mode, poses,
hidden indexing, near-plane fallback and device-pixel displacement. Browser tests
check a dense flat patch for occupied interior screen cells, exercise GUI/MCP
changes, compare Auto/full display, retain exact source geometry, and inspect an
actual ASC import from the bottom view. Recorded results are in
`docs/evidence/uniform-point-display-20261024.json`.
