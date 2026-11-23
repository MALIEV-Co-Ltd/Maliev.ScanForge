# Poisson GUI/public-MCP browser acceptance

On 2026-10-29, `tests/point-cloud-poisson-browser.mjs` passed against the verified current checkout at `http://127.0.0.1:5191`. It uses a disposable real Chrome scene, the public MCP server/bridge, actual application commands, actual processing workers and compiled upstream WASM. The parent-owned server was left running. Existing browser scenes were untouched.

Reproduce with `SCANFORGE_TEST_ORIGIN` set to the current development origin and `node tests/point-cloud-poisson-browser.mjs`. The default includes the full owner PLY1 run; `SCANFORGE_POISSON_REAL=0` runs only the sphere, lifecycle and admission cases. The real source path is currently the local fixture `C:/repo/alignment-example-files/ply-1.ply`.

The original failure is retained as `docs/evidence/cloudcompare-20261029/browser/first-failure-evidence.json`, `first-failure-failure.png`, and `browser-first-failure.log` in the evidence parent directory. Its assertion incorrectly required every processing worker to close, including reusable background topology reports. The corrected observer records an identity and outbound request kinds for each actual worker, forwards native `postMessage`/`terminate` calls unchanged, and requires both termination and a Playwright close event for every `pointCloudPoisson` worker. The passing receipt explicitly records one retained `report` worker while all Poisson workers were closed. No production lifecycle changes were needed.

The complete GUI/lifecycle receipt is [browser/first-full-evidence.json](evidence/cloudcompare-20261029/browser/first-full-evidence.json), with output in `browser-full-final-run.log`. The later focused full-scan/capacity receipt is [browser/completion-evidence.json](evidence/cloudcompare-20261029/browser/completion-evidence.json), also retained as `browser/evidence.json`, with output in `browser-completion-run.log`. These are separate actual runs. Actual checks:

- GUI reconstruction and public-MCP reconstruction of the 1,200-point sphere produce exactly identical expanded coordinates and indexed geometry. Each preserves the original cloud and adds one history entry. Undo removes the new mesh; Redo restores exactly the same geometry.
- Entire-surface density trimming, missing provided normals and missing viewpoint prerequisites fail without scene publication, revision changes or history changes. Explicit outward normal estimation succeeds.
- Three 30,000-point, depth-10 runs are cancelled only after the exact newly created worker reports the native solve stage, before any mesh result. Each worker terminates and closes; source geometry, scene revision, history and object count remain unchanged. Repeating each original request ID returns the original cancellation receipt without launching a worker. A fresh successor succeeds.
- 500,001 points are rejected before Poisson worker construction. A fresh valid successor succeeds. A subsequent focused run completes the 500,000-point boundary, as detailed below.

## Full real-scan result

The public project-import path receives all 140,113 original Float32 positions and raw normals from PLYLoader. The source file SHA-256 is `e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05`. The imported cloud coordinates are independently asserted identical to the original PLY coordinates. The run uses `normalMode: estimate-provided`, 24 neighbors, depth 9, point weight 2, samples per node 1.5 and explicit density threshold 7. Diagnostics retain 140,111 valid normal anchors and two invalid anchors without dropping points.

Public MCP returns a new mesh with 249,999 vertices and 495,378 triangles. WASM heap size is 200,474,624 bytes, with no warnings. Native output normalization merges two exact coordinate aliases and removes four exactly degenerate faces; density trimming removes 40,852 additional faces. The original cloud remains unchanged, one new mesh/history entry is added, and Undo/Redo preserve source and mesh geometry hashes.

The harness downloads the actual public geometry artifact and writes [ply-1-public-mcp-mesh.ply](evidence/cloudcompare-20261029/browser/ply-1-public-mcp-mesh.ply). It invokes the independent `scripts/verify-poisson-quality.mjs` against the original source topology and unchanged [acceptance gates](evidence/cloudcompare-20261029/normals/ply-1-quality-acceptance.json). All 13 gates pass in [the quality receipt](evidence/cloudcompare-20261029/browser/ply-1-public-mcp-quality.json):

| Check                                                     |                 Actual |
| --------------------------------------------------------- | ---------------------: |
| Source vertices to reconstructed surface P95 / P99        | 0.027850 / 0.043905 mm |
| Reconstructed vertices to source topology P95 / P99       | 0.447277 / 0.786901 mm |
| Reconstructed face centroids to source topology P95 / P99 | 0.386168 / 0.706154 mm |
| Components / boundary edges                               |              7 / 4,636 |
| Nonmanifold edges / vertices                              |                  0 / 0 |
| Inconsistent winding / degenerate / duplicate faces       |              0 / 0 / 0 |
| Nonadjacent intersections, including contacts             |                      0 |
| Complete BVH candidate-pair checks                        |             14,896,700 |

The predeclared P95/P99 distance limits are 0.480937/0.961873 mm. The largest measured reconstructed-vertex distance is 1.266250 mm; passing percentile gates is not an all-points maximum-distance guarantee. Seven components and 4,636 boundary edges remain; this is a trimmed open surface, not proof that every hole is repaired or that the mesh is a closed solid. The BVH test uses floating-point predicates and a bounded work budget; this run completes its full budgeted analysis but does not constitute exact-arithmetic geometric certification.

The first independent Node candidate skipped the TypeScript entry's final unit-normal assignment and produced one additional face. Its false exact-array comparison remains in `browser/first-full-evidence.json`. The independent harness was then aligned to the same double-precision normal length calculation followed by Float32 assignment before the native solve. The corrected Node reference has 249,999 vertices and 495,378 faces, and the complete position and triangle-index arrays match the actual public-MCP export exactly, without rounding or sampling. The receipt is [full-scan-node-mcp-array-parity.json](evidence/cloudcompare-20261029/poisson/full-scan-node-mcp-array-parity.json); the focused browser rerun independently asserts the same two exact equalities against `ply-1-depth9-density7-native-normalized-mesh.ply`.

The [real-scan screenshot](evidence/cloudcompare-20261029/browser/ply-1-public-mcp-result.png) now uses the correct `ply-1.ply` source label and shows the mesh with only the test source hidden through public `object_update`, after every source/history/UndoRedo assertion. The original cloud is retained in the scene. This rendered observation supplements the geometry measurements; native same-input/settings comparison remains separate.

## Completed maximum-size solve

The focused completion mode runs after a physical-memory admission guard of at least 1.5 GiB free RAM. Run it with:

```powershell
$env:SCANFORGE_POISSON_COMPLETION = '1'
$env:SCANFORGE_POISSON_CAPACITY = '1'
node tests/point-cloud-poisson-browser.mjs
```

All 500,000 synthetic sphere points and their provided normals are imported through public project/artifact operations. The actual depth-8 public-MCP reconstruction completes with 255,333 vertices and 510,662 triangles, 240,582,656 bytes of WASM heap, one new mesh/history entry, an unchanged full source-geometry SHA-256 and an observed worker termination/close event. The processing worker lives approximately 16.9 seconds; the measured interval including subsequent source checks is 23.1 seconds. The run begins with 12,328,165,376 bytes of available physical memory. These are host observations, not universal resource or timing guarantees.

The native solver emits **�bad average roots: 1�**. This warning is retained in the structured diagnostics. Exact output normalization merges one coordinate alias and removes two exactly collapsed faces, with no density trimming. The run establishes successful execution/publication at the advertised point-count boundary and source/lifecycle preservation; it does not certify topology or geometric quality for this 500,000-point output. The separate 500,001-point pre-worker rejection and clean-successor check remain in the earlier full receipt.
