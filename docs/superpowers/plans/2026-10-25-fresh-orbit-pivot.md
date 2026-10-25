# Fresh orbit pivot correction

User reported incorrect mouse/frame rotation centers. Root causes: stale
mouseOrbitPivot reused on misses, plus no rendered-depth navigation fallback for
large point clouds. Fix shared Viewport and navigation-depth; retain fixed pivot
within a gesture but resolve a fresh pointer/frame surface or camera target for
each gesture. MCP rotate coordinates share the fallback and existing state.

Verification: regress stale pivot and >30k-point routing before editing; cover
point material size, clipping, renderer restoration and GPU resource disposal;
run real GPU/browser meshes and large clouds in main/fixed/moving, ortho and
perspective; compare mouse/MCP orbit and empty-frame behavior. Preserve unrelated
working-tree changes. Full repository tests and million-point performance
benchmarks are outside this focused bugfix verification.

Completed validation: 28 focused Vitest files / 341 tests passed; application-only
TypeScript passed; final Vite bundle/offline manifest passed. Real GPU browser
passed 20,736-triangle unready-index mesh cases and six large-cloud view/projection
combinations, including mixed-scene occlusion, sampling-hidden foreground points,
sprite-edge pivots, pointer/frame fallback and GUI/MCP drift below 0.0001 mm.
Landmark canvas browser regression also passed. Review findings about log depth
and stable sampling were corrected and final read-only review was clear. Full
project TypeScript remains blocked by unrelated untracked automation-api-owner
contract tests; no changes made to that work. Evidence:
docs/evidence/fresh-orbit-pivot-20261025.json.

## Clarified off-model fallback

Owner clarified that pointer misses must use screen center at model depth, not
visible-model center and not historical camera-target depth. Added shared
navigationFramePoint: center surface if present, otherwise center ray/plane
intersection at cached visible bounds center depth. Both mouse misses and MCP
coordinate-free/missed-coordinate rotation use it. On-model picking is unchanged.
Regression tests reproduce target z=0 versus off-center model z=-20 and validate
rotated/panned cameras. GPU tests now deliberately set target z=9 while model
bounds depth is z=0 or z=0.5, in all three views and both projections.

Final validation: full npm build passed (including TypeScript), 16 targeted test
files / 262 tests passed, both surface-orbit and landmark-canvas browser checks
passed, and read-only review found no issues. No full-suite or million-point
benchmark rerun. Evidence: docs/evidence/frame-model-depth-20261025.json.

## Dense cloud pointer-hit regression

Owner screenshot showed an inside-cloud pointer still falling back to frame
center. Reproduced with a regular 40,401-point grid at default pointSize=1:
fixed/perspective pointer(0.37,0.57) wrongly produced screen pivot(0.5,0.5).
Earlier tests with larger sprites missed this pixel-gap case.

Added nearest rendered depth within 6 CSS pixels, prioritizing exact hits and
unprojecting on the original pointer ray. All cloud sizes use the same GPU path;
mesh-only exact picking and off-model frame/model-depth fallback are retained.
Crop extent includes both tolerance and sprite width; readback remains bounded
to the local neighborhood. Shared GUI/MCP behavior and docs updated.

Validation: full npm build passed; 16 focused files / 263 tests passed; 18 dense
pointer cases across main/fixed/moving and both projections passed for GUI and
MCP. Existing mesh, mixed-scene, adaptive sampling, sprite-edge and off-model
cases passed. Landmark canvas regression passed. Screenshot inspected.
Evidence: docs/evidence/dense-cloud-pointer-pivot-20261025.json. No full suite or
million-point performance benchmark rerun.
