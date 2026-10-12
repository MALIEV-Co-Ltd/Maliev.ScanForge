# Native polygon reduction evidence

The production percentage target now truncates instead of rounding up. For
95 facets at 50%, the target is 47. The admitted triangle-count and percentage
paths now use the recovered complete collapse kernel and Float32 output adapter.
Global large-mesh and deviation-mode parity remain incomplete; see the
production adapter section below.

## Recovered route

All procedure addresses below refer to the captured mapped image with SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
Raw image data, decompilation and probes remain outside this repository.

- Ribbon builder `0x1402f09d0` associates the Reduce polygons label with command
  `0x8191`. Evidence `ev_bc478131967bf871cdbb6613fa3a4ab92ec9661af83a3f1d3c694222c3a7f855`.
  The mapped WM_COMMAND entries resolve its action to `0x1407ea1b0` and enabled
  state to `0x1407ea290`. These handlers dispatch through owner virtual methods;
  the complete owner/factory connection is not yet dynamically verified.
- Dialog constructor `0x140596ab0` creates resource `0x20e`, initializes the
  decimation dialog's type pointer, and stores Float32 `0.05` in its deviation
  field. Evidence `ev_ee86f3956c9b3f07d07f0acfc2f4d4b94e868d8adcf58de037215d2fa8a4a131`.
  Initialization `0x140597830` also reads saved settings and applies a separate
  context-dependent value and unit conversion; constructor defaults alone do
  not prove every configured UI default.
- Preview preparation `0x140597d10` creates a result mesh and has two branches
  controlled by a captured global flag. One calls wrapper `0x14038d2a0` with
  source mesh, output mesh, target count and progress owner. The other creates
  a polygon-reduction object inline. Evidence
  `ev_813e0f72a52c536994f34d3b230e5e595ad8c29d0fc944362c4ffafa7b1d0fb6`.
  The second branch's static body is now resolved below; its nonzero-state
  runtime execution has not been captured.
- Wrapper `0x14038d2a0` reaches `0x140396050`. The latter prepares source
  connectivity and uses 120-byte vertex and 72-byte facet records. It calls
  preparation `0x140394c30`, then collapse `0x140395aa0`, then reconstructs the
  output mesh with Float32 coordinates. Evidence
  `ev_dda122a0237f0806d431e126209b4b71929be02a9c0fe4c6604b672e00f68353`.
- Collapse `0x140395aa0` stops when the retained count reaches its target or
  after 1,000 passes. It compacts records every 20 passes and increases its
  candidate threshold using a power expression scaled by `1e-9`. It calls
  candidate calculation `0x140393e90`, validity checking `0x1403945b0`, adjacency
  updates `0x140395640`, and final compaction `0x1403957c0`. These helper bodies
  are retained and validated by the complete-loop and adapter captures below.
  Evidence `ev_224de1bb6364c28248d2e331a3afd3cdc1e05b8e03b79cad625645b3707e0abb`.
- Deviation comparison `0x140598310` caches a preview search object, distributes
  original vertices among CPU partitions, joins them, and computes the reported
  percentage within threshold. Evidence
  `ev_af05ba8628211c99046cbb8297c87bf9e71aebc73387b642204c996b4ba3890a`.
  This is static evidence of that path, not a multicore timing measurement.

## Percentage execution and integration

Original x64 routine `0x140598290` was executed on 143 guarded caller-owned
dialog objects. Only its MFC data-binding import was replaced with a no-op;
the arithmetic, constants, conversion and field writes are original. It clamps
the integer percentage to 1–100 and truncates `count * percentage / 100`.
All cases modify only the target and clamped-percentage fields. Counts cover
zero, small odd/even meshes, large meshes and the full UInt32 range.

Evidence `ev_4a0a42abfb8c5f2a125e4b432219f72170c8f8e51e223e8f4cc56eedb6f51192`
and `tests/fixtures/reduction-percentage.json` retain the numerical contract.
`src/scan-reduction-target.ts` supplies the target for the existing production
reducer, including its spatial-patch path. Invalid API percentages still fail
explicitly; fractional percentages remain an existing API extension. The
application retains a minimum target of one facet instead of permitting an empty
mesh. Tests distinguish these policies from the native integer arithmetic.

