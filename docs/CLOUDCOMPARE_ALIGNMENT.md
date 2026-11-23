# CloudCompare alignment investigation — 2026-10-28

CloudCompare 2.13.2 native UI and CLI observations support clearer role assignment,
separating common alignment controls from advanced settings, and reporting accuracy
separately from numerical stopping. ScanForge now does those things while retaining
its existing solver and MCP operation. This is a focused improvement, not full
CloudCompare registration equivalence.

## Evidence ledger

All paths below are under [`evidence/cloudcompare-20261028`](evidence/cloudcompare-20261028).
Native UI text trees and screenshots were captured from the installed application.
CLI logs and saved matrices came from separate native processes. REA's Windows
process-capture capability was unavailable; the CLI receipts are direct native
execution evidence, not REA runtime-capture records. The retained
[`rea-core-bundle.json`](evidence/cloudcompare-20261028/rea-core-bundle.json)
provides separate shipped-artifact analysis and its own Evidence IDs/limitations.

| Question                    | Observation and retained evidence                                                                                                                                                                                                                                                                                                          | Status                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Moving/reference roles      | ICP exposes “to be aligned”, “reference”, and a swap action; point-pair registration first asks which entities are to be aligned. `icp-defaults*`, `icp-swapped-roles*`, `point-pair-role-selector*`. Initial selected names must be read, not inferred from filenames or tree order.                                                      | Observed                                                                      |
| Common ICP settings         | The observed GUI has RMS-difference stopping selected, value `1.0E-05`, final overlap 100%, scale adjustment unchecked, and disabled iteration count 20. These are this installed GUI's observed state, not inferred universal defaults. `icp-defaults-0.jpg`, `.txt`.                                                                     | Observed                                                                      |
| Advanced ICP settings       | Research tab shows sample limit 50,000, rotation XYZ, enabled Tx/Ty/Tz, farthest-point removal unchecked, and disabled scalar-field/C2M options for this cloud fixture. Normals show Ignored and are unavailable on the normal-free fixture. `icp-research-defaults*`.                                                                     | Observed                                                                      |
| Result meaning              | Native GUI reports final RMS `1.30248e-06` on 437 points, a transformation matrix, fixed scale 1.0, and theoretical overlap 100%; it warns RMS can be weighted. `icp-gui-result*`.                                                                                                                                                         | Observed                                                                      |
| Point creation              | Separate aligned/reference XYZ tables, numeric “Add aligned point” dialog, scale/rotation/translation controls, align/reset/stop controls, and per-point delta/error columns are present. `point-pair-empty*`, `point-pair-numeric-dialog*`.                                                                                               | Observed; rigid preview/reset/Apply below, other editing remains gated        |
| Minimum/degenerate pairs    | Three moving versus two reference points leaves Align disabled. Three collinear correspondences produce the native registration-failed dialog. `point-pair-unequal-counts*`, `point-pair-collinear-refusal*`.                                                                                                                              | Observed                                                                      |
| CLI stopping/sampling/roles | The inspected official `ccCommandLineCommands.cpp` accepts `-MIN_ERROR_DIFF`, `-OVERLAP`, `-RANDOM_SAMPLING_LIMIT`, `-MAX_TCOUNT`; first loaded entity is moving unless `-REFERENCE_IS_FIRST` is supplied. CLI initialization uses RMS difference `1e-6`, sample limit 20,000, overlap 100%, no scale adjustment, and no normals matching. | Source corroboration plus native executions; differs from observed GUI values |

The official command source is retained locally in the Downloads investigation
folder; its SHA-256 and executable identity are in
[`owner-input-hashes.json`](evidence/cloudcompare-20261028/owner-input-hashes.json).
The installed executable is `C:/tools/CloudCompare-2.13.2/CloudCompare.exe`, SHA-256
`6f79a0e283b06c48e618df145c0a26d0da39c798b19d08c3e934c07e6212172c`.
The UI identifies version 2.13.2, Kharkiv, July 6 2024, 64 bit.

Additional native point-pair observations establish one successful rigid lifecycle.
Three noncollinear pairs A = (0,0,0), (1,0,0), (2,1,0) and
R = (1,0,0), (2,0,0), (3,1,0) show zero row residuals. Align changes the
temporary view and enables Reset; Reset visibly restores the starting preview.
Apply reports RMS 0, identity rotation, translation (1,0,0), and fixed scale 1.
See `point-pair-three-noncollinear*`, `point-pair-preview*`, `point-pair-reset*`
and `point-pair-applied-report*`. Removing A2 offers removal of its equivalent
reference point; accepting Yes removes paired slots and renumbers the lists.
Direct table-coordinate double-click selected a cell without an observed editor;
this is a bounded negative observation, not proof that all coordinate editing is
absent. Remove/recreate is supported (`point-pair-remove-correspondence*`,
`point-pair-four-correspondences*`).

