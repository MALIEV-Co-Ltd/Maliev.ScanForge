# CloudCompare continuation completion — 2026-10-29

The three requested follow-up areas are implemented and validated: general 3D
Poisson reconstruction, complete owner-scan reconstruction quality, and bounded
native alignment/convergence comparison. This record supersedes the open status
from 2026-10-28 without deleting its failed receipts. No commit or merge was made.

## Application and MCP coverage

`mesh_process` now discovers `pointCloudPoisson`. The GUI's **Edit scan →
Reconstruct a 3D surface** submits the same public application job. The shared
worker prepares normals, runs pinned independent upstream PoissonRecon WASM,
performs explicit density trimming and exact output cleanup, and creates one new
mesh/history entry while preserving the original cloud, normals and placement.
Revision checks, request retry receipts, locks, visibility admission, cancellation,
worker termination, Undo/Redo and failure-without-publication are retained.

Normals may be provided or explicitly estimated using existing orientations,
closed-component outward orientation, or a scanner viewpoint. Resource admission
bounds input to 500,000 points, depth to 6–10, WASM heap to 1 GiB and native output
to two million vertices/four million triangles. Application/JavaScript memory is
additional. The 500,000-point public-MCP solve completed; 500,001 points were
rejected before worker creation. The capacity run's upstream warning is retained.

The actual browser tests verify exact GUI/MCP sphere geometry, source preservation,
one history step, Undo/Redo, three cancellations during the actual native solve,
retry protection, worker closure, invalid normals/viewpoint/empty trim recovery,
visibility rejection and a successful successor. Read
[browser acceptance](POISSON_BROWSER_ACCEPTANCE.md),
[agent usage](AGENT_GUIDE.md#general-3d-poisson-point-cloud-reconstruction),
[shared architecture](MCP_ARCHITECTURE.md) and
[engine/build provenance](POISSON_BROWSER_ENGINE.md).

## Complete real scan quality

All 140,113 points from the original `ply-1.ply` participate. No point sampling or
dropping replaces the full-scan gate. Two invalid normal anchors are counted;
normal estimation uses the valid original orientations. The selected depth-9,
density-7 configuration produces 249,999 vertices and 495,378 triangles through
the actual public-MCP browser worker. Every coordinate and triangle index matches
the independently prepared Node engine output exactly.

Independent `three-mesh-bvh` measurements evaluate all source vertices, all output
vertices and all output face centroids against continuous target triangles. The
fixed P95/P99 limits are 0.480937/0.961873 mm, derived from source spacing before
output selection. Failed depth/density rows remain recorded.

| Full-scan check                                   |                 Actual |
| ------------------------------------------------- | ---------------------: |
| Source vertices → output surface P95/P99          | 0.027850 / 0.043905 mm |
| Output vertices → original topology P95/P99       | 0.447277 / 0.786901 mm |
| Output face centroids → original topology P95/P99 | 0.386168 / 0.706154 mm |
| Nonmanifold edges/vertices                        |                  0 / 0 |
| Inconsistent/degenerate/duplicate triangles       |              0 / 0 / 0 |
| Nonadjacent intersections, including contacts     |                      0 |
| Complete intersection candidate checks            |             14,896,700 |
| Components / boundary edges                       |              7 / 4,636 |

The largest measured reverse vertex distance is 1.266250 mm. Percentile acceptance
does not certify a maximum Hausdorff bound or physical scanner accuracy. The
result is an open, trimmed surface, not a watertight solid. The original reference
also has topology defects; these were measured independently and do not excuse
output defects. Full receipts, failed parameter rows, binary meshes, input hashes
and reproduction commands are in the
[quality summary](evidence/cloudcompare-20261029/poisson/full-scan-quality-summary.json)
and [reproduction guide](evidence/cloudcompare-20261029/poisson/REPRODUCE.md).

The installed native CloudCompare plugin was also run on the exact oriented full
input with matching exposed depth/weight/sampling/boundary settings. Raw native
output does not pass the same open-surface quality gates. Applying the explicitly
recorded common exact cleanup and density-7 postprocess yields a passing native
comparison. This postprocess is scripted; it is not a claim that native GUI
trimming was exercised. Released CloudCompare wrapper source indicates FEM
degree 1, while ScanForge uses degree 2 from upstream 18.76. Internal solver/version
differences and different geometry counts preclude exact native equivalence.
The [native full-scan report](evidence/cloudcompare-20261029/poisson/native-cloudcompare/README.md)
retains GUI controls, raw/native project exports, the failed raw quality receipt,
the successful explicit postprocess and pinned-source inference limits.

## Native alignment and convergence

Five known-transform cases pass independent full-correspondence accuracy and
stricter-restart acceptance in both installed native CloudCompare and ScanForge,
including deterministic noise and authored unmatched outliers. The unsupported
overlap control exposes a stable but inaccurate native fit; ScanForge correctly
refuses publication. Numerical stability alone is not treated as accuracy.

The native 15% owner-scan adaptive run completes in a separately declared
162.761-second experiment; earlier 120-second timeouts remain failed receipts.
All 1,375,494 moving vertices are independently measured against all 274,154
reference triangles. Restart displacement is measured rather than assumed zero.
Native nonunit-scale preview/cancel also preserves both clouds byte-for-byte.
Read [alignment convergence](CLOUDCOMPARE_ALIGNMENT_CONVERGENCE.md) and its
[structured validation](evidence/cloudcompare-20261029/alignment/validation-summary.json).

Owner scans have no physical correspondence ground truth. These completed
comparisons establish bounded algorithm behavior and measured stability, not
physical global registration accuracy or closure of unrelated milestone gates.
Native nonunit Apply, sphere picking and other unrequested constraint combinations
remain outside these acceptance claims.

## Verification and preserved workspace

Focused Poisson/application checks pass, including the added visibility refusal
regression and late cancelled/conflicting worker-result refusal. Fresh independent
review found no remaining actionable issue in the scoped implementation. Production
build and type checking pass; build-time provenance verifies generated JS/WASM,
native adapter, recipe and retained upstream/runtime notices.

An actual compiled-worker test mounted the production application at `/scanforge/`.
It first exposed the incorrect asset path under `assets/`; that red receipt is
retained. The corrected loader passes both development and compiled nested-path
execution with the expected 7,976-triangle sphere output. See
[production browser verification](evidence/cloudcompare-20261029/poisson/production-browser.json).

The full repository suite ran twice: 49,108 tests passed and 68 were skipped;
one existing failure remains in `generated-icons.test.tsx` because the unrelated
`MeshOperationResult.tsx` imports `lucide-react` instead of generated artwork.
It is recorded rather than represented as a green full suite. The final focused
run additionally covers the late-result test added after those full-suite runs.
Unrelated working changes and the existing port-5173 browser scene are preserved.
Native desktop access was explicitly coordinated with the M2/M5 tasks.
The pre-existing original-STL coordinate validation test received an explicit
array type annotation to resolve an implicit-any compilation error; runtime
behavior is unchanged. A separate concurrent global-initialization type failure
is retained in the first build log and was resolved by its owning work before
the successful final build.