Complete native reduction requires identical input mesh/output comparisons,
candidate and tie ordering, boundaries, nonmanifold behavior, cancellation,
deviation mode and the alternate branch. The sequential collapse loop must be
verified before introducing multicore changes that could reorder candidates.

## Collapse candidate numerical verification

Original routine `0x140393e90` was executed on 424 guarded pairs of caller-owned
120-byte vertex records. It has no calls or imports; no instructions or numerical
dependencies were replaced. The source image digest is the mapped-image digest
above. Evidence is
`ev_2f28b3f32aadc97d910b521b9dcd0299a4f94bf3eb3c453d599d9e8c4bea060b`.
Input records and context remained unchanged; all output guards remained intact.

The candidate combines the endpoints' symmetric quadrics. It solves the
three-coordinate system when the determinant magnitude exceeds `2^-23` and the
two endpoints are not both boundary vertices. Otherwise it evaluates the first
endpoint, second endpoint and midpoint. Independent equality writes mean the
midpoint wins when all three costs tie. A single boundary endpoint does not
force that fallback. These rules differ from freezing all boundary edges.

`src/scan-reduction-candidate.ts` reproduces every captured cost and coordinate
bit, including signed zero. Cases cover all four boundary combinations, zero
and singular quadrics, determinant values at/below/above the threshold, and
seeded sums of plane quadrics with coordinate scales from `0.001` to `1,000,000`.
Arithmetic grouping follows the original scalar instructions: equivalent
algebraic reassociation produced different doubles in the first port. The
fixture stores raw output bytes because JSON module loaders may normalize
negative zero.

This module is a verified component for the native reduction port. It is not
yet used by the independently implemented production reducer. Installing it
alone would leave the native preparation, validity, update and collapse-order
rules unimplemented. The remaining integration gate is a complete native
collapse path compared on identical meshes, rather than substituting one
verified component into a different algorithm and claiming equivalence.

## Face-validity and deletion-mask verification

The port in `src/scan-reduction-validity.ts` matches 275 executions of original
routine `0x1403945b0`, including its Boolean result and all three output mask
words. Evidence is
`ev_97115feb5c2b3e657e8787f134f0ad27256def4c20725f5b991193683f96c034`.
Its double-vector normalization dependency `0x140154070` was separately
extracted with REA; evidence is
`ev_56a9b9eb30ef0b25b0d67ffee8893d1311ad93c99ffac5fdd9596e511ce70921`.
The isolated execution resolves only the original square-root import to the
helper process's CRT. No geometric code is replaced. The return contract is a
Boolean in `AL`; upper register bits are unspecified. The committed captures
use that contract, correcting the first probe's oversized return type.

The routine walks ordered incident-face references. Deleted faces leave their
mask bits untouched. A face containing the other collapse endpoint sets its
deletion bit. Otherwise the routine normalizes both replacement edge vectors
using double arithmetic and a `Number.EPSILON` length cutoff. An absolute edge
dot product greater than `0.999` rejects immediately. It then normalizes their
cross product, clears the face's deletion bit, and rejects if the dot product
with the stored face normal is below `0.2`. Early returns preserve unvisited
mask bits; clearing the entire mask before the check would differ.

The captures cover threshold neighborhoods, tiny and large coordinates,
collinear edges, empty incidence, deleted faces, endpoint removal, corner
rotations, and incidence counts of 31, 32, 33 and 65. All input records and
guard bytes remain unchanged. Candidate and validity components are now
numerically verified; preparation, adjacency updates, ordered collapse and
final compaction still require integration and full native mesh comparisons.

## Ordered adjacency-update verification

`src/scan-reduction-update.ts` now composes the verified candidate calculator
with the ordered update rules from `0x140395640`. Evidence is
`ev_87f0b62f3506bfccd0044d7c2014fbe898fcdfe3b4878c074916fc617bb0d253`.
The original update and candidate routines were executed without shims on 112
caller-owned record sets. Reference capacity was reserved in advance; the
native allocation/growth branch was not exercised. Source vertex records,
deletion masks, existing references and guards remained unchanged.

