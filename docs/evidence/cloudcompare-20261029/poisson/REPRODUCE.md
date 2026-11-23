# Full owner scan reproduction

The reference is `C:/repo/alignment-example-files/ply-1.ply`: all 140,113 original points and its original 274,154-triangle scan topology. The original scan is an exchange reference, not physical ground truth. The selected application mesh is open: 7 components and 4,636 boundary edges.

`full-scan-quality-summary.json` records every measured parameter row, source imperfections, fixed acceptance gates, and the exact Node/public-MCP geometry comparison. Failed receipts are retained. Duplicate JSON geometry and failed binary outputs were moved to `.resources/poisson-quality`; `geometry-artifact-locations.json` records their hashes and locations.

The selected configuration is PCA estimation anchored to valid supplied orientations, 24 neighbors, depth 9, point weight 2, samples per node 1.5, and density threshold 7. All 140,113 source points participate; output density trimming removes reconstructed faces. Two invalid source normal anchors are counted, not dropped. Increasing density from 6 to 7 removed unsupported closure while full-source coverage gates remained fixed. Earlier depth/density failures remain in the parameter table.

From the repository root in PowerShell, reproduce into ignored scratch files:

```powershell
$env:SCANFORGE_NORMALS_REAL_PLY = 'C:/repo/alignment-example-files/ply-1.ply'
$env:SCANFORGE_NORMALS_OUTPUT_BIN = '.resources/poisson-reproduction/ply-1-normals.f32'
$env:SCANFORGE_NORMALS_RECEIPT = '.resources/poisson-reproduction/normal-preparation.json'
npx vitest run tests/point-cloud-normals-real.test.ts --silent=false

node scripts/verify-poisson-real.mjs --source C:/repo/alignment-example-files/ply-1.ply --normals .resources/poisson-reproduction/ply-1-normals.f32 --normal-receipt .resources/poisson-reproduction/normal-preparation.json --out .resources/poisson-reproduction --depth 9 --density-threshold 7

node scripts/verify-poisson-quality.mjs --source C:/repo/alignment-example-files/ply-1.ply --mesh .resources/poisson-reproduction/ply-1-depth9-density7-native-normalized-mesh.ply --settings .resources/poisson-reproduction/ply-1-depth9-density7-native-normalized-run.json --acceptance docs/evidence/cloudcompare-20261029/normals/ply-1-quality-acceptance.json --report .resources/poisson-reproduction/quality.json
```

Recheck the durable actual public-MCP export without reconstructing anything:

```powershell
node scripts/verify-poisson-quality.mjs --source C:/repo/alignment-example-files/ply-1.ply --mesh docs/evidence/cloudcompare-20261029/browser/ply-1-public-mcp-mesh.ply --acceptance docs/evidence/cloudcompare-20261029/normals/ply-1-quality-acceptance.json --report .resources/poisson-reproduction/public-mcp-quality.json
```

The analyzer visits every source vertex, reconstructed vertex, and reconstructed face centroid against an independent MeshBVH. Its self-intersection traversal excludes indexed-adjacent faces and classifies proper crossings, coplanar overlaps, and coordinate contacts separately without adding an epsilon. Quantiles weight samples equally and are not continuous Hausdorff bounds. The fixed acceptance file also checks topology and requires a completed intersection analysis.

For native CloudCompare comparison, load the durable vertex-only `ply-1-oriented-input.ply`. Its 140,113 positions and final unit-normal Float32 buffer match the actual application input; the paired `.ply.json` pins hashes and native controls. Record the observed native dialog settings and preserve its untrimmed output before applying density 7. Native import/solver/extraction precision can differ, so this input and passing application evidence do not themselves establish native equivalence.
