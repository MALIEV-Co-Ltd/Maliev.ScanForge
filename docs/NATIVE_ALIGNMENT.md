# Native alignment reconstruction

## Executed solver components

`src/scan-native-alignment.ts` contains two recovered paired-point solver kernels.
These kernels now feed the complete paired-point numerical wrapper documented
below. The application still uses its existing independently authored registration
implementation. They do not enable
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
The complete triple helper, frame constructor and outer N-point candidate
enumeration now have executed comparisons below.
REA Evidence: `ev_06aecd48127374b20a1549fa59249fe891e727d38fdfac936304299550bac21a`.

`0x140aadba0` represents rotation and translation as seven parameters and invokes
the optimizer `0x140b25340` with callback `0x140aae6d0`. The callback constructs a
rotation and calls the verified absolute-error objective. Optimizer step rules and
termination now have the executed component gate below. Complete initialization
and paired-point outer ranking are verified in the connected numerical wrapper.
Subsequent mesh/CAD refinement (`0x14054d440`) still requires extraction and
original-result verification. No native solver convergence or Fine Align parity is claimed.

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

## Executed complete N-point initializer

`src/scan-native-alignment-npoints.ts` now connects the original candidate schedule,
triplet construction, refinement and Float32 RMS ranking. Accepted candidates
with fewer than 100 pairs refine with tolerance 0.001 and budget 100. At 100 or
more pairs they are ranked directly. Strict less-than preserves the first equal
Float32 score. The final best matrix refines with tolerance 0.0001 and budget
1000, including the identity fallback when all triplets are rejected. Fewer than
three pairs return identity. Input points round to Float32 before initialization.
The port avoids the caller's redundant pre-refinement RMS calculation because its
result is overwritten before ranking; source and candidate coordinates stay
immutable. Cancellation and finite-coordinate guards are independently authored.

Twenty executions of the complete original `0x140aadde0` cover 0/1/2/3/4/5/8/16
pairs, the 99/100 refinement boundary, 101 pairs, the 1999/2000 sampling boundary,
five noisy pair sets, collinear points and coincident points. Every final matrix
double byte matches the port. The original point conversion, candidate loop,
triplet construction, optimizer, RMS ranking and final refinement execute without
numerical substitution. References are in `tests/fixtures/alignment-npoints-native.json`.
This upgrades the preceding static schedule observations to a complete caller
output comparison; it does not capture every candidate's internal evaluation trace.

The point storage now supplies the cyclic container/proxy layout observed in
constructor `0x140aae8b0`: the container references a proxy, and the proxy points
back to the container. This supports the different iterator-copy paths in the
refinement and RMS helpers. The original conversion widens Float32 XYZ values
to doubles. Constructor Evidence is
`ev_85ae7a6ac189005797e7f6ee2c768f8790dd940ac021ec499fd76275af3f144e`;
conversion-loop Evidence is
`ev_f5c44ca16b4a38a9e86e881a8bdb82fe544b213a32cfda42e6fb08e3137a1e7d`.

The refinement port also supports the original optional Float32 RMS output.
Fifteen complete original matrix-wrapper captures with RMS enabled match every
matrix double and RMS float byte. These references are in
`tests/fixtures/alignment-refinement-rms-native.json`; earlier captures with RMS
disabled remain unchanged.

The native probes bind raw allocation/copy/free and CRT imports and retain
allocations until each case returns. The original allocation helper `0x14013d800`
is preserved, including its alignment/header path for buffers of at least 4096
bytes; only its raw allocation import is bound. Evidence is
`ev_e30c0fc14f398656638b2042150d63e015bf28b73e11f2e45b827dd0dc287f4b`.
An earlier replacement allocator omitted that header and failed on the large
map cases; it was removed before producing the committed references. Earlier
missing CRT bindings also terminated before captures. Successful probe mappings
are released and processes exit. These are numerical caller captures, not native
UI, scheduler, allocation-failure or complete registration parity. The outer
identity-seed versus initialized-seed comparison and final transform inversion,
followed by mesh/CAD refinement, remain pending before application integration.

## Executed outer registration rejection gate

