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
The complete triple helper and its frame constructor now have the executed gate
below. The outer N-point candidate enumeration is still separate work.
REA Evidence: `ev_06aecd48127374b20a1549fa59249fe891e727d38fdfac936304299550bac21a`.

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

## Executed three-pair initializer

`src/scan-native-alignment-initializer.ts` implements the complete triplet helper
`0x140aaf400` and frame constructor `0x140aae990`. It checks all four vectors in
native order, normalizes them using the recovered double reciprocal, rejects
near-collinearity, uses triangle centroids, constructs orthonormal frames, and
composes the inverse target-centered frame with the source-centered frame.
The shared transpose/translation inverse already verified for Mirror is reused;
no new independently approximated matrix inverse is introduced.

Eighty-two executions of the original helper cover identity, translation,
quarter-turn, five coordinate scales, duplicate points, collinearity thresholds
and sixty seeded triangle pairs, plus Float32 maximum-coordinate and sentinel
cases on both sides. Seventy-eight inputs are accepted and four rejected.
Tests match every returned matrix double byte and the original success flag;
inputs remain unchanged. Rejected inputs do not produce a transform. This gate
covers three-pair initialization, not N-point candidate enumeration, optimization,
outer error ranking or subsequent mesh/CAD refinement.

The frame translation retains the native sentinel branch: all three translation
values are negated only when local X is not NaN and its Float32 representation
differs from the positive Float32 maximum. Explicit sentinel inputs verify this
branch, which is outside ordinary scan coordinate ranges.

The probe executes the original normalization, frame construction, inversion and
composition instructions. It binds the square-root import to system UCRT and
replaces the security-cookie checker with a plain return, preserving the original
AL success flag. The assembly confirms that the frame constructor writes AL=1
and the rejection branch writes AL=0; a callback that overwrites RAX would not
be a valid flag adapter. Native allocation, UI picking and application security
behavior are outside this probe. The mapped allocation is released and the
process exits.

References are in `tests/fixtures/alignment-triplet-native.json`, using the same
source image digest as the preceding captures. Frame assembly Evidence is
`ev_a6eab1c05f14382f2488c5fe491bc42913427bcbe4b226282d440edd75a2863b`;
triplet assembly Evidence is
`ev_420e7d618af86d93999ffb6950e15d8b1ff51f3e5f0576f18420079b8475c3b8`.

## Connected paired-point refinement

`src/scan-native-alignment-refinement.ts` connects the recovered seven-parameter
optimizer to the original paired-point objective. Point coordinates are rounded
to Float32 once at the input boundary; optimization retains double parameters.
The trace observer receives a copy, and cancellation is checked between objective
evaluations. The returned error is the ordered L1 objective, not RMS.

Four executions of the original callback and optimizer capture all 544 objective
evaluations. Tests match every parameter and error double byte at every call,
final parameters, error and termination status. Cases include translation, a
quarter turn, a known pose and a non-unit quaternion. The source remains immutable.
References are in `tests/fixtures/alignment-paired-native.json`. Callback REA
Evidence is `ev_43f65ecd6567ac1ec2ba22bac119f03f0842a893be403ee35fc10fd946c2349b`.

The matrix wrapper `0x140aadba0` is separately executed on fifteen combinations
of five initial poses and three target sets. The gate includes negative-trace
half turns about all three axes and compares the original matrix-to-quaternion
helper and final matrix bytes. It executes the original parameter constructor
`0x1401a76f0`, optimizer, callback and numerical helpers with optional RMS output
disabled. References are in `tests/fixtures/alignment-refinement-matrix-native.json`.
Wrapper REA Evidence is
`ev_bcd23f9c5f0845ab64e0779210dac5712c693db4e2682d3dbe2c2388ee9fdea2`;
quaternion extraction Evidence is
`ev_eab8c19d8f9256b9c7f0f80f3e1fced2d52415f066b8e0ccff7ceb9bc03e26c9`.

An earlier capture adapter omitted the parameter record's dimension at offset
0x18 and produced invalid unchanged-matrix references. Those references were
replaced after restoring execution of the original constructor. The corrected
fifteen captures all match the port; tolerances were not relaxed.

The probes retain supplied point storage, vector allocation/copy, CRT and
security-cookie adapters. Numerical instructions are not substituted. Both mapped
allocations are released and the processes exit. These are component captures,
not native UI exports or allocator/scheduler parity. N-point candidate enumeration,
RMS ranking, outer registration and mesh/CAD refinement remain unverified. The
new solver component is not yet wired into the application Align UI.

## Executed candidate error metrics

`nativeAlignmentSquaredError` and `nativeAlignmentRms` in
`src/scan-native-alignment.ts` implement the original candidate metrics
`0x140aaf150` and `0x140aae810`. Transformed coordinates round to Float32 before
subtracting paired Float32 targets. Each point combines squared X, Y and Z
residuals before addition to the total. RMS divides by point count and takes
a double square root; an empty pair set returns zero. The kernel consumes
iterator cursors, while the RMS wrapper copies cursors and preserves its inputs.
The port has immutable array inputs. This differs from the optimizer's L1
objective and must not be replaced by that objective when ranking candidates.

Sixty-four executions of both original routines cover 0/1/4/17 points, identity
and seeded general matrices, and coordinate scales from 0.00001 to 1000000.
Tests compare every squared-error and RMS double byte and preserve source inputs.
References are in `tests/fixtures/alignment-metrics-native.json`. Assembly Evidence
is `ev_e7a413f8b0146e85daf41b1fa0dd7a5013e5e99f8c760e9f0bda1a1e25d1eddd`
(squared error) and
`ev_a6774b9828624aa0928a49a29e0d6d6840e4f33f219921ae15a10c314415d0db`
(RMS). Both routines use the same mapped-image digest as the preceding captures.

The probe supplies Float32 point iterator storage and resolves the square-root
import to system UCRT; neither metric's numerical instructions are replaced.
An initial RMS iterator adapter used the wrong pointer depth and its two attempts
exited with access violations before producing captures. The corrected successful
probe releases its mapped allocation and exits. These metric captures do not
verify the complete refinement wrapper's optional RMS output, N-point candidate
enumeration, outer ranking policy, native UI or allocator behavior.

## N-point candidate schedule

`src/scan-native-alignment-candidates.ts` recovers the initializer's sampling
schedule. For at least three pairs it fixes the first and middle point as anchors,
then visits sampled third points in ascending order, excluding both anchors.
The stride is `max(1, floor(count / 1000))`; it changes at 2000 points and can
produce almost 2000 candidates immediately below that boundary.

The original scalar instructions at `0x140aadf97` through `0x140aadfc0` were
executed unmodified in a 4 KiB mapping. The harness binds the count, preserves
nonvolatile registers and returns the stride. All 309 captured counts match,
including division boundaries and the unsigned 32-bit limit. References are in
`tests/fixtures/alignment-candidate-stride-native.json`. The complete loop order
is supported by the initializer's assembly and decompilation Evidence
`ev_c3b35a91dffc3b74ca02812807ea612afab0fb463efb284867068a3ed9b0148f`;
this scalar probe does not execute the complete candidate loop or registration.
The port independently rejects candidate enumeration above signed 32-bit count
to avoid the native loop counter's overflow range. It does not claim native
overflow behavior.

The recovered caller converts RMS scores to Float32 and uses strict less-than
when replacing the current best, preserving the first candidate on ties. It
refines each accepted candidate only below 100 pairs with tolerance 0.001 and
budget 100, then refines the final chosen matrix with tolerance 0.0001 and budget 1000. These policies remain static observations pending complete original caller
captures and are not integrated into the UI by the schedule helper.
