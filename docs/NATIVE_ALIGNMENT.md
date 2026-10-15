# Native alignment reconstruction

## Executed solver components

`src/scan-native-alignment.ts` contains two recovered paired-point solver kernels.
These kernels now feed the complete paired-point numerical wrapper documented
below. GUI/MCP paired registration uses this recovered wrapper for its initial
candidate; complete paired-point preview refinement remains unfinished. Coordinate
Align and surface fine alignment have separate verified entries documented in
NATIVE_DATUM_ALIGNMENT.md and NATIVE_ALIGNMENT_TARGET_GROUPS.md. These component
captures do not establish complete native alignment parity.

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

## Production PLY import verification

`src/ply-topology.ts` now preserves PLY vertex order and triangle indices before
expanding coordinates for the renderer. It retains coincident and unreferenced
vertices: neither coordinate welding nor triangle-soup traversal can restore the
original vertex ordering. The GUI and MCP import paths still use the same
`importScan` worker, `readScan`, and `parseMesh` operation. No import options or
agent schemas change in this slice.

The opt-in owner-scan tests now use this production indexed parser instead of
their separate binary PLY reader. They compare full-resolution source normals,
sampling flags and selected vertices for all three scans, target adjacency and
surface queries for scan 1, and the recovered surface controller's refinement
results for scans 2 and 3 against scan 1. Run them with
`SCANFORGE_ALIGNMENT_EXAMPLES` set to the owner scan folder and
`tests/scan-native-alignment-user-examples.test.ts` selected.

