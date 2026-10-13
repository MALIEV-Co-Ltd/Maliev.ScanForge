# Native alignment reconstruction

## Executed solver components

`src/scan-native-alignment.ts` contains two recovered paired-point solver kernels.
They are components for the ongoing solver port; the application still uses its
existing independently authored registration implementation. They do not enable
the gated Align ribbon commands or establish complete native alignment parity.

The quaternion conversion at `0x140aac800` only renormalizes when squared length
differs from one by more than `2^-23` and exceeds `2^-52`. Its row-major rotation
preserves the recovered arithmetic order. Ninety executions of the complete
original helper match all resulting matrix double bytes, including zero, axis,
small/large magnitude and seeded quaternion cases. Translation slots remain
unchanged in the native capture. REA Evidence:
`ev_f32ee3250dfffdeda6ae42361d337450e65972ff5bd86965ff5630570d4e3625`.

The optimizer objective at `0x140aaef90` sums absolute XYZ errors in point order,
rounding each transformed coordinate to Float32 before subtraction. X uses the
recovered Y-then-X product order. Forty executions of the complete original
helper match all returned double bytes across point counts one through nine and
coordinate scales from `1e-4` to `1e7`. This objective differs from the squared
error used by the outer candidate comparison. REA Evidence:
`ev_98955a89d45949420dabf3b4643f423e4adc4044e8cc7c297855e854773da01a`.

Captures are retained in `tests/fixtures/alignment-kernels-native.json`, with
source image SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
The probe binds the captured square-root import to system UCRT and supplies the
point-container storage. Neither helper's arithmetic is replaced. It releases
the mapped allocation and exits. These captures execute numerical components,
not the native UI, allocator, optimizer or complete alignment operation.

## Recovered workflow and remaining solver work

The picked-point handler `0x1406a0000` stores world hits widened from Float32 and
tags the moving/fixed side. The preview handler `0x14054ca20` requires at least
three points on each side with equal counts, creates candidates, applies from a
retained original mesh and then invokes a separate refinement path. Picking is
disabled after preview until reset. Native cancel restores the retained source.
Current application picking and preview invalidation therefore need reconciliation
with that workflow after solver verification.

`0x14054d050` maps moving landmarks to nearest original vertices with strict
distance improvement, retaining the first index on ties. That mapping feeds
refinement; it does not replace landmark coordinates in the initial paired solve.

`0x140aacbc0` tries an identity-seeded optimization and a second initialization,
refines candidates, compares Float32-rounded squared errors and inverts the
chosen matrix. Equal comparison error favors the second candidate. Replacing
this with the existing closed-form rigid fit would skip native behavior.

`0x140aadde0` constructs initial transforms from point triples. The triple helper
`0x140aaf400` rejects squared vector lengths below `2^-23` and absolute normalized
dot products above `0.9962`; it uses triangle centroids and constructed frames.
These checks are currently static evidence, not executed initializer parity.
REA Evidence: `ev_ca3a6e9f8ab52f0e3127acb59820d3bce8af539da2e894558f70c17c29aafb91`.

`0x140aadba0` represents rotation and translation as seven parameters and invokes
the optimizer `0x140b25340` with callback `0x140aae6d0`. The callback constructs a
rotation and calls the verified absolute-error objective. Optimizer step rules and
termination now have the executed component gate below. Complete initialization,
paired-point outer ranking, and subsequent
mesh/CAD refinement (`0x14054d440`) still require extraction and original-result
verification. No native solver convergence or Fine Align parity is claimed.

Coordinate-system alignment, interactive alignment and multi-scan Global Fine
Align remain separate requirements; this paired-point extraction does not cover
them. Full promotion also requires browser picking, preview/reset/cancel/accept,
immutable fixed objects, undo/redo and project persistence checks.

## Executed simplex search

`src/scan-native-simplex.ts` ports optimizer `0x140b25340` and trial helper
`0x140b25e30`. It preserves positive/negative initial perturbation selection,
ordered simplex sums, last-minimum tie selection, strict trial replacement,
reflection/expansion/contraction/shrink, relative objective-spread termination,
and the native strict evaluation-budget comparison. A zero spread over zero
objective is NaN and does not trigger convergence. Status one means the spread
test passed; status two means the budget was exceeded. Initial objective and
perturbation calls do not contribute to that budget counter.

The default step is Float32 `0.005` widened to double
`0.004999999888241291`, matching the caller constant. Invalid inputs and non-finite
objectives are rejected at the port boundary; cancellation is checked before
every evaluation. These safeguards are independently authored, not native parity
claims.

Six executions of the complete original optimizer and trial helper produce 202
recorded objective calls. Tests match every parameter double byte at every call,
the final parameter bytes, returned error and termination status. Inputs include
one/two/seven parameters, signed coordinates, equal perturbations, zero objectives
and positive/negative exhausted budgets. The capture supplies deterministic
quadratic, absolute-error and constant objectives; it does not yet execute the
paired-point callback or complete registration.

The external probe supplies vector allocation/copy, retained-allocation release
and CRT memcpy/memset adapters. Six-byte import thunks use separate jump
trampolines so adjacent imports remain distinct. Neither optimizer nor trial
arithmetic is replaced. The mapped allocation was released, and the successful
probe process exited. Earlier adapter attempts terminated before producing
captures; their processes were confirmed absent. Native scheduling and allocator
behavior are outside this capture.

The references are in `tests/fixtures/alignment-simplex-native.json`. Optimizer
REA Evidence is `ev_c5650053f988799558148f6d2e7ea06c3d21920de1b97d55d84d43e4936ce66b`;
trial Evidence is `ev_6d90fcab953ca34c4d310e827908d54b6ef388862f539152c4723a37ab5dfb5d`.
Its assembly Evidence is `ev_400e949f08e5cd4c39ca10dacec232c08301fdb1e04ec5cc5caa4f4d1391d96b`.
The source image digest is the same as the preceding kernel captures.
