# Alignment convergence continuation — 2026-10-29

Five authored rigid cases meet independent accuracy and restart-stability acceptance in native CloudCompare 2.13.2 and current ScanForge: three exact poses, an 80% overlap case with authored unmatched outliers, and a noisy three-axis case. A sixth unsupported-overlap control separates numerical stopping, geometry and application safety. These experiments identified no additional solver defect.

`tests/cloudcompare-convergence.mjs` writes acceptance JSON before execution. Exact cases require corresponding-point RMS≤0.00005 mm, translation error≤0.0001 mm, rotation-matrix Frobenius error≤0.00001 and stricter-restart displacement RMS≤0.00001 mm. Deterministic±0.01 mm noisy coordinates have separate limits: RMS 0.02 mm, translation 0.002 mm, rotation 0.001 and restart 0.00001 mm. Native and ScanForge use all source fitting samples, identical overlap, rigid transforms, no normal or axis constraints. Native RMS-decrease stopping and ScanForge motion/stagnation stopping differ; native lacks the 10 mm distance gate, which does not exclude points in these accepted near-pose cases.

| Case                 | Native correspondence RMS mm | ScanForge correspondence RMS mm | Native / ScanForge restart RMS mm |
| -------------------- | ---------------------------: | ------------------------------: | --------------------------------: |
| Z 2°                 |                   5.10705e-7 |                      1.63732e-7 |                    0 / 3.09536e-8 |
| Three axes           |                   6.33984e-7 |                      1.41428e-7 |                    0 / 7.17955e-9 |
| Z 5°                 |                   5.43131e-7 |                      1.79512e-7 |                    0 / 2.85091e-8 |
| Authored 80% overlap |                   5.10705e-7 |                      1.63732e-7 |                    0 / 3.09536e-8 |
| Noisy three axes     |                   0.01224573 |                      0.01224575 |           1.19838e-7 / 5.52946e-9 |

Metrics use known corresponding indices and separate arithmetic, never solver-reported RMS. Outlier-case correspondence RMS covers the 693 authored inliers; unmatched source points remain present and full-source solver RMS is retained. All accepted ScanForge cases stopped improving with `targetReached:false` because 1e-12 mm is below the Float32/noise floor. Their independent accuracy acceptance passes. These are bounded rigid convergence certificates, not a universal guarantee. Inputs, actual native saved ASC/matrices/logs and executable/input hashes are under [alignment evidence](evidence/cloudcompare-20261029/alignment).

The unsupported control adds 693 far unmatched points and requests 100% overlap. Native returns a stable wrong fit: correspondence RMS 71.10525 mm, translation error 69.89823 mm, restart displacement 3.84895e-6 mm. Independent accuracy rejects it despite stability. ScanForge proposes an accurate inlier transform but returns `insufficientOverlap`, `converged:false`, `applied:false`; application correspondence RMS remains exactly initial. Its 10 mm gate differs from unrestricted native fitting, so refusal policies are not equated. The driver's first assertion incorrectly expected a refused candidate to be inaccurate; failed metrics/assertion remain as `control-initial-assertion*`. Corrected metrics distinguish candidate transform from applied geometry.

## Full original owner scans

Both 120-second native adaptive attempts remain failed receipts. A separately declared 600-second experiment using unchanged geometry, overlap 15%, RMS-decrease 1e-6, requested sampling 20000 and two threads returned in 162.761 s (native ICP 160.41 s), fitting RMS 0.0247007 mm on 7505 final points. This diagnoses the former bound as insufficient for that execution without rewriting its outcome. Explicit 1/20/200-iteration runs returned in 3.232/10.112/73.072 s. Fresh native mesh sampling differs each invocation, so these are cost/behavior probes, not a deterministic iteration trace. Actual initial/final sample counts are retained in native logs; requested sampling 20000 is preserved exactly.

Every 1,375,494 source vertex was independently queried against all 274,154 reference triangles using `three-mesh-bvh`, independent of ScanForge query/RMS. Positions and transformed outputs use Float32. Metrics weight authored vertices, not surface area.

| Full-source independent metric mm |   Initial | Native 20 | Native 200 | Native adaptive | ScanForge 15 |
| --------------------------------- | --------: | --------: | ---------: | --------------: | -----------: |
| Whole-source RMS                  |  1.674207 |  1.672204 |   1.657240 |        1.642032 |     1.674137 |
| Closest 15% RMS, no normal gate   | 0.0241141 | 0.0237891 |  0.0228941 |       0.0223964 |    0.0240590 |
| Closest 15% normal-compatible RMS | 0.0242988 | 0.0239741 |  0.0230607 |       0.0225483 |    0.0242440 |
| Compatible vertices within 10 mm  |    447169 |    446449 |     441495 |          436388 |       447120 |