Already deleted faces are skipped. A set incidence-mask bit marks a live face
deleted and increments the deletion counter. Other live faces replace the
referenced corner with the retained vertex, become dirty, recalculate all
three edge errors and append the original face/corner reference. Their stored
normals remain unchanged. The lowest-error edge is selected with ordered
`<=` comparisons; edge two wins a three-way tie. The source incidence range
is fixed even when new references are appended to the same vector.

Every output error matches the native double bytes. Face indices, dirty and
deleted flags, stored normals, best-edge indices, deletion totals and ordered
successor references also match. Cases cover empty ranges, all four boundary
combinations, zero-cost ties, nonzero plane quadrics, predeleted faces, mixed
mask patterns and 31/32/33/65-reference ranges. A separate regression checks
source/successor vector aliasing. These are record-level comparisons, not
whole-mesh native reduction. Preparation, pass ordering and compaction remain
necessary before the native path replaces production reduction.

## Final compaction and composed execution

`src/scan-reduction-final.ts` reproduces the final indexed coordinates and
triangles from `0x1403957c0`. Its facet-vector resize dependency `0x140396c30`
was separately extracted with REA, evidence
`ev_f9ee6e1a4795124d290d63f02e7123c13863cf2ac83d452b786bcffd5234010a`.
Final-compaction evidence is
`ev_9d9fcf8a49c308c6fc4c44f6a48db6f4e019a0f88d0ae60510158beb4c91d070`.

Original compaction and shrink instructions ran on 140 guarded caller-owned
meshes without shims. Surviving faces retain their original order. Referenced
vertices are packed in ascending original vertex-index order, then every face
index is remapped. Cases include unused vertices, empty inputs/results, kept,
alternately deleted and entirely deleted face sets, signed-zero coordinates,
and up to 81 vertices and 97 faces. Every exported coordinate bit and triangle
index matches. Context writes change only the two vector end pointers; input
and output storage guards remain intact. Capacity is already sufficient, so
allocation/growth paths are not exercised. The port returns fresh indexed
buffers; it does not emulate the native working-record metadata mutations.

The 112 adjacency-update captures were also re-executed with original final
compaction immediately afterward on the same working records. Tests compose
the candidate-backed update port with final compaction and match those original
sequences' coordinate bytes and triangle indices. This verifies a connection
between recovered components rather than only isolated routines. It still
does not execute preparation or the complete pass/collapse loop. The production
reducer remains unchanged pending complete same-mesh comparisons.

## Complete preparation verification

`src/scan-reduction-preparation.ts` matches 112 executions of the complete
original preparation routine `0x140394c30`, evidence
`ev_458fb8d7e6c2075191c5e6d3eef83c8a8db50467e20ce308f3dae73533bb2a2c`.
The original normal, candidate, incidence and boundary instructions all run.
Only runtime import bindings are supplied by the isolated process: allocation,
free, memory move/set and square root. The original allocation wrapper and
vector growth/destruction code remain intact. Every one of the 746 temporary
allocations was freed before the probe finished. Native storage guards remain
intact. This covers successful allocations, not allocator failure behavior.

The routine first computes double face normals, normalizes with the epsilon
length cutoff, then adds each face's plane quadric to all three corner vertices
in original face/corner order. It calculates face errors and the minimum error
while boundary flags are still clear. It then constructs grouped incident
references in original face/corner order and marks boundary vertices from
single occurrences of neighbor indices across incident faces. These later
flags do not trigger recalculation of initial errors. Substituting an ordinary
edge-count rule can differ on degenerate incidence.

The port matches every normal, quadric, edge error and minimum-error double bit,
plus best-edge indices, reference offsets/counts/order and boundary flags.
Cases cover empty meshes, repeated corner indices, unused vertices, varied
incidence and coordinate scales from `1e-18` to `1e6`. They initialize quadrics,
incidence counts and boundary flags as the recovered caller does. Inputs are
caller-built numerical meshes, not new native UI captures.

Candidate calculation, validity, ordered updates, final compaction and complete
preparation are verified components. The complete-loop comparison below now
passes on identical indexed sources. Production reduction remains on its
previous implementation pending the source/output adapter and runtime gates.

