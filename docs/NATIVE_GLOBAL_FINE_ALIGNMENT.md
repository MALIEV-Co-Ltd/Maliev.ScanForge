# Native Global Fine Align

Global Fine Align is a distinct native workflow, not the existing coarse `mesh_process` registration kind `global`. Its ribbon entry remains planned while native geometry preparation, overlap queries and the complete multi-scan controller are being integrated. The numerical code below is internal groundwork; no new GUI command or MCP math tool is advertised.

## Source and retained evidence

Static REA analysis uses the retained derived PE (`f605d0e24564021d939ba8bfe458b91b498af420baed341f724ca3ed2be8a273`). Direct runtime probes map the original loaded module (`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`), without executing an application entrypoint. Allocators, CRT functions, storage and notification/query boundaries are explicitly bound. Probes and cleanup receipts remain outside the repository under the isolated native analysis folder.

The command string identifies ID 33762. The original message-map entry at `0x1415db1f0` binds that ID to handler `0x14080bd60`. REA Evidence `ev_f90aeabdfb7e084d53598fefb744a5b9dc32a60bee05505cd86a18eaf7b75425` records its controller. It gathers two or more eligible mesh interfaces whose native `+0x230` flag is set, prepares adapters and invokes `0x140af89d0`. The precise UI meaning of that flag must still be established before copying admission rules into the application.

The outer solver (`0x140af89d0`, Evidence `ev_9ff81a1902377bf60182319b6adab1f5569c4c28ac6c70a3cb30a570e69da51f`) calls preparation `0x140aead00`, scene construction `0x140aeb530`, multi-scan passes `0x140af8cb0` and cleanup `0x140aeab60`. Controller evidence is static at this stage. Native whole-scene construction and publication are not established by the kernel captures below.

## Verified rigid fitting

`scan-native-global-rigid-fit.ts` reconstructs original pair accumulator `0x140ae84b0` and rigid fit `0x140d60a80`. It preserves source/target sums, source-target covariance, reciprocal multiplication, the 4x4 Horn quaternion matrix, native quaternion-to-matrix expression grouping and translation arithmetic. The reported mean distance is the average Euclidean distance of the incoming pairs, before applying the fit; it is not a post-fit RMS. Fewer than three pairs return failure and identity. Degenerate inputs retain the original eigen tie behavior instead of introducing an independent degeneracy rule.

`scan-native-global-eigen.ts` reconstructs the original four-dimensional Householder/QL kernel `0x140892cd0`, preserving the absolute `2^-23` split threshold, iteration budget, stable hypotenuse helper and descending last-tie sorting. The established three-dimensional registration implementation is unchanged. REA Evidence:

- Accumulator: `ev_e5677687ff6f66851547158283bcaec7771b9f0431e2c4302eb808dadcf47c34`.
- Complete rigid fit: `ev_cc92b6cd4123aedc7b0f3884ac747b14cdc446e69cd8cb8bc887092a8dd42fee`.
- Four-dimensional eigen kernel: `ev_69b716c5d3d20d4df8183a608d8b31832b2f307a807eac90115c83d6ef044864`.

Forty direct original eigen executions match eigenvalue and eigenvector bytes. Fifty-six direct original rigid-fit executions match success, all twelve Double pose values and incoming mean-distance bytes. A transparent native eigen-call trace preserves all 56 rigid results and additionally binds each covariance-to-eigen input/output boundary. The regression tests compare bytes, including signs of zeros; tolerances were not widened to hide rounding differences. Fixtures include small, coincident, collinear, translated, rotated and noisy paired records. These are controlled correspondence inputs, not complete owner-scan registration results.

## Verified local iteration

`scan-native-global-local.ts` reconstructs original `0x140aeb080`, retaining shared native rotation correction after composition. Its query boundary can await a bounded CPU worker without running competing pose updates. The caller owns query resources and cancellation/time limits.

Direct original execution covers 28 scenarios. The tests match every query-time Double pose and the final status, pose, mean, standard deviation and convergence/stability flags. Cases cover insufficient pairs, exact/noisy fits, inactive records, loss of more than twenty correspondences, complete loss of overlap, prior NaN statistics, and cancellation at entry or during a query. Geometry correspondence generation is controlled in these captures and is not claimed as native scene-query parity.

The local loop uses at most eight rigid fits. It reuses the previous query between iterations. A worsening mean with a sufficiently reduced match count rolls the pose back; the subtraction by twenty uses unsigned 32-bit arithmetic, including underflow for small counts. Error statistics and the current correspondence records retain the original rollback behavior. Convergence uses a strict Float32 tolerance; stability compares against the error at function entry, not against the immediately preceding iteration.

A machine-code detail matters: `COMISD` at `0x140aeb456` followed by `JBE` at `0x140aeb45e` terminates for an unordered relative-error ratio. JavaScript `ratio <= 0.001` would incorrectly continue on zero divided by zero. The port uses the equivalent negated greater-than condition. Complete loss of matches can leave native negative-NaN error statistics while retaining a finite pose. Those statistics are preserved internally; a future public response must represent unavailable diagnostics explicitly rather than silently reporting zero or declaring the workflow successful.

Local-loop REA Evidence: `ev_5418c90bcd936a703a2a32ce67e078734b58930b6340026c8a9dca8813f296dc`. Assembly Evidence: `ev_e87dd2804368444fb249e4bf72e4e190f8ae01e25f416c1246f8d46e433b3348`. Rotation composition/correction and error measurement are included in the native local-loop execution, not replaced by stubbed numerical results.

## Remaining native integration

The decompiled outer pass (`0x140af8cb0`, Evidence `ev_a867c7464bb5686e85705118e34c27443fb3bb853fdb3320ef8462ed6ade73b3`) iterates scans sequentially for at most nineteen passes, changes their order between passes, and applies a common inverse frame selected from the scan with the greatest point count. These ordering and frame rules need connected execution before publication. Parallelizing independent pose updates would change the algorithm; bounded geometry preparation and correspondence queries are the intended acceleration boundary.

Next implementation work is native scene/grid preparation (`0x140aeb530`), overlap marking (`0x140aec5c0`), sampling (`0x140aec7c0`), target-side preparation (`0x140aec260`) and correspondence branches (`0x140ae8c70` / `0x140aea1d0`). The UI caller's value 1000 is a sampling budget, not the local iteration limit. Constructor defaults and UI overrides must remain distinct. Whole-scene tests must use the supplied scan files, then verify GUI/MCP preview, Apply, cancellation, undo/redo and resource cleanup through shared operations before promoting the ribbon entry.

## Validation checkpoint

Build passed without warnings or errors (`scanforge-2cbb3bd9bdcd60d7`; the internal kernels do not change the current application bundle). The focused run passed 181 tests across four files. The default suite passed 37,685 tests across 397 files, with 31 optional checks skipped in seven files. The native probe processes exited and released their mapped allocations; REA sessions closed their owned resources. Formatting, whitespace and the repository name audit are checked before the scoped commit. No public GUI/MCP capability changed, so a new browser workflow is not asserted for this internal reconstruction. The established application remains served on port 5173. Full native Global Fine Align remains incomplete until the connected scene-query/controller and GUI/MCP gates above pass.