A fresh original-procedure execution produced exactly the retained
`alignment-user-refinement.json` results for both registrations. Its mapped-image
digest is `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
The external `alignment-import-native` probe, result, lease ledger and cleanup
receipt record this run. It executes the original target builder and refinement
procedures with retained source sampling, serial scheduling and CRT adapters;
it does not execute the full application constructor or capture the original UI.
This is direct native execution evidence, not a new REA Evidence ID.

Imported PLY entities now retain optional `indexedMesh` buffers alongside render
triangle soup. Unit conversion and origin placement transform both consistently.
The GUI and MCP commit paths invalidate metadata that no longer matches edited
render coordinates, preserving earlier immutable undo snapshots. JSON and binary
project containers preserve it; binary containers use deduplicated numeric chunks
and JSON Blob saving uses bounded batches. Project loading rejects inconsistent
indices or coordinates. MCP object inspection exposes counts and optional
geometry artifacts with the original indices.

Whole-object transforms now use the same indexed-coordinate helper in the GUI
and MCP. The helper retains face indices and original vertex ordering (including
unused vertices), applies the existing transform arithmetic to both coordinate
buffers, and preserves pre-transform undo snapshots. Focused and browser/MCP
checks cover coordinate consistency, transformed topology inspection, undo and
binary project persistence. This verifies topology preservation, not native
surface-refinement parity after a transform.

The distinct surface-refinement action below consumes these retained buffers in
the shared worker. Existing ICP remains a separate implementation. Full Align
parity and multicore execution remain unproven.

## Verified controller bootstrap pose

The controller's `[10,10,10,pi/2,pi/2,pi/2]` parameters encode identity;
they do not request a 10 mm translation or a 90-degree rotation. Original
`0x140aaa570` first invokes correspondence centering `0x140aaa2b0`, extracts
Euler angles through `0x140622fe0`, and adds the parameter offsets. The centering
helper returns identity even for translated correspondence records.

Fresh REA Euler extraction evidence is
`ev_6be06132e457e3e6b451874b963ca95ae2095c93e23e321edd78839e5b5765b5`.
The external `alignment-bootstrap-sequence` probe executes the original
centering, Euler and transform procedures on empty and translated records, then
the original Euler procedure on 30 retained mixed-transform matrices. The two
bootstrap cases reproduce identity exactly; the 30 additional cases capture
offset-encoded Euler parameters, including the native angle-branch behavior.
The first runtime attempt failed at an unbound CRT `atan2` import. The subsequent
run binds that import and completes all 32 cases; its allocation is released and
the process exits. The fixture retains the image digest and execution limits.

`nativeAlignmentSixParameters` now implements this conversion, and the recovered
surface controller derives its neutral seed from an identity matrix. The bootstrap
extraction itself introduces no GUI or MCP schema/default changes. Full native
controller execution, target group dispatch and native UI parity remain separate
requirements; these captures do not prove them. The shared worker integration is
described below.

The recovered surface refiner is now available as the distinct `nativeRefine`
processing action in the GUI and MCP. Its worker receives dedicated copies of
original indexed source/target geometry, converts selected moving triangles to
vertex flags, and runs the verified controller. It returns native matrix,
parameters, acceptance and objective values; only accepted results replace
geometry, retaining transformed indexed buffers for subsequent refinement.
Worker-boundary tests compare the retained original thread fixtures. This path
requires indexed PLY meshes and revealed geometry. It is separate from existing
point-cloud/mesh ICP; ordered indexed mesh target groups are now available in both
interfaces through the verified query kernel. CAD targets, other importer topologies,
hidden-geometry behavior still require verification. Multicore dispatch and the
bounded application pool are documented in NATIVE_ALIGNMENT_TARGET_GROUPS.md.

Whole-object paired-point, ICP and global alignment now retain the moving mesh's
indexed vertex ordering and connectivity in the shared worker. Every indexed
coordinate, including unused vertices, receives the same rigid transform as the
render buffer. Stale metadata fails before registration. GUI and MCP pass the
original topology only when operating on the full source buffer; partial
extractions do not inherit it. This verifies topology continuity into recovered
surface refinement, not native equivalence of the existing ICP/global solvers.

## Application landmark candidate side ordering

The shared registration worker previously called the paired-point wrapper with
moving landmarks first, then inverted its returned matrix. Although that often
produced a plausible moving-to-fixed transform, native optimization, line-spread
gating and candidate ranking are asymmetric. Original builder `0x14054c7a0`
passes fixed landmarks first and publishes the wrapper result directly.

`registerNativeLandmarks` now uses that original ordering and removes the extra
inversion. Its result is compared byte for byte to all published matrices in the
40 retained active/retained candidate captures; no-candidate and too-few-point
outcomes retain application validation. The standalone wrapper's native RMS is
also checked with correctly assigned moving/fixed inputs. The same helper feeds
GUI landmark requests and MCP paired `mesh_process` operations through the shared
processing worker. Subsequent original preview refinement remains separate work;
this fix does not promote the still-incomplete point-pair ribbon workflow.

Validation: production build passed with no warnings/errors; 544 focused tests
passed, including native publication bytes and the shared worker. The full suite
passed 340 files / 26,553 tests with 5 existing skipped files / 24 skipped tests.
The built browser/SDK replay compared an actual paired `mesh_process` result to
original candidate matrix bytes, verified moving-to-fixed landmark proximity and
moving mesh geometry, and confirmed fixed geometry preservation through Apply,
Undo and Redo. Receipt:
`.resources/landmark-direction-browser/browser-validation.json`. Disposable
browser/bridge helpers exited and temporary ports closed; live port 5173 remains
available. The broader native point-pair preview/refinement workflow remains gated.

## Native landmark refinement region growth

Fresh REA extraction recovered complete bodies and assembly for growth
`0x14054d330` and scratch clearing `0x14054b920`. Growth evidence:
`ev_8df226ebf9ce5f13c5cd1dceaff74e4c2a8036233dd3ebc370987fde50481d5a`
(pseudocode), `ev_d79550f232bdb5d2292db4b868912c91db759b189b631cd86545ac3cf9e8b269`
(assembly). Clearing evidence:
`ev_cdf61f787a8a33fe06790f4b67f9e812c365d263d432b6f11c77b59d01b160c9`
and `ev_909bddc63917ddbd0bc4db83fb2fe6137f869744412561030da01de389b4ecaa`.

`docs/evidence/landmark-refinement-growth-native.json` retains 88 direct
original-code cases and 248 growth steps. Original growth and clearing execute
unchanged, with compiled contiguous container getters and a controlled scratch
allocator/release using bit `0x80`. Cases cover empty/no-seed meshes, hidden
seeds, chains, a 4,001-face fan, degenerate/random triangles, existing face flags
and high UInt32 vertex bits. Every output vertex flag, face byte and selected-face
count matches an independent typed-array transition oracle. Scratch release is
observed once per call; native image allocations are released and processes exit.

The first pass clears the borrowed scratch bit on all faces, then marks faces
with any vertex satisfying `(flags & 5) == 4`. The second pass sets face selection
bit 4 and vertex bit 4 for marked faces. This preserves one-ring growth per call;
an in-place single-pass traversal would incorrectly expand across an entire
chain. Hidden vertices cannot seed expansion, but retain their other bits if
selected through another vertex's face. Unrelated flags, including high bits,
are preserved. The return value counts all faces with selection bit 4, including
previously selected faces, rather than selected vertices.

The enclosing `0x14054d440` statically stops after a growth call reaches at least
3,000 faces or the face count stops changing. Growth can overshoot: the fan case
selects 4,001 faces in one original call. The corpus records up to eight calls
per case, so long chains are partial growth sequences, not complete controller
executions. The outer loop, selection reset, scene target collection and full
refinement remain separate integration/verification requirements. No native
scratch-allocation policy, full preview or GUI picking claim follows.

Validation: all corpus inputs were structurally checked, its original image
identity verified, and all 248 outputs compared with zero differences. Prettier
and whitespace checks passed. This is a native-evidence/documentation slice;
application executable source and GUI/MCP contracts did not change, so application
build/test targets are not applicable. Native replay and REA helpers exited;
user-required live development on port 5173 was preserved. The complete goal
remains active.

## Original landmark preparation caller prefix

Fresh REA recovered reset `0x1402c2090` and the full refinement handler
`0x14054d440`. Reset evidence:
`ev_904b00d9dcdfc7075ee2f2f0ba0020ae2b19b360123948a9ee5ccddca57b48bc`
and `ev_63cb1dd7641100446bbee1a9d9c75d081c39ab6e22af1015bcd1cdad2945c4d5`.
Handler evidence:
`ev_6e6168202012f6f6588dc62feb115f9130fa04ebdf7f7d48142514aedb7e3152`
and `ev_c18a5f299529e65f9a6568e78dfde8fa0133a97969eb64002dbab3426bb5171b`.

`docs/evidence/landmark-refinement-preparation-native.json` captures 89 executions
of the original handler's preparation prefix, covering 3,351 original growth
calls. Entry, vertex reset, supplied nearest-landmark index seeding and the complete
stopping loop execute unchanged. At `0x14054d525`, execution is redirected to the
existing register/stack restoration at `0x14054de96`, before scene collection and
optimization; this also skips the cookie check. Compiled containers and controlled
scratch allocation/release remain adapters. This is preparation-prefix execution,
not execution of the complete refinement handler or native GUI.

Reset clears vertex bit 4 only; it does not clear face selection flags. Seeding
sets bit 4 on supplied indices without discarding other bits. The original loop
always grows once, then repeats until the returned face count reaches at least
3,000 or stops changing. Existing selected faces therefore contribute to that
count, and unchanged face count is the stopping condition rather than equality
of every vertex flag. The 4,000-face chain stops at 3,000 faces after exactly
3,000 passes, selecting 6,001 vertices. The 4,001-face fan stops after one pass.
All final vertex flags, face bytes, counts and call counts match an independent
UInt32/Uint8 oracle, including high bits and bit-1 seed exclusion.

The handler's later target collection, controller construction, normals/cache
preconditions and optimization remain outside this prefix capture. Nearest-index
mapping is independently verified above; these captures supply those indices.
No application runtime integration or GUI/MCP behavior change is claimed.
Validation checked the original image identity, buffer/index structure and all
89 outputs with zero differences, plus formatting/whitespace checks. Native
replay and REA resources exited and image allocations were released. Application
build/tests are not applicable to this evidence/documentation-only slice; live
port 5173 was retained and the complete goal remains active.

## Original landmark refinement call contract

After region growth and scene target assembly, handler `0x14054d440` constructs
controller `0x140aa8ea0` and invokes `0x140aaa570` at `0x14054dc74`.
The retained REA assembly evidence is
`ev_c18a5f299529e65f9a6568e78dfde8fa0133a97969eb64002dbab3426bb5171b`.

A bounded native replay executes the original call preparation from
`0x14054dc31` through `0x14054dc78`, replacing only the callee with an ABI capture
leaf and returning through a controlled caller frame. Three distinct scratch
sentinels confirm these supplied values:

- Third argument: `0x7fffffff` source sample budget.
- Fourth argument: Float32 `3.0`, promoted to double and stored in each selected
  source worker record at offset `0x38` by the retained controller.
- Fifth argument: Float32 `0.5`, passed to target surface preparation
  `0x140a7f470` through `XMM2`.
- Seventh argument: the application status object at the global pointer plus
  `0x6030`.

The caller does not initialize stack argument slots six and eight. The retained
controller uses those locations as local scratch storage (thread exit code and
current source vertex). They must not be reconstructed as user-facing options
merely because the decompiler includes them in its inferred signature.
Controller and output pointers differ by 96 bytes in the controlled frame.

`docs/evidence/landmark-refinement-callsite-native.json` retains original caller
bytes, their digest, constant bits and all three captures. The independent
external verifier checks the original image digest, unchanged callsite bytes,
consumer offsets and every captured value: three cases, zero differences.
Both image and executable capture allocations were released and the probe
process exited. This replay does **not** execute controller construction,
optimization, scene target collection or the installed GUI. Full point-pair
workflow readiness remains gated; this evidence closes its caller ABI contract.

## Original landmark target collection eligibility

Focused REA extraction of scene collector `0x14084be50` is retained as
`ev_6370dce497d87829f14446d4469bbb88eed4aa11d10bee77e2e0b153bf68e105`
(pseudocode) and
`ev_ebae9dead6786f2eece9494039a964482a23e2426c6f71f41df33d77c5ef1ea2`
(assembly). Landmark refinement calls it with a null exclusion root and
visible-only set to one. This collector precedes the separate visible scan
iteration and target geometry assembly in `0x14054d440`.

A native replay executes the original collector with controlled scene iteration,
RTTI query responses, visibility/suppression callbacks and empty dependency
containers. Output storage is preallocated; tree allocation/cleanup are adapted.
Across all 64 combinations of base-type support, suppression, visibility,
visible-only and four exclusion-type responses, the original output agrees with
an independent predicate: supported, not suppressed, visible when required, and
none of the three excluded type interfaces. Four additional native cases verify
empty iteration, interspersed rejected objects, original iteration order, and
retention of duplicate entries. The collector resets output end to output begin;
it does not append to the previous list or deduplicate entries on this path.

The excluded interface identities are `0x141164ba0`, `0x141176cd8`, and
`0x14115c770`. The mesh identity was already verified in
`docs/NATIVE_DATUM_ALIGNMENT.md`; the other identities are resolved below. Do not
assign these categories to our scene kinds based solely on address or guessed
semantics. Nonempty dependency lists additionally invoke readiness, suppression,
priority and dependency membership checks; this replay does not cover those
branches or the non-null exclusion-root tree. Complete scene-target parity must
retain those distinctions rather than substitute a generic visible-object filter.

`docs/evidence/landmark-target-collector-native.json` retains all 68 captures and
the exact input-image digest. External `verify-landmark-collector.mjs` checks
image identity, full unique eligibility coverage, output counts and ordered
results: zero differences. The probe image allocation was released and the
probe and owned REA server exited. No executable application behavior changed.

The related lazy target builder `0x140499b90` was extracted as
`ev_b989da893960514dcf36549c337ef9214075166399631585e027842b79a5b9ca`
with assembly
`ev_b38ece04b7d7fbd5d0f87af6e3c7685d085f068527b4591bde6883b475901851`.
Static evidence shows tessellation preparation depends on source bounds and a
stored quality value; it uses a bounds diagonal divided by 1.9, with a 1.0
fallback for invalid or tiny bounds, when dispatching the global builder. That
builder and the produced cache at object offset `0x600` still require runtime
verification. This is a separate preparation path from source normal generation.

## Original target dependency suppression and type policy

The original `0x14084be50` collector was replayed with nonempty dependency trees,
a null exclusion root and an eligible candidate of priority two. Controlled
scene lookups and virtual methods supply readiness, suppression, priority and
membership responses. Linked-tree traversal, early acceptance and accumulated
branch predicates execute unchanged. All 96 single-dependency combinations and
25 ordered two-dependency combinations match the independent verifier.

The original collector includes the candidate immediately if a dependency is
missing, not ready, or suppressed. Otherwise it accumulates two independent
conditions across the entire dependency list: at least one dependency has higher
priority and is not exempt under the type policy, and at least one dependency
reports membership of the candidate identifier. It excludes the candidate only
when both accumulated conditions hold. These conditions may be satisfied by
**different** dependencies. Equal priority is insufficient. A later invalid
dependency causes inclusion even after an earlier dependency satisfies both
conditions. A generic per-dependency exclusion test would produce different
results.

REA extracted type policy `0x140822300` as
`ev_95a86dc79d8cd6a5381660cf393f0d73ad15d8ad3097db52a0489d12d220e6b3`
(pseudocode) and
`ev_61899814cd35b0097474d589e085424243923d997f06d8b8a309df155ebfff3a`
(assembly). This original predicate also executes unchanged in the final
collector replay; only its RTTI virtual query responses are adapted. It returns
true for a null pointer or the first successful query among these six identities,
in order: `0x141154ef8`, `0x141176ca8`, `0x141176d18`, `0x141154fd8`,
`0x141155a78`, `0x14117cba8`. It returns false after six unsuccessful queries.
All 64 masks and the null-pointer case reproduce both the result and exact
short-circuit query order.

The final corpus `docs/evidence/landmark-target-dependencies-native.json`
contains 186 native cases: 121 collector cases and 65 policy cases. The external
independent verifier checks the original image digest, unique combinations,
collector counts and policy query sequences; zero differences. The task-owned
image allocation was released and the native probe and REA server exited.
The initial collector-only replay used a policy adapter; its results were
superseded by the final replay with the original policy routine.

This evidence does not establish the human-readable names of the six policy
types, the virtual methods' internal implementations, a non-null exclusion-root
hierarchy, CAD tessellation, optimization or installed GUI behavior. Those
coverage limits remain separate from the verified collector branch behavior.
No application code changed in this evidence slice; build and application tests
are not applicable.

## Original target interface identities

The eight remaining interface associations are now corroborated by both original
query execution and valid MSVC complete-object locator records from the mapped
image. `docs/evidence/landmark-target-type-queries-native.json` retains 24 original
query results, interface bytes, per-routine REA Evidence IDs and compiler type
records. Each routine was executed with its matching identifier and three
supplied this-pointer offsets. The independent verifier checks image identity,
original pointer-adjustment bytes, captured pointer deltas, locator signature,
locator self RVA and actual compiler type-descriptor names: zero differences.

| Interface identity | Native class association        | Query routine | Matching return adjustment |
| ------------------ | ------------------------------- | ------------- | -------------------------- |
| `0x141154ef8`      | Plane                           | `0x1404130a0` | -464 bytes                 |
| `0x141176ca8`      | Cylinder                        | `0x1404de350` | -192 bytes                 |
| `0x141176d18`      | Cone                            | `0x1404dcc10` | -432 bytes                 |
| `0x141154fd8`      | Reference line                  | `0x14040c850` | -192 bytes                 |
| `0x141155a78`      | Reference point                 | `0x14041a2f0` | -160 bytes                 |
| `0x14117cba8`      | Sphere                          | `0x14041f070` | -376 bytes                 |
| `0x141176cd8`      | Mesh-status/operation interface | `0x140466aa0` | -856 bytes                 |
| `0x14115c770`      | Vector point cloud              | `0x14089eb70` | -288 bytes                 |

The first six identities are exactly those queried by dependency priority policy
`0x140822300`. The final two are collector exclusions; the other exclusion,
`0x141164ba0`, was already verified as the mesh interface in
`docs/NATIVE_DATUM_ALIGNMENT.md`. The earlier assertion that all three exclusion
identities remained unidentified was too broad and has been corrected.

These identities are interfaces, not an exhaustive scene-kind enumeration. For
example, the previously verified rendering wrapper delegates unrecognized
queries to its attached mesh, which can cause the mesh exclusion to succeed.
The mesh-status routine appears in compiler vtables for imported, joined,
separated-body and split-solid operations. A label such as "CAD" alone cannot
reproduce this behavior; interface ownership/delegation and authoring
relationships must be preserved when integrating scene target selection.

This replay verifies matching query acceptance and pointer adjustments. It does
not construct native objects, execute delegated mismatch branches, prove all
classes implementing each interface, or validate complete alignment output.
All task-owned query image/code allocations were released and query/REA
processes exited. No application code changed; application build/tests are not
applicable to this evidence slice.

## Original CAD target preparation tolerances

Original lazy target-preparation routine `0x140499b90` now has a bounded native
replay. The original arithmetic and dispatch execute unchanged; the bounds
provider and global builder are controlled adapters, and the original square
root import is rebound to actual UCRT. This is parameter/dispatch verification,
not execution of the tessellator or proof of resulting cache geometry.

For valid bounds, the scale is their diagonal divided by 1.9. Invalid/reversed
bounds and the extreme-double sentinel cases use dimensions `(1, 1, 1)` before
computing this scale. If the computed scale is at most `1e-8`, it becomes 1.0.
The linear tolerance passed to the builder is evaluated in this order:
`(1 - quality) * 0.0004 * globalFactor * scale`. The angular tolerance is
`0.4886921905584123` radians (28 degrees), with double bits
`2493109cbb46df3f` in little-endian order. This routine does not clamp quality:
quality 1 passes zero linear tolerance; quality greater than 1 passes a negative
value. Validation or clamping inside the builder remains a separate question.

Dispatch requires either a nonzero source handle at object offset `0x618` or a
nonzero type identifier at `0x630`, and a present global builder. With both
source fields zero, or with no builder, no build call occurs.

`docs/evidence/landmark-target-quality-native.json` retains 135 numerical cases
across nine bounds fixtures, five quality values and three global factors,
plus five dispatch-gate cases. The independent external verifier checks the
original image digest, all linear/angular output bits and call counts: zero
differences. Bounds include oblong, zero, tiny, threshold, large, reversed and
sentinel cases. Image and code allocations were released, and the probe exited.

This native target-cache preparation is distinct from the application's current
CAD display tessellation. The latter intentionally uses its own display limits;
these captures do not justify replacing those limits or reducing imported STEP
display quality. Connecting the native alignment target cache still requires
verification of the builder's output and cache ownership/lifetime. No GUI/MCP
application behavior changed in this evidence slice; build and application tests
are not applicable.

## Original CAD cache builder dispatch and ownership

The retained image binds global builder pointer `0x141615220` to object
`0x1415d3c60`, whose vtable is `0x141158310`. Its slot `0x10` resolves to
`0x1402d9530`, the operation invoked by the previously verified tolerance
producer. Independent image readback checks this exact pointer chain.

REA extraction is
`ev_c1264e3fc5fbd6983576db0e009a0ecadcf434670d75a3f5a5b2f6861fef8bc8`
(pseudocode) and
`ev_69466b16aecb296ca6f0ad421c8488b66aac586c097f596252ee7f5e4c6d1623`
(assembly). Related slot `0x18`, `0x1402d9d80`, was retained as
`ev_a752a4be26dbebf383ff968f0b494e04747ab2d7e34032a7beafdcef35e863b9`
and `ev_00f737f335acdeab5efc89fc54dbdd92c58bd2a911bfcd88dc4d1e7daf998aa8`;
its output remains unverified.

A bounded original-instruction replay verifies 64 builder cases. Backend flag
`0x141615203` enables a minimum incoming linear tolerance of 0.005 mm. With a
nonzero CAD handle at owner `0x630`, this selects the alternate helper
`0x1402d8b30`. The original code allocates/constructs a new cache, calls the
helper, marks cache byte `0x158`, releases the previous cache via its interface
at `0xf8` with delete mode one, replaces owner pointer `0x600`, and notifies the
owner through its interface at `0x3b8`, slot `0x20`. It returns success for both
controlled helper return values. Actual helper failure/exception behavior is
not covered by substituting a return value.

On the standard path, linear tolerance is additionally limited by the builder's
minimum and maximum values. The replay uses 0.001 and 0.05 to exercise those
limits. The retained original builder instance has minimum zero and maximum
Float32 maximum. Standard provider parameters are captured, then execution is
redirected to the original epilogue before per-face work and cache assembly;
this does not claim standard-path mesh output or full ownership verification.

The alternate helper call writes its fifth argument as the builder's flag byte
(true in the captures) and sixth argument as null. Its fourth integer register
slot is not initialized by the callsite. An initial capture adapter assigned
those trailing parameters to the wrong slots; the independent verifier detected
that error. The final corpus was rerun with corrected ABI slots and supersedes
the preliminary external capture.

The original prefix also examines objects in the owner vector at `0x5d8`.
For a non-null entry with an empty 48-byte record range at `0x390..0x398`, it
invokes curve-related preparation `0x14027cbd0` only when the absolute difference
between stored tolerance `0x3d0` and incoming tolerance exceeds `2^-23`. It then
stores the incoming tolerance. Nonempty record ranges, smaller differences and
exact equality to the threshold skip preparation. Twenty-eight additional
captures verify both backend flags, empty/nonempty ranges and seven threshold
positions, including exact positive and negative threshold equality. The
preparation helper's geometry output is adapted and remains unverified.

`docs/evidence/landmark-cad-builder-lifecycle-native.json` retains all 92 cases.
The independent verifier checks pointer binding, branch tolerances, alternate
cache replacement/release/notification counts, meaningful trailing call slots,
and curve-prefix threshold transitions: zero differences. Allocation,
constructor, tessellator/provider and virtual-method interfaces are adapters;
these captures do not contain real tessellation output. Task-owned image/code
allocations were released and the probe and REA server exited. No application
code changed; build and application tests are not applicable to this evidence
slice.

## Original alternate tessellation provider options and empty results

REA extraction of alternate wrapper `0x1402d8b30` is retained as
`ev_24361f0fec9ddde304c2b368c351ce708d1e0f9b5e7ebb0b336273a980247038`
and `ev_ee758c974d0965477ec0166865d91f0151fff1f75dcf5c10e58860c00cd2e5b9`.
Standard per-face extraction `0x1401ed610` was retained as
`ev_092c46d54a779559e9bf1c14e0d4ac9b12954404a5c9516c5dffc5b4282d7aa8`
and `ev_945d952e2597d665da97f30a413e14ca8e56b2470400d75f662c923244b5b8b1`;
its populated output remains unverified.

A complete original-wrapper replay with an adapted provider returning an empty
metadata table verifies 96 option combinations and one zero-handle case. The
wrapper multiplies incoming tolerance by 1.5, then replaces that value with the
global override at `0x1415a20b0` only when the override is positive. Provider
primary tolerance is this value times the factor at `0x1415a20c8`; secondary
tolerance is evaluated as this value times 0.2, then times the factor. The
retained image's factor is 0.001 and its override is negative Float32 maximum.
The wrapper receives already-normalized tolerance from its caller; it does not
perform the caller's 0.005 minimum itself.

Captured provider options have version 28 and mode `0x502a`, or `0x5029` when
flag `0x14764d782` is enabled. Two option bytes follow the caller's fifth
argument. Each provider invocation receives one handle, the supplied handle
value, and a null selection pointer. The wrapper temporarily clears global
byte `0x1415a20c0` during the provider call and restores its prior value on
normal completion. The final replay retains the original cookie check and
return instructions. Empty metadata produces result byte zero; handle zero
also returns zero and skips provider invocation entirely.

The decompiler infers a void signature here, but assembly writes the result byte
into `EAX` before returning. Captured empty results establish that return byte;
populated-result success and failures are separate coverage. The previously
verified enclosing builder does not branch on this result and still installs
the constructed cache. That observation is not a guarantee that real provider
failures or exceptions are safe or equivalent to returning empty metadata.

`docs/evidence/landmark-facet-provider-native.json` retains all 97 cases.
The independent verifier checks original image identity, unique option coverage,
tolerance values, version/mode and flag fields, call arguments, global-state
transitions and return bytes: zero differences. The mapped image and code
allocation were released; native probe and owned REA server exited.

An offline attempt to bind the two retained external provider addresses to the
supplied kernel DLL's exports did not produce a common, page-aligned module
base. Therefore their exported symbol identity is not claimed verified. The
external export comparison is retained for follow-up rather than used as proof.
Populated facet-table conversion, real engine tessellation, standard per-face
output and complete GUI/MCP alignment remain outstanding. No application code
changed; build and application tests are not applicable to this evidence slice.

## Original populated facet-provider conversion

The original alternate wrapper `0x1402d8b30` now has 48 complete executions with
controlled populated provider tables. Twenty-four deterministic fixtures vary
coordinate/normal index maps, corner-slot maps, face identifiers and unit
factors; each is executed with optional vertex attributes disabled and enabled.
This covers 306 converted vertices and 188 constructed triangles.

The wrapper consumes provider table tags `0x57b2` (ordered facet/corner pairs),
`0x57b6` (corner-slot mapping), `0x57b7` (coordinate mapping), `0x57b8` (normal
mapping), `0x57bb` (double coordinates), `0x57bc` (double normals), and `0x57c0`
(face identifiers). Optional attributes additionally use `0x57b9` and `0x57bd`.
These descriptions follow observed consumption and supplied table layouts;
they do not claim official provider schema names.

Consecutive corner pairs with the same facet index are grouped into a triangle
record. Corner order is preserved after applying the slot map. Vertices are
created in provider map order, rather than welded or sorted by coordinate.
Coordinates are multiplied by global factor `0x1415a20b8`, then cast to
Float32; mapped double normals are cast directly to Float32 without coordinate
unit scaling. Face identifiers are copied into output triangle offset `0x40`.
With optional attributes enabled, four source Float32 values are copied into a
24-byte output record followed by eight zero bytes for each vertex.

The replay uses supplied provider tables, bounded vector storage, mesh container
adapters, triangle insertion, result-release and final-refresh callbacks. The
original grouping, indexing, coordinate arithmetic, attribute copying,
face-identifier writes, provider-release call and final-refresh dispatch execute
unchanged. Each case returns result byte one, releases provider results once,
and requests one final refresh for `[0, triangleCount)`.

`docs/evidence/landmark-facet-conversion-native.json` retains inputs, outputs and
coordinate/normal byte captures. The independent verifier checks the original
image digest, all Float32 output bits, triangle order, face IDs, optional
attribute bytes, release count and refresh range: zero differences.

A preliminary storage adapter used a 4 KiB scratch capacity without the
allocator's large-allocation metadata; native cleanup rejected that layout.
The final replay uses a 512-byte scratch capacity sufficient for these bounded
fixtures. The failed external fault record remains retained. The successful
probe released image/code allocations and exited; no analysis helper remains.

Real engine tessellation, malformed provider tables, polygons with other than
three corners, populated triangle insertion internals and final refresh
geometry/normals remain unverified by this replay. In particular, the recorded
normals are those immediately after provider conversion; they are not proof of
normals after the final refresh helper. Application integration must preserve
this boundary. No application code changed; build and application tests are
not applicable to this evidence slice.

## Original facet insertion and final cache refresh

The populated conversion replay now calls original triangle insertion
`0x1401de690` and final facet refresh `0x140b384b0` unchanged. Face allocation and
container access remain adapters. The final refresh's square-root import is
rebound to actual UCRT. Forty-eight cases cover 306 vertices and 188 triangles,
including zero-area and collinear geometry; provider vertex normals remain
byte-for-byte unchanged through refresh.

Fresh REA records are:

- Refresh: `ev_008727618f501011126b49812e7070afb31a7660534401e8ed43513f93fd873d`
  and `ev_ac8ab551fee91a86be48d49e34bec93ea3ebf6a52a5df7ca255b76b37aac0840`.
- Insertion: `ev_f4021e3cac8ca677fe57b02089e7352877e5c00deaeb82a7d2f5b4dcf9e282fc`
  and `ev_c5751ebf96e95efd723864d397a3fa5163d548d24d9642e8fc6e621b739029b7`.

The refresh reads triangle vertex coordinates, computes edge differences and
cross products in double precision, and divides by a Float32-rounded length
when length exceeds double epsilon. Otherwise it retains the unnormalized
cross product. It writes Float32 face normals at offsets `0x18..0x20` and the
degenerate byte at `0x48`. It does not write vertex normal storage. This matches
the existing shared `nativeAlignmentFaceCache` arithmetic.

`tests/fixtures/alignment-cad-facet-cache-native.json` retains native face-normal
bits, degenerate flags, coordinates and triangle indices for all 48 cases.
`tests/scan-native-cad-facet-cache.test.ts` checks both the direct face-cache port
and the prepared target surface used by GUI/MCP native refinement. It verifies
exact normal bytes, degenerate flags and input preservation. The independent
external verifier additionally checks provider coordinate/normal conversion,
triangle/face-ID order and attribute bytes against the complete retained native
captures: zero differences. Full captures, scripts and allocation-release
receipt are retained externally as `landmark-facet-cache-*`.

This closes the final-refresh and triangle-insertion coverage gaps of the
preceding conversion replay for these controlled inputs. It does not execute
the real tessellation engine, arbitrary provider errors or complete point-pair
scene refinement. Source normals supplied by the provider must not be described
as regenerated by this final face-cache refresh. Application source-normal
preparation is a separate integration boundary.

Validation for this cache-refresh regression slice: `npm run build` passed with
Node heap bounded at 1536 MiB after a preliminary 768 MiB attempt exhausted the
TypeScript heap. The existing 1536 MiB free-memory admission guard remained
unchanged. Focused alignment validation passed 16 files and 323 tests. The full
application suite passed 341 files and 26,601 tests, with five files and 24 tests
skipped under existing suite conditions. Changed-file Prettier and whitespace
checks passed. No GUI/MCP operation or schema changed; the new coverage verifies
the existing shared prepared target surface. The live application on port 5173
was observed responding after the rebuild.

## Indexed scanner normals carried through application alignment

The shared import and refinement path now retains optional `IndexedMesh.normals`
in original vertex order, including unused PLY vertices. Provided normals are
validated and copied as Float32 data by source preparation; their directions and
magnitudes are preserved rather than replaced by generated mesh normals. The
existing native-derived generator remains the fallback when the field is absent.
The 48 populated native facet-cache fixtures now also check supplied vertex
normal bytes through the application's source-preparation routine.

The optional data survives GUI/MCP PLY import, JSON and streamed JSON saving,
binary current/history snapshots, worker input/output copies and rigid
alignment. Metadata edits retain it; invalid indexed topology is discarded by
the existing retention rules. Paired/ICP/global, native surface refinement and
origin/reference alignment rotate indexed normals with geometry. General mesh
transforms rotate the vectors without translation or uniform scaling.

Browser validation exposed a display-normal mismatch: the GUI paired operation
kept old display vectors while MCP cleared them. Both now expand display normals
from the transformed indexed records through one shared helper. The expansion
uses a preallocated output array and preserves triangle order. Point-cloud paths remain unchanged. Meshes without supplied indexed scanner
normals retain the existing native-derived source-normal fallback.

MCP coverage uses existing `project_import`, `mesh_process`, `mesh_transform`,
`object_get`, project export/import and history operations. Geometry artifacts
include optional indexed normals; discovery text and the agent guide explain
this data. Request parameters, revision/retry/cancellation policy and source
buffer ownership remain unchanged. Older projects remain valid without this
field; previously imported data cannot recover missing original normals on
unused vertices without reimporting its source file.

Focused regression coverage checks malformed normals, supplied magnitudes,
unchanged source buffers, original unused vertices, rotation, all project save
formats, worker transfers and MCP geometry access. The browser/MCP harness now
uses the current explicit `landmarkAlignment` and `fineAlign` workspace entries
instead of the old catch-all processing entry. It verifies GUI/MCP import,
indexed scanner normals, unit conversion, origin placement, binary persistence,
transforms, undo, paired geometry parity and native target-group refinement,
with no console errors. This source-normal integration does not establish
complete point-pair scene refinement or real CAD tessellation-engine parity.

Validation for indexed-normal integration: production build passed with no warnings
or errors; focused validation passed nine files and 594 tests; the full suite
passed 341 files and 26,607 tests (five files and 24 tests skipped). Changed-file
Prettier and whitespace checks passed. The real browser/MCP harness passed all
recorded import, persistence, transform, undo and alignment comparisons with no
console errors. The temporary browser, MCP bridge and artifact HTTP listener
closed in `finally`; subsequent observation found no remaining owned processes
or listeners. Build manifest is `scanforge-16dcadad26643b2e`. Port 5173 remains
live for user testing; no push or deployment was performed.

## Original landmark refinement apply and selection-state transition

The original reset/seeding/growth prefix of `0x14054d440` has been joined to its
original post-controller identity check and selection-clear tail in a bounded
native replay. A controlled 96-byte controller matrix is copied into the native
stack frame between these sections; scene collection and controller execution
are skipped. Original identity predicate `0x1401dd330`, face-selection reset
`0x14031fb60` and the vertex clear loop execute unchanged. The object's transform
method is an adapter that captures the matrix rather than changing geometry.
Execution exits through the original register/stack restoration before later
cleanup/UI callbacks and skips the caller's cookie check.

Eight matrix cases run over all 89 previously verified region fixtures, including
long-chain stopping, fan overshoot, hidden seed vertices, preselected faces and
high unsigned vertex flags. This produces 712 cases and 26,808 original growth
passes. Identity, half-epsilon and exact-epsilon translation changes are not
applied; a diagonal change of exactly epsilon is also not applied. Translation
or diagonal changes greater than epsilon, including negative translation, are
applied once. Epsilon here is double epsilon, `2^-52`.

For all 356 identity cases, the grown vertex and face flags remain unchanged.
For all 356 applied cases, only selection bit four is cleared from every vertex
DWORD and face byte. All other bits, including high unsigned vertex bits and
borrowed scratch bits, remain unchanged. The captured application matrix bytes
match the supplied controller matrix exactly. This decision depends on the
matrix's component differences, not whether Float32 coordinate storage would
visibly change after applying a tiny transform.

`docs/evidence/landmark-refinement-state-native.json` retains unique input matrices,
per-case flag-buffer digests and captured application matrices, linked to the
existing preparation corpus by SHA-256. Full raw flags remain in the external
`landmark-refinement-state-native.json` capture. The independent
external verifier checks original image identity, unique case coverage,
component-wise identity tolerance, application counts/bytes, growth pass/seed
identity and final flags against the independently verified preparation corpus:
zero differences. The probe's image/code allocations were released and its
process exited. This does not verify actual object coordinate/normal application,
scene targets, controller numerical output, UI state or complete preview/cancel.
No application code changed; build and application tests are not applicable to
this evidence slice.

## Point-pair preview, Reset and Cancel dispatch

The point-pair dialog message-map descriptor at RVA `0x119dd60` points to
entries at RVA `0x119daf0`. Reading the original mapped image verifies six
command bindings: Cancel (2) to `0x14054c310`, Preview (1106) to
`0x14054ca20`, accept (1107) to `0x14054cb70`, Reset (4451) to
`0x14054cee0`, remove-last (4452) to `0x14054ce30`, and clear-all (4453)
to `0x14054ce90`. This resolves Cancel from dispatch evidence rather than
guessing from adjacent geometry methods or vtable slots.

The extracted preview helper `0x14054c410` creates an original-geometry backup
on the first valid preview. Subsequent previews clone that backup before
applying the next candidate matrix; they do not compound transformations on
the previous preview. It also snapshots the original tagged point records.
Moving points are transformed from that snapshot using double arithmetic;
fixed points retain their original coordinates. Null moving objects and
out-of-range candidate indices skip the body.

Reset clears the preview flag and candidate vector, restores geometry and
the original picked point records, marks rendering dirty, destroys the backup
wrapper and clears its pointer. Picked pairs therefore survive Reset.
Remove-last and clear-all operate only while the preview flag is unset;
after preview they return without changing the records or refreshing the UI.

Cancel clones the backup geometry back into the moving object, replaces its
geometry ownership links, destroys the displaced preview geometry and marks
rendering dirty, then delegates to dialog virtual slot `0x358`. Its handler
does not itself clear or destroy the backup. Accept delegates to the same
slot without restoring geometry. Disposal and history behavior behind that
slot remain unverified. Window-close has a separate message-map entry at
`0x14054c400`; its behavior is not established by Cancel's body.

`docs/evidence/landmark-preview-lifecycle-static.json` retains the nine original
message entries, their raw bytes, six REA pseudocode extracts and Evidence IDs,
and the original mapped-image digest. The external bounded-memory verifier
reads the map directly and checks all six bindings. These are static findings,
not native execution or full GUI/MCP workflow parity. No application behavior
changed, so application build and tests are not applicable to this slice.

## Native execution of point-pair dialog state handlers

The original Cancel (`0x14054c310`), accept (`0x14054cb70`), Reset
(`0x14054cee0`), remove-last (`0x14054ce30`) and clear-all (`0x14054ce90`)
handlers now execute in a bounded native replay. The original instruction bytes
perform branch decisions, pointer replacement, virtual-base ownership updates,
preview/candidate resets, and destructor dispatch. Host adapters provide
allocation, geometry cloning, point-record copying, destruction, rendering and
UI callbacks. Reset completes through its original tail jump to the shared
UI-refresh adapter. No other parts of the handler are skipped.

`docs/evidence/landmark-dialog-state-native.json` records 152 cases:

- 16 Cancel and 16 accept cases cover backup presence, displaced geometry
  presence, allocation success/failure, and both preview-flag states.
- 20 remove-last and 20 clear-all cases cover zero through nine records and
  both preview states.
- 80 Reset cases cover those four Boolean conditions and original point-record
  counts of zero, one, three, six and nine.

Cancel calls the clone adapter with the backup's geometry and mode 1, detaches
the displaced geometry, attaches the returned clone, dispatches destruction,
marks rendering dirty, and closes. Without a backup it only closes. It retains
the backup pointer for later disposal. Accept only closes and preserves geometry.
Reset restores the backup geometry and original point-record range, destroys
the backup exactly once, clears its pointer and candidate range, clears preview,
redraws and refreshes. Without a backup it still clears candidates/preview and
redraws, while retaining the existing point records. Removal/clear are complete
no-ops after preview; before preview they refresh even when already empty.

All 152 cases match the expected transitions with zero differences. An external
verifier separately checks operation counts, clone-source identity, callback
arguments, point counts and cleared/retained state. The native image allocation
was released and the replay process exited. Allocation-failure cases characterize
the original branch, not a recommended application failure policy.

These captures do not establish real geometry-clone fidelity, the preview
matrix handler, window-close, actual dialog disposal or model-history behavior.
The geometry and record-copy operations are explicitly adapters, not native
kernel measurements. Full GUI/MCP point-pair workflow integration remains gated.
No production code changed; application build/tests are not applicable here.

## Original preview handler execution and window-close binding

The complete original preview handler `0x14054c410` now executes with controlled
allocation, backup-wrapper construction, geometry clone/attach/apply, original
point-record snapshot and redraw callbacks. The original candidate guards,
backup decisions, point tagging and double coordinate-transform instructions
execute unchanged. The supplied geometry has no pending-status or removable
attachment, so those branches are not covered by this capture.

Five point counts (0, 1, 3, 6 and 9) each run three successive candidate matrices,
then invalid indices -1 and 3. A null-moving-object case brings the total to 26.
The first preview constructs one backup and snapshots the points. Subsequent
previews clone the saved original geometry, replace the current geometry and
apply the requested matrix once. Their point transforms always start from the
original snapshot, rather than previously transformed points. All 57 observed
point records match an independent verifier bit for bit; fixed-tag records
remain unchanged. Moving-tag arithmetic uses Y-times-coefficient before
X-times-coefficient, then Z and translation, all in double precision. Invalid
indices and null moving objects produce no callback or point-buffer changes.

The original window-close entry `0x14054c400` contains exactly
`e9 0b ff ff ff`, a relative jump to Cancel at `0x14054c310`. This establishes
its dispatch to the separately replayed cancellation handler. It is not a new
decompilation claim, and no additional close/disposal logic is inferred.

`docs/evidence/landmark-preview-native.json` retains the 26 cases, matrices,
original/observed points, callback order, original image identity and window-close
branch bytes. The independent external verifier checks coverage, callback
source identity, exact double point results and branch destination: zero
differences. The replay's mapped image was released and all observed owned
replay processes exited. Allocation and geometry callbacks remain adapters;
this does not prove real mesh cloning/application, controller numerical output,
actual dialog disposal, model history or full GUI/MCP point-pair integration.
No production code changed, so application build/tests are not applicable here.

## Shared application point-pair session lifecycle

The application now uses the verified point-edit guards: picking after preview
requires Reset; remove-last and clear are no-ops after preview. The dialog locks
target/pick controls and exposes Reset. Reset drops the transactional preview
while retaining the original picked coordinates and source/target objects.
Committed geometry remains unchanged throughout preview, so restoration does
not require a second geometry clone. Preview markers use the original native
Y-first double arithmetic, matching all 57 point records in the native capture.

`landmark_get` exposes structured picks, markers, object IDs and preview state.
`landmark_edit` begins or edits the same editor session through the stable
React/MCP adapter, with existing revision, retry and operation-admission checks.
`preview_discard` retains cancellation ownership. This capability edits session
state; it does not expose numerical solving or acceptance, and the complete
native point-pair ribbon command remains gated.

Validation: production build and TypeScript passed; 82 focused tests across 15
files passed; the full suite passed 26,610 tests with 24 existing skips (341
passed files, five skipped). The browser/MCP round trip opened the session,
picked three pairs, previewed through the GUI, observed locked controls and
no-op removal, reset through MCP, resumed removal through the GUI and cancelled
through MCP. Committed moving/fixed geometry remained unchanged, and the
existing import, indexed-normal, refinement, persistence and undo checks passed
with no console errors. Formatting and whitespace checks passed. The browser,
MCP bridge and temporary HTTP server exited after verification. Build manifest:
`scanforge-0c7f52cdcfc5edb6`. Port 5173 continues serving the latest bundle.

## Native seeded region integration and bounded frontier traversal

`prepareNativeLandmarkRegion` now reproduces the complete original preparation
prefix: clear vertex bit 4, preserve other vertex bits, seed original indexed
vertex IDs, clear borrowed face bit 128, and execute snapshot growth until the
selected face count reaches 3,000 or stops changing. Existing face bit 4 remains
part of the stopping count. Hidden vertices can receive bit 4 but cannot seed
further growth. Empty/stable cases still perform the original second pass below
the threshold, and a first pass may overshoot the threshold.

The implementation builds indexed incidence once and uses two reusable typed
frontiers. Eligibility only accumulates during this prefix, so previously reached
faces remain eligible; each incidence is visited at most once. Final flags and
pass counts are independent of traversal order because marking precedes vertex
promotion. All owned typed buffers are included in a 256 MiB allocation budget.
No vertex welding is performed. All 89 original preparation captures match every
vertex flag, face flag, selected count and stopping pass without input mutation.

GUI Fine align and MCP `mesh_process/nativeRefine` accept optional source seed
vertex IDs. The client copies/transfers the seed buffer; the shared worker passes
the grown vertex flags to the existing controller in selection-only mode. That
mode skips sampling and preserves original indexed order and logical CPU lanes.
The existing bounded CPU pool is reused. Preparation itself runs serially inside
the processing worker. Full point-pair coarse/refinement assembly, scene target
collection and CAD integration remain separate gates; the ribbon command is not
enabled by this preparation slice.

Validation: production build/TypeScript passed, 164 focused tests passed, and the
full suite passed 26,701 tests (342 files) with 24 existing skips (five files).
The browser/MCP check exercised seeded refinement with two physical workers,
matched GUI and MCP geometry exactly, verified region diagnostics and retained
fixed targets. Existing indexed-normal, import, persistence, undo, native surface
and landmark lifecycle checks also passed with no console errors. Formatting,
whitespace and worker-buffer ownership checks passed. Owned browser/MCP/HTTP
helpers exited; port 5173 serves the current source. Build manifest is
`scanforge-7a04a88a1bd86ebf`.

The original chain-4000 capture takes 3,000 passes. Its two full face loops imply
24,000,000 face visits; the port performs 8,998 incidence visits plus its initial
linear topology construction, with identical output flags. A bounded warm Node
benchmark measured a median 0.3151 ms for this synthetic preparation case across
20 retained samples after five warmups. This is neither browser end-to-end
latency nor a measured native speedup. The external receipt is retained under
`.resources/seeded-region-benchmark.json`; the benchmark process exited.

## Native coarse/refinement Float32 stage boundary

The original vertex worker `0x1401deb20`, face-normal worker `0x1401ded20`, and
identity predicate `0x1401dd330` were replayed for 144 two-stage cases. Eight
retained original landmark matrices are paired with three captured controller
matrices and three identity/epsilon cases, each over one, two and four logical
ranges. Ranges execute serially; this capture does not establish scheduling.
The first frame always applies. The refinement frame applies only when the
original predicate finds a component difference greater than double epsilon.
There are 96 applied and 48 skipped refinement cases. Caller-owned record lookup
adapters provide positions, vertex normals and face normals, including signed
zeros and finite non-unit normal components near `1e18`.

`docs/evidence/landmark-two-stage-native.json` retains matrix bits and both stages'
Float32 field bits under the original image digest. An independent external
verifier matches all 864 stage-field comparisons. Replacing two applied stages
with their multiplied matrix produces 240 different final field buffers across
this corpus. The controller, geometry cloning, scene collection and UI are not
executed here, so these counts do not certify the complete point-pair pipeline.
Mapped native memory was released and the replay process exited.

The shared transform kernel now retains Float32 storage between applied stages.
It also fixes the erroneous application of the coordinate range limit to normal
vectors: finite vector magnitudes are preserved, while position bounds and
nonfinite-output rejection remain enforced. Datum GUI/MCP paths use this same
kernel; no operation schema change is needed. The internal staged helper is
used by datum scan application and is ready for coarse/refinement assembly.
Original refinement identity filtering remains the caller's responsibility.

Validation for this slice: production build and TypeScript passed; 2,832 focused
tests passed; the full suite passed 26,846 tests across 343 files with 24 existing
skips across five files. The browser/MCP regression used a PLY with a finite
normal near `1e18` and passed import, origin placement, binary persistence,
transform/undo, indexed topology and CPU refinement checks without console
errors. Formatting, whitespace, native evidence structure and branding checks
passed. The native replay, browser, MCP bridge and test workers exited. Port
5173 serves the latest kernel; its owned 24-hour lease was refreshed without
restarting the server, and the temporary inspection listener was closed.
Build manifest: `scanforge-a1a7453a5a32e816`.

## Compact selection-only source construction

The shared refinement controller now builds query records only for selected
visible vertices when selection-only mode is active. The previous constructor
created a record and two coordinate arrays for every mesh vertex before lane
partitioning. The compact constructor retains original indexed order, unsigned
flags, Float32 coordinates and supplied normal values. All inactive coordinates,
normals, flags and triangle indices remain validated. Supplied scanner normals
are read in place without full-size coordinate/normal copies. Without supplied
normals, the previous whole-mesh normal computation remains unchanged.

This path applies automatically to GUI and MCP selected/seeded refinement.
The existing whole-source sampler is unchanged. Logical lane assignment and
ordered reduction receive the same selected records; internal unused compact
indices are not published as original vertex IDs. Tests compare all 89 original
region captures through the verified full constructor and match records and lane
contents for 1, 2, 4 and 16 lanes, including hidden and high unsigned flags.
Native controller fixtures and worker transfer/cancellation checks also pass.

Validation: production build/TypeScript passed; 773 focused tests passed; browser
and MCP checks passed, including two physical CPU workers and identical seeded
geometry, with no console errors. The initial full suite had one existing
release-planning timeout at five seconds; its focused rerun passed, and the
unchanged repeated full suite passed 26,936 tests across 344 files with 24 existing
skips across five files. Formatting and whitespace checks passed. Owned browser,
bridge, benchmark and test processes exited. Port 5173 serves the current source.
Build manifest: `scanforge-995bf2505d27f39c`.

A bounded synthetic Node test with one million vertices, supplied normals and
three selected vertices produced 3 query records instead of 1,000,000, with
identical selected values. One measured construction per path took 15.87 ms for
the compact constructor and 499.40 ms for the full constructor. This is not a
browser end-to-end benchmark, native timing comparison or repeated statistical
speedup result. The local receipt is `.resources/selected-source-benchmark.json`.
Full point-pair coarse/refinement assembly remains a separate pending gate.

## Combined coarse application and refinement replay

`docs/evidence/landmark-joint-controller-native.json` retains six executions
against the same mapped-image digest as the preceding native captures. Original
source normal preparation and target cache construction run first. The original
vertex and face workers then apply a supplied coarse translation, the original
refinement thread computes its delta, and the original identity predicate gates
the final application. Inputs include a pair, a single bucket, same-winding
faces, a tetrahedron, a random surface and a curved grid.

`tests/native-joint-controller.test.ts` feeds those captured inputs through the
application's transform kernel and indexed refinement controller. All six cases
match the native parameters, matrix, initial and final objective values,
acceptance state, intermediate normal bytes, and final vertex and normal bytes
exactly. This connects the separately verified transform and refinement stages
without collapsing their Float32 storage boundary.

The capture uses the existing allocator, storage and query adapters with serial
scheduling. It supplies the coarse matrix and selects all source vertices; it
does not execute coarse landmark registration, seed growth, scene collection,
dialog interaction or physical multicore scheduling. Its search radius is the
captured controller fixture value, not proof of the point-pair caller's defaults.
It does not verify the owner's three complete scans or enable the full point-pair
command. Native allocations were released and the exact replay PID exited.

Validation: the production build and TypeScript check passed without warnings
or errors; all six focused cases passed. The full suite passed 26,942 tests
across 345 files, with 24 existing skips across five files. Formatting,
whitespace, fixture structure and branding checks passed. This change adds
evidence and regression coverage only; it changes no GUI/MCP operation or
schema. No new browser workflow was introduced. The existing live server on
port 5173 returned HTTP 200 for the current alignment source.

## Shared indexed point-pair coarse/refinement assembly

The indexed point-pair preview now calls the shared processing worker's assembled
path. Original moving landmarks map to original indexed vertex IDs before any
transform. The source region uses the verified ring-growth routine, preserving
existing face-selection flags in its stopping count. Missing scanner normals are
computed on original geometry. Supplied normals retain their magnitudes.

The worker applies coarse registration first, retaining Float32 coordinates and
normals, then refines the selected visible region with a 3 mm radius, 0.5 mm target
minimum extent and the recovered refinement controller. The existing bounded CPU
pool uses two logical lanes by default. The delta is applied only when the native
double-epsilon identity predicate requires it. Final output moves the entire scan,
including orphan vertices, and retains original triangle connectivity. Applied
refinement clears the grown face-selection mask; identity retains that grown
selection. The fixed
target is unchanged. Marker placement and `registration` retain the coarse frame;
the separate `refinement` reports the surface stage.

The GUI session and MCP `mesh_process` operation use the same target validation
and worker. MCP enables this path with paired `refineSurface: true` and `targetId`;
coarse-only calls remain compatible. Dedicated transfer copies preserve scene
and undo buffers. The worker avoids constructing an unused coarse render/indexed
replacement before the refinement path, and reuses immutable Float32 source
buffers while constructing stage output.

`tests/native-landmark-refinement.test.ts` runs the assembled helper against all
six retained combined native captures and compares exact final vertex and normal
bytes, parameters and objective values. These fixtures select all source vertices
and supply a coarse matrix; their captured search radius is explicitly retained.
They do not execute complete landmark registration, scene collection or native
physical multicore scheduling. The ribbon remains gated pending complete native
workflow comparison on the owner's scans and CAD/point-cloud target integration.

Validation: production build/TypeScript passed without warnings or errors; 336
focused tests passed, including exact native output with supplied and generated
source normals. The full suite passed 26,951 tests across 346 files, with 24
existing skips across five files. Browser/MCP checks passed with two physical
workers, matching GUI Preview/OK and MCP replacement geometry, unchanged fixed
geometry, reset/cancel, indexed topology and undo restoration, with no console
errors. The expanded browser sequence initially exceeded its three-minute helper
lease after geometry checks; its finite lease is now four minutes, with operation
timeouts and memory admission unchanged. The complete rerun passed and cleaned its
owned browser, bridge and HTTP server. Formatting and branding audits passed.
Build manifest: `scanforge-b352e1e7a449b440`. Port 5173 serves the new module.

## Full-resolution owner landmark and refinement captures

`docs/evidence/owner-landmark-preparation-native.json` retains original coarse
candidate and complete region-growth prefix executions for the three PLY scans
in the owner-supplied alignment folder. Their indexed counts are 140,113,
1,375,494 and 1,865,848 vertices, with 274,154, 2,697,877 and 3,691,133 triangles.
Three deterministic, spread source vertices supply moving landmarks; nearest
vertices on scan 1 supply fixed landmarks. This is a declared numeric capture
input policy, not a recovered automatic correspondence algorithm or observed UI
point-picking session. Native coarse matrix bits match the application exactly.
All vertex/face flag buffer hashes match after 14, 15 and 18 growth passes,
selecting 3,204, 3,180 and 3,368 faces.

`docs/evidence/owner-landmark-controller-native.json` retains a second native
replay on complete scans 2 and 3 against complete scan 1. It uses the preceding
captured coarse matrices and grown vertex sets, raw supplied PLY normals, the
original target builder, two-lane ConCRT refinement, original epsilon identity
test and original vertex/normal application worker. Entire resulting position
and normal buffer hashes match the application: 3,241,342 vertices and their
normals, totaling 77,792,208 bytes. Refinement parameters, matrices, initial and
best objectives also match exactly. The application comparison uses the same
two logical lanes with serial scheduling; physical browser-worker scheduling is
verified separately. These captures do not execute complete native UI, scene
collection or CAD/point-cloud paths, and do not measure native performance.

The owner tests are opt-in because scan files remain outside Git. Set
`SCANFORGE_ALIGNMENT_EXAMPLES` to the supplied folder and run
`tests/native-owner-landmark-preparation.test.ts`. All five owner cases passed.
The additional helper checks, including all 712 original tail transitions, also
passed: 14 focused tests total. Native replay allocations were released and the
recorded processes exited. Full output buffers and replay source/cleanup receipts
remain in the external analysis directory.

This verification also corrected the identity-delta selection result: it must
publish the grown region, rather than the old pre-growth input mask. Applied
refinement clears the selection. GUI acceptance and MCP now consume the same
returned mask; scene and undo buffers remain immutable.

Final validation for this change: production build/TypeScript passed without
warnings or errors; all 14 focused tests passed with owner files enabled. The
default full suite passed 26,953 tests across 346 files, with 29 skips across six
files; five of those skips are the new external-file cases explicitly passed in
the focused run. Browser/MCP regression passed with two physical workers, matching
GUI/MCP geometry, selection state handling, reset/cancel and undo, and no console
errors. Formatting, whitespace and branding checks passed. Owned native and
browser/bridge processes exited. Build: `scanforge-548de226b53fc74a`.

## Shared picked-point preview and acceptance through MCP

The dialog's asynchronous solve and synchronous commit are now shared with
`landmark_preview` and `landmark_accept`. Preview is a cancellable API job and
publishes no model geometry or history. It checks the job revision and current
session/geometry before publishing a preview. Acceptance uses the current session
reference, revalidates source and target geometry/normal references and locks,
then commits one history step and closes the session. Identical request retries
do not repeat acceptance.

`landmark_get` exposes coarse registration, refinement, worker diagnostics and
preview markers. Its selected-triangle count comes from cached region diagnostics,
not a scan of the full mask. GUI and API use the same preview and commit functions
through the stable workspace proxy. Discarding landmarks cancels an owning
`landmark_preview` job only. GUI-triggered AbortErrors from that same command also
produce cancelled job status; unrelated command failure semantics are unchanged.
GUI cancellation remains free of failure notifications.

This exposes the verified indexed pipeline's complete session lifecycle to
agents; it does not certify native all-scene target collection, CAD/point-cloud
refinement or enable the broader ribbon command. Numeric owner-scan captures and
their declared scopes remain the evidence for geometry fidelity.

Validation: production build/TypeScript passed without warnings or errors; 115
focused tests passed. The full suite passed 26,958 tests across 346 files with
29 skips across six files. All five external owner-scan cases were explicitly
rerun and passed with unchanged numeric output. Browser/MCP regression passed:
GUI and MCP preview registration/refinement match, preview preserves geometry and
history, acceptance adds exactly one undo step, identical acceptance retries do
not commit twice, and undo restores original indexed geometry and normals. Two
physical workers were observed and no console errors occurred. A regression first
reproduced GUI cancellation being reported as failed; the final patch reports it
as cancelled. Formatting, whitespace and branding checks passed. Test helpers
exited; the live 5173 server and reused user-facing preview tab remain available.
Build manifest: `scanforge-d27bc90561ce495a`.

## Original scene wrapper and named evaluator contract

`docs/evidence/landmark-scene-contract-native.json` retains six new direct
executions of original query `0x14088ae10`. Both the scene-scan identifier
`0x14115ca98` and eligible-feature identifier `0x14114bba0` return the same
wrapper root, subtracting `0x2e0` from the supplied adjusted interface pointer.
Three independent input offsets reproduce that adjustment for each identifier.
These calls execute the original machine code; they do not construct a scene or
exercise delegated query failures.

The alternate target lookup in original caller `0x14054d440` uses virtual slot
`0x298` with UTF-16LE **`PointEvaluator`** at `0x141165580`. This address contains
a property name, not another two-qword interface identifier. The caller waits
for the returned object's readiness field at `+0x90` and passes its `+0x60`
member to the refinement constructor. This establishes the property contract;
it does not establish GPU execution or the contents of that member.

The other target path copies original vertices and stored normals in order into
one combined mesh, offsets facet vertex IDs by the preceding vertex counts,
and copies stored facet normals. Its final virtual call at slot `0x58` resolves
through mapped vtable `0x140ebfcf0` to `0x1401de640`. That finalizer invokes
`0x140b375e0(mesh, 1)`: facet-normal refresh and angle-weighted vertex-normal
regeneration precede refinement. Independent target query trees therefore do
not, by themselves, prove parity with this caller's combined-mesh path.

The captured mode byte at `0x14764d891` is zero. That observation is specific to
the retained mapped image; the application's default and settings path remain
unestablished. The scene traversal, combined finalizer and named evaluator still
need an assembled execution before their complete behavior is ported. The
existing indexed numerical pipeline and its verified GUI/MCP lifecycle remain
available without claiming this broader scene-collection parity.

Validation for this evidence-only slice: all six native matching-query cases
passed; the image digest, UTF-16 property bytes, finalizer pointer and allocation
cleanup receipts were checked directly. The native replay and offline-analysis
processes exited. No application source or MCP contract changed, so application
build and test targets are not applicable to this slice. The live development
server remains on port 5173.

## Combined indexed target preparation in the shared worker

`docs/evidence/landmark-joined-copy-native.json` retains 18 direct executions of
the original caller's copy loop at `0x14054d90d` through `0x14054daca`. The probe
supplies controlled mesh collections and enters/exits that loop through a bounded
ABI wrapper. Original triangle insertion `0x1401de690` executes unchanged.
The finalizer callback captures the copied records, then executes original facet
refresh `0x140b35d90` and complete vertex-normal arithmetic `0x140b375e0(mesh, 0)`.
This isolates numerical preparation from scene traversal and the full finalizer;
it does not execute the constructor, native scheduler, finalizer adjacency
rebuild, named evaluator, optimizer or UI.

The corpus includes one through four input meshes, overlapping coordinates,
collinear facets and varied supplied normals. All 277 copied vertices retain
source order and sequential destination IDs. Facet indices receive the preceding
vertex-count offset, without welding across objects. Copied supplied vertex and
facet normals are retained in the pre-finalizer capture; subsequent vertex normals
are regenerated from geometry.

`prepareNativeLandmarkTarget` now reproduces that ordered join and normal refresh.
The shared `refineNativeLandmarkAfterCoarse` worker uses one prepared fixed mesh
instead of separate target trees. GUI picked-point preview, `landmark_preview`
and paired `mesh_process` with `refineSurface: true` all reach this same helper.
Existing fine alignment retains its separately verified target-group behavior.
This change does not enable the broader ribbon command or establish complete
all-scene target eligibility, CAD conversion or point-cloud refinement.

All 18 captured joined outputs match vertex coordinates, facet indices and every
Float32 regenerated vertex-normal byte. Input target buffers remain unchanged;
coincident vertices remain separate. The five full-resolution owner-scan cases
also pass after the integration, retaining the previously captured complete
position/normal hashes and numerical controller results.

Validation: production build and TypeScript passed without warnings or errors;
65 focused tests passed, including the five external owner-scan cases. The full
suite passed 26,978 tests across 347 files, with 29 skips across six files.
Browser/MCP regression passed with GUI/agent preview agreement, two physical
workers, acceptance/retry protection, cancellation and undo restoration, and no
console errors. Formatting, whitespace and branding checks passed. Native and
isolated browser/bridge helpers exited; the live 5173 workspace remains available
without reloading or replacing the user's imported scan. Final build manifest:
`scanforge-ec99f3717144570f`.

## Original scan scene traversal

`docs/evidence/landmark-scene-scan-native.json` retains 80 direct executions of
caller instructions `0x14054d74f` through `0x14054d8b3`, covering 40 scene layouts
in both values of the captured mode flag. The bounded ABI wrapper supplies the
scene, iterator, existing CAD-target list, moving-object pointer and controlled
visibility callbacks. Supported wrappers execute original query `0x14088ae10`;
the unsupported-query case supplies a null query result. Vector growth uses a
controlled storage adapter. The original traversal, exclusions, virtual-call
ordering and append branches execute unchanged.

The verified scan traversal:

- Skips null iterator entries and null scan-query results.
- Compares the returned wrapper pointer with the moving-object pointer before
  calling visibility; the moving scan never receives a visibility query.
- Skips invisible wrappers after querying visibility.
- In mode zero, appends geometry at wrapper `+0x160` after existing CAD targets.
- In nonzero mode, appends the wrapper to the separate evaluator-object list.
- Preserves scene order and duplicate entries in either list.
- Does not test the geometry pointer for null before appending it in mode zero.
- Calls iterator destruction exactly once, including for an empty scene.

The corpus checks ordered output lists and visibility-call order for every case.
It includes the moving object, invisible and unsupported entries, null entries,
null geometry, repeated objects, empty scenes and seeded mixed layouts. The
null-geometry result is a native observation, not a recommendation to bypass
application input validation.

`docs/evidence/landmark-scene-scan-type.json` independently associates the scan
identifier's query routine with actual MSVC `cMeshObject` complete-object
locators. The adjusted vtable records occur at offset `0x2e0`; their adjustment
thunk jumps to `0x14088ae10`. A nearby destructor thunk was excluded after checking
its actual branch target rather than treating the scanner's proximity match as
a query binding.
This is static class evidence paired with the earlier direct query executions;
it does not establish that point-cloud objects implement this interface.

All 80 native assertions passed, and both executable allocations were released.
The probe process exited. This evidence isolates the scan half of scene
collection; it does not execute the preceding CAD collector, named evaluator,
combined finalizer, optimizer or installed UI. No application source or MCP
contract changes in this slice. Application build and test targets are therefore
not applicable; JSON parsing, image identity, native ordered outputs, cleanup,
formatting and whitespace are the validation boundaries.

## CAD expansion assembled with scan traversal

`docs/evidence/landmark-cad-scan-native.json` extends the native execution range
back to `0x14054d56d`. Twenty-eight cases execute original CAD expansion and then
the original scan traversal in one call. The supplied CAD-root list represents
the output of the separately verified eligibility collector; this capture does
not replace or re-execute that collector. Scene iteration also includes the CAD
roots, whose controlled queries reject the scan interface.

For each visible CAD root, the caller independently queries two interfaces:

- `0x141155aa8`: virtual slot `0x28` supplies a geometry-pointer vector. Every
  entry is appended in vector order, including duplicates and null entries.
- `0x14114bbf0`: virtual slot `0x208` gates a per-entry vector at `+0x2d8` through
  `+0x2e0`. For each entry, the caller reads its cached geometry at `+0x600`.
  A nonzero cache is reused. A zero cache calls `0x140499b90`, then the caller
  reads `+0x600` again and appends that result without a null test.

Both interfaces can contribute geometry for the same root. The geometry-pointer
vector contributes first, followed by per-entry cached geometry. CAD order and
duplicates are preserved, and the subsequent mode-zero scan geometry is appended
after those CAD contributions. The alternate scan mode changes only the scan
list; CAD contributions still enter the combined geometry list.

The lazy-builder adapter records calls and writes declared cache results; the
tessellation engine itself is not executed. Repeating a successfully built entry
does not rebuild it. A builder that leaves the cache zero is called again for a
repeated entry, and null results remain in the collected list. Hidden roots skip
both providers, and a false per-entry gate skips its cache reads/builds. These
observations establish reuse and retry conditions, but not invalidation after
editing a CAD face or an application-level failure policy.

All 28 executions assert geometry order, alternate-object order, visibility-call
order, lazy-build call order and single iterator destruction. The corpus covers
empty/null/unsupported roots, each provider separately, both providers together,
hidden roots, disabled per-entry providers, populated caches, duplicate entries,
failed cache builds and repeated CAD roots. Original instructions execute with
controlled query/provider containers, visibility callbacks, vector growth and
lazy-build storage. The named evaluator, combined finalizer, optimizer, CAD
tessellation engine and installed UI remain outside this capture.

Both executable allocations were released and the replay process exited. Image
identity, all native assertions, retained JSON, formatting and whitespace passed.
No application source or MCP contract changed, so application build/test targets
are not applicable to this evidence-only slice. Port 5173 continues serving the
existing application workspace.