## Complete collapse-loop kernel comparisons

`src/scan-native-reduction.ts` assembles the recovered preparation, candidate,
validity, update and compaction components in the original sequential loop.
The original preparation and loop were executed on 18 identical indexed input
meshes: flat/noisy 7-by-7 vertex grids, a closed octahedron and the retained
annular source. Targets include unchanged counts, odd counts, half counts and
targets below what the protected mesh can reach. All exported double coordinate
bits and indexed triangle ordering match. These are kernel executions, not
new native UI exports or proof of the alternate dialog branch.

Loop evidence is
`ev_224de1bb6364c28248d2e331a3afd3cdc1e05b8e03b79cad625645b3707e0abb`.
Periodic compaction/reference rebuilding `0x140394890` was separately extracted,
evidence `ev_e15307d82a711e67b6c779ad36fc0e2fb225db38e01848e98abf3dd627e9b4d0`.
Bit-mask resize and reference growth were also extracted. The original loop
ran with isolated CRT bindings and a no-op progress sink; no geometric call
was replaced. All 276 temporary allocations were freed, and storage guards
stayed intact.

The loop caps at 1,000 passes, rebuilds surviving face incidence every 20 passes,
and uses `pow(pass + 3, 4) * 1e-9`. Candidate edge ordering follows its explicit
branches rather than a generic sort. Face admission uses `<=`, while an edge
attempt uses strict `<`. Both endpoints must have clear boundary flags: the
candidate routine's boundary fallback is not permission to collapse boundary
edges in this loop. Both endpoint validity checks run before publication; then
the retained point/quadric and ordered incident references are updated. Removing
two faces can overshoot odd targets. The annular source stops at 38 faces for
smaller targets; the grids stop at 24.

The kernel port now checks cancellation during input validation, preparation,
collapse scans, periodic incidence rebuilding and final compaction. Progress
is monotonic across preparation, collapse and final publication. Cancellation
at each stage throws without modifying the caller's coordinates or indices;
no partial result is published. Shape, finite-coordinate, index and target
contracts are checked before preparation. The retained coordinate buffer is
updated only after both endpoint validity checks pass; it avoids copying all
vertices for every candidate. All 18 native coordinate-bit and index-order
comparisons remain the numerical gate for these controls.

A bounded Node benchmark reduced connected sinusoidal grids to half their
input face count. Three warm runs measured medians of 20.9 ms for 2,048 faces,
80.6 ms for 8,192 faces and 184.3 ms for 20,000 faces. Every cold/warm run
produced identical output bytes and left its indexed input unchanged. These
larger synthetic inputs have not been compared with native output. The process
high-water RSS was 240.1 MiB, including Node and bundling overhead; this is not
the incremental mesh allocation. Timings exclude import, welding, worker
transfer, diagnostics and rendering. The object-based working records still
need a memory gate and larger imported-scan measurements before production
admission. The benchmark used a 256 MiB heap limit and a 120-second supervisor
timeout; the bundler service was stopped and the owned process exited.

## Production source/output adapter

The count and percentage paths now call the recovered kernel through
`src/scan-reduction-adapter.ts`. Source points are widened from Float32 as in
caller `0x140396050`, and compacted points are narrowed to Float32 before facet
expansion. Facet/corner order is preserved. The original preparation/collapse
loop was executed again on 18 inputs indexed in the same first-encounter order
as the application's importer. The production triangle-count path matches every
expanded output Float32 byte; the matching half-count cases also pass through
the percentage path. These captures establish identical indexed-input
comparisons, not native UI import/weld-order parity for arbitrary scans.

The recovered caller only invokes the kernel for targets greater than three.
Targets below four retain the source and report this limitation. Unchanged
targets also retain source coordinates. Source validation and cancellation run
before either shortcut. Progress includes topology preparation, collapse and
facet export; cancelled exports do not publish a result.

The object-based whole-mesh kernel has a conservative 256 MiB record budget,
estimated from vertices, facets and growing incidence scratch. Inputs beyond
that admission continue through the existing spatial-patch path; each admitted
patch uses the recovered kernel. Both half-million-facet regression tests still
require actual reduction and valid stored triangles. This preserves large-mesh
support while memory-efficient global reduction is unfinished. Independent
patch collapse is not claimed to reproduce the native global sequence. Deviation
mode retains its previous conservative implementation. It has not been shown
to reproduce the native count-preview/comparison route extracted below.

