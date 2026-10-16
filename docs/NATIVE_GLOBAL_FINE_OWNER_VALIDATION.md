# Whole-scan evaluator validation and native routing

This extends the [evaluator implementation evidence](NATIVE_GLOBAL_FINE_ALIGNMENT.md). It does not enable public Global Fine Align or establish complete registration parity.

## Whole-scan facet normals

The original facet task `0x140b35d90` executed over all 6,147,454 faces in the three retained coordinate carriers from the earlier native datum capture: 273,139, 2,547,405 and 3,326,910 faces. The bulk adapter rebinds only the CRT square-root thunk and supplies bounded face/vertex containers. It first checks 41 nonempty prior cases; its reported 42-case inventory includes one zero-face case skipped by that bulk adapter. The separate application fixture covers that empty case.

The application replay compares every Float32 normal byte and every degeneracy byte in 65,536-face chunks, checks complete carrier/output SHA-256 digests, and confirms degeneracy counts of zero, one and zero respectively. All three replay tests passed. The [fixture](../tests/fixtures/global-fine-owner-facets-native.json) binds the retained carriers and output digests. This slice did not freshly recheck the original source files; recorded original file hashes are provenance rather than a current identity assertion. The retained STL header normals are not used as a recomputed-facet oracle.

The optional regression requires `SCANFORGE_NATIVE_FACET_ORACLES` pointing to the external `global-fine-owner-facet-v1` capture directory. It retains no owner geometry in Git and requires 3072 MiB free memory before each case. Handles close in a finally block. Without that directory, its three cases explicitly skip.

## Largest retained index capacity

An instrumented Node diagnostic prepared the 3,326,910-face retained carrier using the existing producer and unmodified 100,000-node guard. It constructed 79,477 nodes with 4,617,801 memberships at minimum extent 0.5, then returned the identical cached result on repeated preparation. Preparation took 4,382.9 ms; sampled peaks were 199.14 MiB JavaScript heap and 474.19 MiB ArrayBuffers. Memory sampling occurred at most every 100 ms through cancellation checkpoints.

These are instrumented application measurements, not a native speed comparison, a continuous memory high-water mark, a browser responsiveness result or full original index parity. The diagnostic had a 90-second deadline and an additional low-memory abort. No index capacity or resource-admission threshold was increased.

## Native default routing

The [routing evidence](evidence/global-fine-routing-defaults.json) follows retained REA procedures `0x14080bd60`, `0x140af88b0`, `0x140af89d0`, `0x140aeb530` and `0x140aec260`, with original loaded-image strings:

| Controller byte offset | Source                          | Default  | Meaning established here                                    |
| ---------------------- | ------------------------------- | -------- | ----------------------------------------------------------- |
| `0x0d`                 | `Preferences / ICPUseMeshTrees` | Enabled  | Consult mesh evaluator properties during target preparation |
| `0x0c`                 | `Preferences / ICPDiagnostics`  | Disabled | Diagnostic progress output                                  |
| `0x68`                 | Separate GUI configuration      | Enabled  | Parallel target preparation branch                          |

The constructor initializes preference bytes before the GUI reads persisted settings. Missing or invalid settings write their defaults. The GUI stores the parsed values at offsets `0x0d` and `0x0c`. The outer alignment call copies its separate configuration into offsets `0x68` through `0x87`, preserving those preference bytes. Target preparation receives the same controller and consults byte `0x0d`: a disabled option or absent property takes raw records; an available evaluator property waits on completion and enters the evaluator vector. The target-preparation concurrency branch reads byte `0x68` instead. The decompiler uses pointer-sized parameters in some procedures and integer byte addresses in others; these two offsets must not be conflated.

This is static shipped-artifact evidence, reinforced by the earlier supplied-object routing execution. It does not observe the current native user's persisted preference or a built index pointer. It establishes that raw-only replay cannot stand in for the default evaluator-enabled mesh configuration. Complete adjacency production, ready-index routing, physical-worker integration, whole-scan correspondence/registration results and shared GUI/MCP preview, Apply, cancellation and history remain required.

No public capability, contract, catalog or GUI behavior changes in this evidence/test slice. Build and regression results are recorded after validation; no broader feature-completion claim follows from the facet comparisons.

## Validation result

A fixed snapshot of committed baseline `8e1dc979735be1e67cfb1c8731566e91ac326851` plus the new whole-carrier regression built successfully (TypeScript and production Vite build, fingerprint `scanforge-f75bda946798fd9c`). The explicit external-oracle run passed all three tests with zero failures/skips. The default complete suite passed 45,113 tests across 586 suites, with zero failures and 43 optional skips, including the three external-oracle cases already executed separately. Formatting, JSON parsing and whitespace checks passed for the owned files. Build ran before focused and full tests. Moving unrelated working-tree changes were excluded from that snapshot and are not covered by these results.

The native bulk capture released its executable mapping, the diagnostic/test processes returned, and port 5173 remained responsive. The existing disposable validation snapshot is retained because automatic approval review previously rejected its removal; cleanup was not retried. There was no new browser replay for this test/evidence-only slice; the earlier controlled worker/browser results remain scoped as documented in the implementation evidence.