## Known-truth synthetic comparison

The 437-point asymmetric fixture contains an authored two-degree rotation and
translation. Both applications align moving to fixed. The independent comparison
inverts `movingFromFixed` from `truth.json`, checks the stored inverse, applies
each candidate transform with separate arithmetic, and compares corresponding
point indices. Its quality metrics never use either solver's reported RMS.
Input PLY float coordinates are materialized as Float32, matching native import;
the ScanForge result is independently rounded to Float32 output.

| Metric                              |       Before | Native saved result |        ScanForge |
| ----------------------------------- | -----------: | ------------------: | ---------------: |
| Full corresponding-point RMS, mm    | 0.5254430243 |       0.00000139383 |   0.000000802649 |
| Translation error against truth, mm |  0.356230263 |      0.000000769283 |  0.0000000952457 |
| Rotation matrix Frobenius error     | 0.0493628598 |     0.0000000215823 | 0.00000000931853 |

ScanForge used all 437 fitting points, overlap 100%, target RMS `1e-5` mm,
search distance 10 mm, stagnation tolerance `1e-7`, and at most 200 iterations;
it reached its target in three iterations. Different native and ScanForge
stopping/precision paths prevent interpreting the small numerical difference as
a general ranking. Reproduce with
`node tests/cloudcompare-alignment-comparison.mjs`; complete hashes, matrices,
precision details, and limits are in
[`synthetic-alignment-comparison.json`](evidence/cloudcompare-20261028/synthetic-alignment-comparison.json).

## Owner scans: native runs and independent bounded verification

Native CLI runs read staged copies of `ply-2.ply` (moving: 1,375,494 vertices,
2,697,877 faces) and `ply-1.ply` (fixed: 140,113 vertices, 274,154 faces).
Original and staged SHA-256 hashes match. Neither original was modified.
Both carriers load as meshes, so native mesh sampling is part of this workflow.
The separate native GUI was left running without interaction.

Both runs requested RMS decrease `1e-6`, sampling 20,000, two threads, no scale
adjustment, and a 120-second external process deadline. Overlap 85% completed
in 39.89 seconds with native-reported RMS 0.77982 mm over 19,999 final fitting
points; translation length was 2.71933 mm. Overlap 15% hit the external deadline
and produced no registration matrix. Its timeout receipt and partial log are
retained, not treated as successful convergence or a diagnosed numerical failure.
See [`owner-ply-native-summary.json`](evidence/cloudcompare-20261028/owner-ply-native-summary.json)
and the `owner-overlap15/` / `owner-overlap85/` receipts.

For independent checking, 5,000 deterministic unique source vertices were queried
against the **complete** fixed mesh with `three-mesh-bvh`, a different query
implementation from the ScanForge solver. The ScanForge sampled solve used 2,000
fitting samples, at most three iterations, search distance 10 mm, and available
source normals. These are bounded sample results, not full-cloud certification.

| Independent sampled metric, mm         |   Initial | Native 85% transform | ScanForge 15% transform |
| -------------------------------------- | --------: | -------------------: | ----------------------: |
| Whole source RMS                       |  1.670773 |             1.144459 |                1.670785 |
| Closest 15% RMS, without normal gating | 0.0261702 |            0.1115821 |               0.0260371 |
| Normal-compatible points within 10 mm  |     1,626 |                  745 |                   1,626 |

Native 85% improves a broad nearest-surface metric while worsening the tightest
overlap and reducing compatible orientation matches on this sample. That is why
a lower overall RMS alone cannot establish physically correct alignment.
There is no known correspondence truth for these owner scans. ScanForge 85%
refuses unchanged because requested compatible coverage is unavailable; its 15%
request retains the small shared-region fit. Independent compatible 15% RMS
changes from 0.0262620 to 0.0261251 mm. Independent and solver compatible counts
differ by a few points. Nearest-triangle/normal handling is a possible explanation,
not an established cause; the differences remain unadjudicated.
Reproduce with `node --max-old-space-size=1024 tests/cloudcompare-owner-alignment-sample.mjs`.
See [`owner-ply-sampled-comparison.json`](evidence/cloudcompare-20261028/owner-ply-sampled-comparison.json).

**The first full-source ScanForge run failed (subsequently fixed; see Remaining gates).** The parent observed
`tests/fine-registration-ply.test.ts` finish synchronous work after 371.7 seconds
and fail its explicit 300,000 ms timeout. The compact
[`scanforge-owner-full-test-failure.json`](evidence/cloudcompare-20261028/scanforge-owner-full-test-failure.json)
records that parent-reported result; it is not reconstructed raw stdout. The
parent also retained the terminal receipt in
[`full-ply-test-timeout.txt`](evidence/cloudcompare-20261028/full-ply-test-timeout.txt).
That smaller sample did not close the gate; the later unchanged full regression did.