Twenty executions of original `0x140aacbc0` now capture the complete outer
registration outputs, including identity versus initialized seed comparison,
final transform inversion, and rejection. Inputs reference the existing N-point
fixture by name and Float32 SHA-256. The native boolean return is read from AL.
An initial probe incorrectly interpreted the full RAX register and marked three
rejected cases as accepted; that adapter was corrected and all cases recaptured
before creating this committed reference.

The line-fit gate uses enabled source points. If the fit succeeds, original
`0x140b33900` computes RMS distance to that fitted line. The outer caller rejects
only when this RMS is strictly below 1 mm. Rejection leaves the matrix identity
and the supplied RMS output unwritten. Failed fits proceed, including zero and
one point. Original two-point, collinear and coincident captures reject; accepted
captures proceed through the original optimizer paths. This is a dimensional
native rule, not a generic rank or collinearity check.

`src/scan-native-alignment-line.ts` ports the ordered line-distance calculation:
Y-then-X-then-Z projection, residual distance square root followed by resquaring,
and sequential accumulation. All twenty original metric double bytes and gate
outcomes are compared in `tests/scan-native-alignment-line.test.ts`. Supplied
centers and directions remain original line-fit outputs; the PCA/eigen solver is
not replaced by a different fit. Empty enabled sets return native Float32-max
represented as a double. Independent finite-input and mask-length checks guard
the port; mixed-mask behavior is not a new native capture.

Forwarding observers copy position-independent original prologues and call the
original line fit and metric. All twenty observed and unobserved complete wrapper
outputs match in accepted flag, matrix bytes and RMS bytes. The mesh getter,
allocation/CRT bindings, source auxiliary-state reset and cleanup adapters remain;
these are original numerical instruction captures, not native UI exports.

Line-fit Evidence is
`ev_642eed72a562ec242b0847d78aef19a690dd1fc2367746a37dd36472a88da97f`;
line-distance Evidence is
`ev_2f6c2a7798a63f5116b58438f7ee7955600d1c7d97e26e7e2cea659150ebdce9`.
REA recovered the native eigen solver at `0x140b31a10` (Evidence
`ev_aece2c37738f9da53043ac5e16317ae5283b75f3cbeff39aec2b83575eccc245`)
and line-center adjustment at `0x140b33b20` (Evidence
`ev_5d56c135b260ef1fe9d367fb66350a2d1d92701de7ea46014367cbf905b77a31`).
The following complete solver port supersedes that component-only checkpoint.
UI integration remains pending the moving/fixed call-site and mesh/CAD path.

## Executed eigen solver and complete paired-point wrapper

`src/scan-native-alignment-eigen.ts` specializes original `0x140b31a10` to the
3x3 matrices used by the line fit. It preserves Householder reduction, QL
iteration, the strict absolute off-diagonal threshold of 2^-23, the 30-iteration
failure rule, double-epsilon radius handling, and descending eigenvalue sorting
with the last tied candidate winning. Forty original executions cover zero,
repeated eigenvalues, rank-one, tiny and large scales, and 32 seeded symmetric
matrices. Eigenvalues and eigenvector columns match every original double byte.
The original scaled hypotenuse helper `0x140895090` returns zero in its second
branch when the second magnitude is at most double epsilon; the port preserves
that rule. Its Evidence is
`ev_d7447f7f05133cfeaea3e1c95b8a4839a9b08b0992ef383dba2f21c3dc8bfca4`.

The line-fit port connects ordered covariance sums to that solver and the
original line-center adjustment. It normalizes the direction, falls back to X
for negligible squared direction length, and projects the center toward the
origin only beyond the native scaled epsilon threshold. All twenty retained
original line-fit outcomes, center bytes, direction bytes, line RMS bytes, and
registration acceptance outcomes are compared without supplying native fitted
centers or directions to the port.

`src/scan-native-alignment-registration.ts` now implements the complete original
outer numerical wrapper: the source line gate, refinement from identity,
N-point initialized candidate followed by another refinement, squared-error
ranking with the initialized candidate winning ties, double RMS, and the final
transpose/translation inverse. Its returned matrix maps target points to source
points. All twenty original accepted flags and matrix/RMS bytes are compared,
including the rejection paths and zero/one/two-point cases. The refinement
component's previously authored three-point guard was removed to reproduce the
underlying numerical wrapper; UI minimum-point requirements remain separate.
Empty inputs preserve the captured native indefinite NaN representation using
explicit IEEE storage, including the optimizer's nonzero translation result.