All rows evaluate full source/full target;15% requires 206325 points. ScanForge uses original source normals,20000 fitting samples, target RMS 0.5 mm and max 3 iterations, preserving existing real regression settings. It reaches that loose target after one iteration. Standalone fit took 152.647 s; fit plus three independent measurements 210.448 s under concurrent native work. This diagnostic does not replace the unchanged 300 s Vitest regression, which separately passed 122.96 s after a retained 371.7 s failure. Native ignores normals. Independent and solver compatible counts differ by 907 vertices; nearest-triangle/normal handling is a possible explanation, not adjudicated equivalence.

Restarting the native adaptive result with the same RMS-decrease 1e-6 and fresh sampling returned in 9.318 s, fitting RMS 0.0249812 mm. Its incremental matrix applied to every Float32 base point gives RMS displacement 0.00348505 mm, maximum 0.00552765 mm. A 20-iteration restart after native 200 moves points RMS 0.00686102 mm. Differences 20→200 and 200→adaptive are about 0.0799 mm RMS each, also confounded by fresh samples. Full-source independent closest15% RMS changes0.0223964→0.0223650mm after that adaptive restart; whole-source RMS changes1.642032→1.641512mm and compatible count436388→436209. These quantify sample-sensitive stability; no retrospective pass threshold is attached to the owner scans.

The [v2.13.2 pinned CCCoreLib source](https://github.com/CloudCompare/CCCoreLib/blob/a8ce4270dfa41d5817842447b27f36094f9dfb51/src/RegistrationTools.cpp#L733) checks absolute per-iteration decrease `lastStepRMS-rms < minRMSDecrease`; RMS increase can also terminate. It is neither absolute residual accuracy nor a relative-RMS ratio. CLI output does not distinguish which internal stop branch returned. Source identity/hash are retained in `native-registration-source.json`; no upstream solver implementation was copied into ScanForge production. REA Windows process capture was unavailable; receipts are direct native execution evidence.

There is no physical correspondence truth for the owner scans. A successful return or stable nearest-surface residual cannot establish physically correct global placement. Establish a trusted coarse pose, request supported overlap, inspect full-source and overlap metrics plus compatible coverage, and use independent landmarks/metrology for an accuracy certificate. ScanForge `targetReached` means its requested overlap residual was met, not global convergence.

Reproduction:

```
node tests/cloudcompare-convergence.mjs
node tests/cloudcompare-owner-native-convergence.mjs 1 20 200 adaptive
node --max-old-space-size=1536 tests/cloudcompare-owner-full-source-comparison.mjs 20
node --max-old-space-size=1536 tests/cloudcompare-owner-full-source-comparison.mjs 200 docs/evidence/cloudcompare-20261029/alignment/owner-ply-full-source-comparison-20.json
node --max-old-space-size=1536 tests/cloudcompare-owner-full-source-comparison.mjs adaptive docs/evidence/cloudcompare-20261029/alignment/owner-ply-full-source-comparison-20.json
node tests/cloudcompare-owner-transform-stability.mjs
```

Later full-source reports reuse initial/ScanForge metrics only after matching both input-file hashes; native metrics are recomputed. Native restarts set `SCANFORGE_NATIVE_INITIAL_MATRIX` to the retained base matrix, then use `rerun200:20` or `rerun-adaptive:adaptive`. Invalid first restart command `-ITER adaptive` is retained separately; corrected execution is the reported success. Original owner files are unchanged. Transient copies are removed only after input-hash receipts.

## Native nonunit-scale preview and cancellation

Numeric pairs A=[(0,0,0),(1,0,0),(1,1,0)] and R=[(1,0,0),(3,0,0),(3,2,0)] first show nonzero rigid-only row residuals. Adjust scale reduces errors below 2.4e-7. Align preview reports scale 2 and RMS 1.55096e-7. Cancel closes its temporary view. Saving that native project then exporting both clouds through a separate native CLI yields byte-identical before/after ASC files; hashes/commands are in `pointpair-cancel-verification.json`. Cancellation after a nonunit preview therefore preserves both input clouds. The main viewport captured white while numeric panel/console rendered; visual preview movement is not claimed. Nonunit Apply geometry, sphere picking and other constraint combinations remain separate untested comparisons. ScanForge remains rigid.

No application behavior changed in this continuation. Existing shared GUI/public-MCP ICP, refusal/publication and history tests remain its MCP coverage; there is no separate agent implementation.
