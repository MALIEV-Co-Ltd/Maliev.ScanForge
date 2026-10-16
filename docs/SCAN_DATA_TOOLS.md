# Scan Data Tools

This independently implemented MVP uses installed reference help and
localization as workflow evidence, not as evidence of recovered native algorithms.
The reference manual page 24 describes reduction targets; pages
243–244 describe reconstruction of overlapping scans and closing holes/gaps.
The reference localization describes averaging overlapping meshes and cylindrical unroll.
Reduce Noise now uses the extracted native kernel with retained fixture comparisons; see [MESH_PARALLELISM.md](MESH_PARALLELISM.md). Other tool algorithms remain independently chosen. Reduce polygons percentage targets are verified separately in [NATIVE_POLYGON_REDUCTION.md](NATIVE_POLYGON_REDUCTION.md). See
[the native verification record](NATIVE_VERIFICATION.md) for recovered functions,
trace evidence and the remaining verification requirements.

## Available operations

| Tool            | Parameters and behavior                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reduce polygons | Target triangle count, retained percentage, or deviation (0.05 mm default). Interior edge collapse protects boundaries, sharp creases and manifold topology. A protected mesh may stop above the requested count; the result reports this.                      |
| Reduce noise    | Iterations (1 default), selection only, boundary smoothing (enabled by default), and optional original-surface deviation comparison (0.05 mm default). Vertices incident to selected facets move, including shared seam vertices; unmarked vertices stay fixed. |
| Scale mesh      | Factor or percentage about a configurable XYZ center, default world origin. Factor normalization follows the instruction-verified Float32 input path; see [NATIVE_SCALE_INPUT.md](NATIVE_SCALE_INPUT.md).                                                       |
| Flip normals    | Reverses every triangle's winding.                                                                                                                                                                                                                              |
| Re-polygonize   | Voxel reconstruction, point resolution 0.5 mm default. Fuses nearby/overlapping regions and creates a closed surface, rather than simply subdividing triangles.                                                                                                 |
| Average mesh    | Equally averages source vertices with nearby reference mesh surfaces, search tolerance 10 mm default. Unmatched vertices remain unchanged. Meshes must already be aligned.                                                                                      |
| Mirror mesh     | XY, YZ, XZ origin plane or planar CAD/construction object, selected from the list or canvas. Reverses winding after reflection.                                                                                                                                 |
| Unroll          | Cylinder reference from the list or canvas; angular offset 0 degrees default. Maps circumference and axis into local XY, retaining radial error in Z and splitting at the angular seam.                                                                         |

The deviation reduction mode conservatively bounds non-planar vertex movement
from original provenance; it is not a certified Hausdorff distance measurement.
Exactly planar patches can collapse without changing their surface perimeter.
Noise deviation is a comparison threshold, not a displacement limit. Original vertices are compared against the smoothed surface; samples beyond five times the threshold are unmatched.

Re-polygonize accepts optional additional aligned raw mesh objects and verifies closed manifold output, reporting separate component counts through GUI status and MCP diagnostics. See [watertight workflows and native evidence](WATERTIGHT_MESH.md). Additional inputs remain unchanged.

Reconstruction can move the surface by approximately 0.75 times the point
resolution, fills enclosed cavities, and gives open scans a closed thick shell.
These consequences appear in the panel before Apply. It is unsuitable when an
existing internal cavity or zero-thickness open sheet must remain exact.
Unroll requires cylindrical side surfaces: end caps, axis-crossing faces and
faces spanning 180 degrees or more are rejected rather than silently discarded.

## Ownership, bounds and recovery

Operations execute in the existing mesh worker, with progress, cancellation,
finite leases and copied transferable buffers. Errors preserve source geometry.
Successful Apply creates one model history step; Undo restores the input and
removes stale result text. Geometry changes invalidate old normals, selection
indices and scan-source metadata. Exact CAD bodies require an explicit separate
mesh copy and retain their kernel body.

Smoothing accepts up to 500,000 faces. Reduction uses bounded spatial patches above that size instead of an input-count cap; reduction also has a finite
collapse work budget. Reconstruction accepts up to 1,000,000,000 lattice points using compact bitsets,
3,000,000 aggregate input faces and 16,000,000 output faces. Surface-local sampling
and streamed topology verification support finer spacing without sampling all empty space. Transforms accept up to 3,000,000 faces; averaging bounds
both reference count and aggregate input. Oversized work fails with a message,
without silently lowering the user's requested resolution.

## Validation (2026-10-12)

- Production build passed with zero warnings/errors. Full Vitest suite passed:
  7,288 tests in 148 files, including concurrent import-origin regression tests.
- Geometry coverage includes protected topology, deviation bounds, selection
  isolation, reconstruction closure/gap fusion, averaging nearest surfaces,
  mirror winding, cylinder seam/cap rejection, finite Float32 output and collapse
  precision failures. Reference tests reopen serialized projects; worker tests
  cover nested input ownership and real dispatch.
- Browser checks on manufactured project meshes verified count 72 → 50,
  retained 50% 72 → 36, deviation reduction 72 → 24 with a protected-stop
  explanation, whole/selected smoothing, factor-2 scale, normals, averaging,
  origin/custom mirror planes, canvas reference selection preserving the source,
  0.5 mm reconstruction and cylinder unroll. Undo restored original geometry.
  Browser warning/error logs were empty.
- Proof: `.resources/scan-data-tools-verified.png` (local QA artifact).
- `npm run test:cad`, `npm run format:check` and `git diff --check` passed.
  Temporary browser tabs and both QA server processes were closed and their
  exits verified. The existing user preview was preserved. Nothing was pushed
  or deployed.

This completes the requested bounded Tools slice, not the wider reverse
engineering goal. Full-resolution gigabyte processing and native algorithm
parity remain outside this validation.