These are original-instruction numerical comparisons with the retained allocator,
object-access and cleanup bindings. Native UI point-pair dispatch, preview,
accept/undo, mesh/CAD refinement, failure UI and practical performance still need
verification before substituting this solver into application commands. Generic
N-dimensional eigen solving and allocator failure behavior are not covered by
the 3x3 specialization. The broader alignment feature remains incomplete.

## Executed landmark mapping and candidate dispatch

`src/scan-native-alignment-landmarks.ts` reproduces two parts of the original
preview path. Original `0x14054d050` excludes fixed-side records and maps moving
landmarks to the original mesh's Float32 vertex storage using ordered squared
XYZ distances and strict improvement. Ties preserve the first vertex. The
initial distance is Float32 max represented as double; if no vertex improves
that bound, the index remains 0xffffffff. Landmark coordinates remain doubles
in this mapping helper, rather than being rounded again. Forty complete original
helper executions cover active and retained landmark-list branches, empty data,
fixed-only lists, duplicate and equidistant vertices, a sub-Float32 landmark
perturbation, the distance sentinel, and twelve seeded inputs. All vertex indices
match the port. Evidence:
`ev_5d4d5953060dc429e3a48da0d103fa26234686d1c960dab5e0c3ebffa1ba1106`.

Original candidate builder `0x14054c7a0` converts tagged landmark coordinates to
Float32 into per-side temporary meshes, passes fixed points first and moving
points second to `0x140aacbc0`, and publishes only an accepted result. The
wrapper's inversion therefore yields the moving-to-fixed transform. Forty
complete original builder captures cover both active and retained landmark-list
branches over the existing twenty point sets. All thirty published matrices
match every double byte; all ten no-candidate outcomes match. The port keeps the
preview's equal-side-count guard independently, while fewer than three pairs
produce no candidate. Evidence:
`ev_454fb0a1977d5398856a37f96d0d2a7ea060b382daaeb788c658ad3f8dc030ec`.

The mapping probe preserves original temporary vector allocation and filtering
instructions, supplying original-mesh getters and preallocated output storage.
The candidate probe adapts only temporary mesh construction, append/getters and
release storage in addition to the retained allocator/CRT bindings; per-side
conversion, solver call and publication execute original instructions. These are
numerical/helper captures, not native UI exports or complete preview validation.
Both mappings are released and probe processes exit.

The original preview subsequently restores/copies the retained moving mesh,
applies the candidate, transforms moving markers, and invokes `0x14054d440`
mesh/CAD refinement. That path calls controller construction `0x140aa8ea0` and
refinement `0x140aaa570`. Extracting and validating those operations remains
necessary before replacing the application's preview pipeline. The fixed object
must remain unchanged through preview, acceptance, cancellation and undo/redo.

## Six-parameter refinement transform and complete function inventory

A focused REA extraction on 2026-10-13 supplied explicit function seeds for
previously unseeded refinement callees. The initial decompilations had one-byte
inventory bodies and incomplete assembly; those records cannot establish complete
instruction coverage. The replacement records contain complete bodies and assembly:

| Function                          | Body bytes | Assembly instructions | REA Evidence                                                          |
| --------------------------------- | ---------: | --------------------: | --------------------------------------------------------------------- |
| Axis rotation `0x140b30740`       |        690 |                   140 | `ev_ca5afaf1793eeeacb31c2a2a4990943a02be57a19fed7fd72ddcb673fdd02595` |
| Objective callback `0x140aaa020`  |        126 |                    29 | `ev_91de89bba5b03051c677bc4898aaf27c14f20c97a42b208e36df93e7c91aa494` |
| Optimizer wrapper `0x140b25b80`   |        677 |                   161 | `ev_eaafc184fd9d228b1536e459295a05f0065416b22a381392d617c76e6af32b2a` |
| Rotation correction `0x140ae82d0` |        469 |                   111 | `ev_fdebb9fd8f56ad694db01a29da0ca3f4fc58bd4ba6678f6dbf9c9709c4cca00c` |
| Polar solver `0x140aed610`        |      1,684 |                   453 | `ev_7178591f25ab2448c518341946160766ad5aee8b2486b334c9e8c142e6171ef3` |
| Optimizer core `0x140b23f20`      |      3,325 |                   824 | `ev_ceb9fa6b77241011aac0f9876c4f3a3fbbf8d57a706788c20c89a0a7e0e2da1c` |