The refreshed Codex browser completed 33-percent retained reduction on the
loaded 96-facet annular object, producing 38 facets and reporting the recovered
collapse constraints. Raw probe data, allocation cleanup and browser evidence
remain outside the repository. All 276 native probe allocations were freed.
Whole-kernel and adapter parity on these fixtures does not establish complete
Scan Data or application equivalence. Imported-scan ordering/performance,
global large-mesh parity, complete native deviation-dialog parity and nonzero Preview switch runtime behavior remain open.

## Deviation callback extraction and execution

The traced Preview branch passes the target at dialog offset `0x280` to the
reduction wrapper. Its comparison is a subsequent operation: `0x140598310`
queries original vertices against a search structure built from the reduced
preview. It reports the within-tolerance count divided by all original
vertices, including unmatched samples in the denominator. This route does not
pass the deviation threshold into the collapse kernel or change its target.
It therefore does not establish a displacement-constrained collapse mode.
The Preview switch initialization, nonzero-state runtime behavior and complete
dialog event map remain separate verification requirements.

REA extraction of `0x1405980c0` shows it only enables three comparison controls
according to the dialog's comparison checkbox; it does not alter the target.
Evidence: `ev_ce599b93d72a866bdaa124c57ad1b2926a9e0ed07cf463c294903f43351191e4`.
`0x1405975b0` formats comparison results for a separate context and chooses
status colors at percentages 99.5 and 99.99. Evidence:
`ev_a34a1611747b42e0c4e4e58d8e5e5ba2345268dcf04430b590951fdbc961059c`.

The original callback `0x1405989b0` was executed on 25 cases / 200 point samples,
together with the original query, triangle-distance leaf, palette reset and
color ramp. Only the CRT square-root import is bound; no numerical routine is
replaced. Caller-built nodes cover empty results, positive/negative winding,
both orders of equal-distance opposing facets, exact threshold/radius samples
and independently varied report/palette thresholds. Point storage guards stay
intact and the mapped image was released after the owned helper finished.
Evidence: `ev_305362a4e99db81685e41fb3577eb471da25394687ab10bbca79ff82949c6a25`.
These executions verify the callback on supplied nodes, not native UI settings
or construction of its search structure.

`src/scan-reduction-comparison.ts` reproduces every captured count and RGB byte.
It uses a search radius of five times the widened Float32 palette threshold,
while the within-tolerance count compares against the separate Float32 dialog
threshold. Missing queries yield RGB `(50, 50, 50)` and do not increment the
count. Signed ties retain the query's winner; the ramp receives the narrowed
Float32 distance. Source points are unchanged, cancellation discards incomplete
results, and progress is checked before publication. The callback port is now
integrated into the count/percentage tool, with the limits below. The existing conservative deviation mode is not claimed to
reproduce this traced comparison behavior.

The reduction caller's assembly now independently confirms the construction defaults: at `0x14059850c` it clears `R9D` (include all triangles), and at `0x14059850f` it loads `XMM2` from `0x14126ae68` before calling builder `0x140a7f470`. Reading that mapped-image constant yields bytes `00 00 00 3F`, Float32 0.5. The builder sets depth ten and uses the same verified root initialization, insertion and subdivision routines as Reduce Noise. Assembly Evidence is `ev_5547acd4920afe6fe090d7bda3ed709e8fea23578b064b2e1df0560ebdd48a5a`. This is static caller evidence, not a fresh native dialog capture.

`compareReductionSurface` composes that constructor, ordered signed query, triangle leaf and reduction callback. Original sample coordinates and reduced connectivity are separate inputs. It preserves the independently rounded report/palette thresholds, strict query exclusion, denominator and per-original-vertex RGB bytes. Tests reproduce all 326 retained successful signed matches on six native-built preview surfaces, and independently check differing vertex counts, grey unmatched samples and cancellation. Those constructor fixtures query at exact radius 0.25; successful winners remain unchanged at the slightly larger caller radius `5 * Float32(0.05)`. Their missing results are deliberately excluded from that comparison because increasing the radius can admit threshold-edge samples. The original callback's separate 200-sample fixture remains the gate for its radius and missing-result semantics. No native end-to-end reduction dialog or source-import vertex ordering is established by this composition check.