## Focused ScanForge changes and MCP parity

The fine-alignment panel now explicitly identifies moving and fixed roles.
Target overlap RMS and expected overlap stay prominent. Fitting count and maximum
iterations are grouped under Advanced ICP settings; the separate indexed surface
refinement action and its controls are collapsed together. Numerical stopping is
explained separately from desired accuracy. Existing labels remain accessible.

The shared `fineAlignmentInput` rejects the same object as source and target.
The final solver result cannot claim convergence or application when verified
overlap is insufficient, including distance-gated clouds without normals.
Initially insufficient distance coverage may still improve during fitting;
the existing normal-compatible early refusal remains. Refused candidate matrices
and metrics are diagnostic, with no replacement geometry, pose or history step.

Agents use the existing `mesh_process` ICP operation. Its options are optional,
so `operation:{"kind":"icp"}` is valid. Shared application defaults are search
distance 10 mm, 200 iterations, 20,000 fitting samples, 85% overlap, target overlap
RMS 0.5 mm and numerical tolerance 0.00001. GUI and MCP use the same default search
distance constant and application operation. The lower-level numerical solver's
unrestricted default is not the public application default. `targetSampleSize`
remains optional compatibility input and does not decimate the fixed target.
The catalog and agent guide describe the behavior and failure state.

Tests first reproduced incorrect `converged:true/applied:true` on insufficient
coverage and mandatory schema parameters, then passed after the fixes. Unit and
in-process worker/executor tests are distinct from the isolated real browser and
public MCP run. The latter verifies identical GUI/MCP geometry, complete target
matching, all-source/Float32 metrics, Undo/Redo, advanced control access, and
unchanged revision/geometry on normal and distance-overlap refusal. Kind-only
MCP and explicit 10 mm requests produce identical results. No page errors were
recorded. The current-checkout server was isolated on port 5187 because port 5173
served different code; the user's existing scene/server was preserved.
Receipt and screenshots: [`fine-browser/`](evidence/cloudcompare-20261028/fine-browser).

## Remaining gates

- Native point-pair creation, unequal/collinear refusal, three-pair rigid residuals,
  paired removal, preview/reset and Apply have retained observations above.
  Adjusted scale2 preview and coordinate-preserving Cancel are verified in the
  2026-10-29 continuation. Nonunit Apply geometry, sphere picking, correspondence
  reordering/disable semantics, coordinate replacement, noisy per-row residual
  correctness and other constraint combinations remain untested. The bounded
  post-Apply Edit-menu inspection exposed no Undo entry; inverse-matrix recovery
  through Apply transformation is documented upstream but was not tested.
- Native GUI ICP apply/cancel/Undo and negative configurations are not certified
  by a CLI result. Its RMS difference criterion is not ScanForge's absolute
  target RMS or ScanForge's combined motion/stagnation rule.
- The initial native overlap15% runs did not finish within120s. A separately
  declared600s experiment subsequently returned successfully in162.761s; see the
  continuation for full-source metrics and restart stability. The first
  full-source ScanForge regression also timed out; the continuation removed
  duplicate per-query triangle evaluations and the unchanged regression passed
  in 122.96 seconds against its original 300-second deadline. It still evaluates
  all 1,375,494 source points, checks 85% overlap refusal and 15% fitting, and
  verifies unchanged input hashes. See the retained
  [full run log](evidence/cloudcompare-20261028/full-ply-query-dedup-test.log).
  This closes that performance regression gate, not the native timeout or
  physical convergence gate.
- The owner scans have no known physical correspondence truth. Small nearest
  residuals, a successful native return, or a sampled result do not establish
  global convergence or native modeling/registration parity.
- Scale and axis constraints were investigated as native controls; this change
  does not introduce a similarity-transform solver into ScanForge's rigid API.
- Implementation changes use existing ScanForge operations and independent
  numerical code. Upstream GPL source corroborated command names/defaults;
  CloudCompare implementation source was not copied into ScanForge.

## 2026-10-29 continuation

The [convergence continuation](CLOUDCOMPARE_ALIGNMENT_CONVERGENCE.md) records five independently accepted known-truth cases, a stable-wrong native control, successful native original15% adaptive completion under a separately declared600s experiment, full-source independent metrics, restart stability and verified nonunit-scale preview cancellation. Earlier120s failures remain retained. These narrow the remaining gates above without manufacturing physical truth for owner scans.