The complete original transform `0x140aaa0a0` was executed on 60 retained
inputs: identity, translation, fixed-angle cases and 25 seeded mixed transforms,
each with translation-only mode both disabled and enabled. Translation parameters
are offset by 10; angle parameters are offset by pi/2. Rotations follow current
local Z, Y and X axes and invoke the original correction/orthonormalization path
after each rotation. The caller assembly passes double angles; the decompiler's
`undefined4` annotation on the rotation helper is not a Float32 conversion.

The probe preserves the original polar solver and numerical callees. Adaptations
are limited to retained allocation/free bindings, standard CRT imports and the
security-cookie check. An earlier attempt failed at an unbound allocation import;
its failed result is excluded. The corrected run released its mapped allocation
and exited. All 60 outputs are finite, captured matrix bytes round-trip exactly,
translation error is zero, and the maximum rotation orthogonality residual is
4.440892098500626e-16. These are native reference captures, not comparisons with
an application port or native UI exports.

The retained controller `0x140aaa570` distributes marked, non-hidden moving
vertices round-robin into 0x70-byte worker records. Dispatcher `0x140aa91c0`
calls workers directly for a single record and scheduler wrappers for multiple
records. This is static dispatch evidence; actual concurrent execution and worker
numerical output remain unverified. The refinement thread entry specifies a
search budget of 1,000, a 1e-10 tolerance argument and a Float32-stored step promoted
to double (default 0.00019999999494757503). The optimizer wrapper additionally
initializes 1e-8 and 1e-10 tolerances. Their convergence use must be traced through
the recovered core before treating them as equivalent to the paired-point search.

The complete extraction, 60-case results, binding manifest, fault record and
verification are retained outside the repository under the existing analysis
folder, in `alignment-six-transform-results.json`,
`alignment-six-transform-verification.json` and
`alignment-refinement-dispatch-trace.json`. All task-created probe and REA
processes were checked absent. The application preview remains unchanged until
the rotation correction, six-parameter optimizer and mesh/CAD query workers are
ported and compared with these original results.

## Ported six-parameter transform and rotation correction

`src/scan-native-alignment-transform.ts` implements the extracted local-axis
rotation sequence, scaled polar iteration, scaled partial-pivot LU inversion,
and quaternion fallback. LU pivot scores select the later row on equality;
row and pivot rejection use a strict comparison with double epsilon. The
iteration retains the native arithmetic order, ten-iteration limit, and fallback
on the original input rotation. Translation components remain unchanged during
correction.

The additional focused REA records are:

- LU decomposition `0x140399440`: `ev_0622965fa4f189971d0ed81cd01c37ec5640e47e7f60bfaecfdf52976e422e88`.
- Forward/back substitution `0x140399100`: `ev_cfcae9ff85d964be9c2edf89442bd06e563b247085b587070a309394397f266e`.
- Inverse wrapper `0x140af06b0`: `ev_5b62281ca47f2e0a150970f6cf86655f62a0bc3a0b74ae5ec8d8fa97ace06407`.
- Frobenius norm `0x140af08a0`: `ev_3cc450f70041253d2c70cc8daab03521ed8badd08daf32acd569f0fa6f870f85`.

Thirty new executions of the complete original rotation-correction routine cover
identity, scaling, shear, reflection, zero and rank-deficient matrices, epsilon
thresholds, extreme anisotropy, pivot ties, and twenty seeded mixed matrices.
All thirty port outputs match the original matrix bytes exactly. These captures
retain the original solver and quaternion fallback, with the same allocation,
CRT and security-cookie adapters as the earlier transform probe. The probe
released its mapped allocation and exited; its ledger and cleanup receipt remain
outside the repository. Repository fixtures retain the provenance and bindings.