## Production comparison integration

Count and percentage reduction can now measure deviation after computing the recovered collapse result. The request carries `measureDeviation`, the independent report tolerance in `deviation`, and `paletteThreshold`. Coordinates publish only after comparison completes successfully. The existing worker response transfers reduced coordinates and original-facet RGB bytes separately. The viewport renders the colors on a read-only copy of the original surface and toggles to the reduced geometry; closing or changing tools clears that overlay. Geometry history retains the reduced result.

The comparison constructor reads the published reduced triangles in order without another welding or topology pass. Original samples reuse the reduction's cached source index. Native Float32 thresholds remain unchanged in computation; labels use six significant digits to avoid binary precision tails. Comparison is unavailable in the separate conservative displacement-constrained mode.

All 18 retained native adapter captures remain byte-identical through the measured production dispatch. Tests also check source immutability, monotonic progress, cancellation, original-facet color length, worker transfer buffers and absence of repeated topology preparation after actual reductions. The current browser reduced the retained 96-facet annular source at 50 percent with report tolerance 0.1 mm and color threshold 0.05 mm; its exported 432 coordinates exactly matched the native 48-facet capture. The original overlay, reduced-result toggle and close cleanup were checked in the browser. These integration checks do not establish complete native dialog/color output parity; the callback, constructor and query retain their separate captured numerical gates. Global large-mesh reduction, native import ordering, Preview switch initialization and nonzero-state runtime behavior remain unverified.

## Alternate Preview branch resolved statically

Fresh focused REA assembly of `0x140597d10` covers the entry through its final return at `0x1405980b1`. Evidence is `ev_1f5402c201902e2795f2cb51307d28b7a6469d128a0f66dc01c21616df18709d`. The instruction at `0x140597dee` compares byte `0x14764d899` with zero; the following zero branch jumps to `0x140597ed8`. That block reads the dialog target at `0x280`, passes the source mesh and result mesh, and calls the recovered wrapper `0x14038d2a0` at `0x140597ef2`. An ordinary read of the retained mapped image, independently checked against its SHA-256, finds the switch byte is zero. This is captured-state evidence, not a guarantee about every native session.

The nonzero block from `0x140597dfb` through `0x140597ed6` initializes stack fields and then calls only `0x140163950`, `0x140163210` and `0x140d5b0f0`. It neither loads the source mesh nor the target count within that block. The first helper allocates a 48-byte self-linked sentinel with header `0x101`; the second clears that container; the last frees the sentinel. Their decompilation Evidence IDs are `ev_37c37d1fa7a3d6917e1242bbb50c32a5d6d57ec16d82ecd19d764f5e3c4cf700` and `ev_e1edd5693cf79ed172a791ff07babc6ca5c752b9bb2c2ffcb88353e76fccdf3a`.

Reading vtable `0x140ec3210` supplies the callback addresses. Fresh REA extraction shows `0x140166540` and `0x140166550` return without work, `0x140166530` returns true, and `0x140166570` returns false. The deleting destructor `0x140166580` restores the base vtable and conditionally frees its object. Evidence for the empty computation callback is `ev_83ad00519cc24cfba0ef125fe608bf7d2eaf9eac9c3557dccb96713b90ad0746`. No second reduction invocation is present in the nonzero block's complete assembly. The earlier suggestion of an inline alternate reduction algorithm was an inference from its object setup and is superseded by these bodies and instructions.

The external verifier checks the image digest, switch byte, branch destinations, exact three-call list, source/target loads in the zero block and complete assembly endpoints. It retains all eight REA Evidence IDs and distinguishes byte inspection from REA extraction. The focused profile uses caller-declared function entry seeds and PE exception-table extents; it does not claim whole-image auto-analysis. No new numerical algorithm or production change follows from this trace. Switch initialization and actual nonzero-state runtime behavior still require separate evidence.