For the sixty complete six-parameter transforms, JavaScript math produces 54
byte-identical outputs. Six outputs differ because JavaScript sin/cos and the
probe's Windows CRT exports round differently. Repeating every comparison with
the captured CRT trigonometric values produces 60 byte-identical outputs. The
production path uses JavaScript math; its tests bound every rotation component
error to 5e-16 and require exact translation bytes. This is an explicit numerical
limit, not a claim of complete native byte parity for JavaScript trigonometry.
The CRT fixture is used only to isolate arithmetic in tests, never in production.

This helper has not replaced the application's alignment preview. The recovered
six-parameter optimizer, mesh/CAD query workers, and complete preview/accept/
cancel/undo pipeline still require native comparison before integration. No
concurrency or full Align feature parity is established by these transform tests.

Validation for this port: `npm run build` completed without warnings/errors;
`npx vitest run tests/scan-native-alignment-transform.test.ts --maxWorkers=1`
passed 151 tests; `npm test` passed 217 files and 10,430 tests. Scoped Prettier,
diff whitespace and prohibited-name checks passed. The new helper has no UI
consumer yet, so no browser behavior change is claimed for this slice.

## Six-parameter refinement optimizer port

`src/scan-native-refinement-simplex.ts` implements the original six-dimensional
refinement search, separate from the paired-point optimizer. It evaluates the
initial point first, then positive axis perturbations, using `abs(parameter) *
step` for nonzero parameters and `step` for zero. The seven-point sort preserves
equal-error ordering. Centroids, reflection, expansion, contraction and shrink
retain the original arithmetic and comparison rules, including the negative
contraction factor in the branch where reflection is no better than the worst
point. The budget counts search iterations, not objective evaluations.

Convergence requires both population standard deviation of the seven objective
values at most 1e-8 and every sorted simplex point within Euclidean parameter
distance 1e-10 of the best. The default step is Float32 0.0002 promoted to double
(0.00019999999494757503), with a default budget of 1,000. Zero budget still
initializes and evaluates the simplex, then reports nonconvergence. Cancellation
and finite-input validation are application safeguards around the recovered
search; callbacks receive copies so observers cannot corrupt the search state.

Additional focused REA records from the seeded, complete function inventory:

- Convergence `0x140b24de0`: `ev_cbba46997459a2ef3742c8d35590b0f0fdbaafdbde9b40f84b4059009700ff0d`.
- Sorting `0x140b23c60`: `ev_d87855da586b661410b01573fe5c46da8d2c922c26e2cb4370164ee87c9f04fd`.
- Initial simplex storage `0x140b24c20`: `ev_b14b96d22edd8009d7c7953d082afd7fb1ff28c37c423adc53d8cfd7cccb40be`.

Twenty executions of the complete original optimizer use caller-supplied
quadratic, constant, linear and anisotropic quadratic objectives at budgets 0,
1, 12, 60 and 1,000. All 5,639 evaluated parameter vectors and objective values,
final parameters, errors, iteration counts and convergence flags match the port
byte-for-byte. The constant objective converges after 25 shrink iterations;
the three other 1,000-budget captures exhaust their budgets. The controlled
objectives isolate optimizer behavior; they do not reproduce the mesh/CAD query
callback or establish full native alignment results. Allocation/CRT/cookie
adapters are retained in fixture provenance. Mapped images were released and
native/REA helper processes exited, with receipts retained outside the repository.

The geometry-query workers and controller integration remain the next required
boundary. This search helper has no UI consumer yet and establishes no multicore
or complete preview/accept/cancel/undo parity.

Validation: the isolated checkout at base `de8822b` plus this alignment slice
passed `npm run build`, 22 focused tests, and all 218 files / 10,452 tests in
`npm test`. Scoped Prettier, whitespace and prohibited-name checks passed. The
shared-worktree full suite had two failures in concurrently edited polygon
reduction code (reduction report markup and reduction worker contract); those
changes were preserved and excluded from the isolated alignment checkout. This
records the validation boundary rather than claiming the shared dirty worktree
passed. The helper has no UI consumer, so no new browser behavior is claimed.
