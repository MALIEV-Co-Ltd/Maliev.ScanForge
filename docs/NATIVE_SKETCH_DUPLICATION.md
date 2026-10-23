# Sketch duplication: recovered behavior and remaining work

Duplication is not implemented in the application or MCP discovery. This evidence
defines work remaining under construction/sketch milestone M4; it does not close
that milestone or establish numerical equivalence.

## Artifact and controller binding

The installed reference executable is version 8.0.123.0, SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
Read-only runtime capture produced a private static-analysis image, SHA-256
`a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`.
That derived image is never executed or distributed with this repository.
Old captured external addresses do not bind calls in the current native window.

REA resource inspection (`ev_98a75917e41ca7becbcfc109647958e9285aa8960648d04b8a2744d91525ac33`)
identifies dialog 496, **Duplicate selected**, with 49 controls. Its 2300-byte
template has SHA-256
`971267d18bb39dbf31bf9cf6f690c9f5e40ca6a50a479c3f85416decef07bf20`.
The decoder consumed exactly the resource length. Constructor `0x14065ff70`
passes dialog ID `0x1f0` to its base and installs the dialog's virtual table;
factory registration names `cSubCopyCurvesDialog`. The message map connects
Accept to `0x140663cf0`, Cancel to `0x1406611b0`, and edits to the preview
generator `0x1406611d0`. Thus the recovered calculations are bound to this dialog,
rather than inferred from an unrelated CAD body-pattern command.

## Required modes

| Mode        | Observed controls and behavior                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear      | X Axis, Y Axis or picked Sketch line; instances, spacing and Flip. Instances include the original.                                                                                             |
| Grid        | Direction 2 adds its own axis/line, instances, spacing and Flip. The generator visits the rectangular instance product, excluding only the original at `(0,0)`.                                |
| Circular    | Explicit centre coordinates or a picked point, instances, Angle to fill, Flip and Retain original orientation.                                                                                 |
| Along curve | Pick a path, instances, spacing or Equal spacing, Flip and Retain original orientation. This mode is present in the shipped dialog but absent from the retained manual's duplication tutorial. |

The manual's printed pages 84–88 establish the first three workflows and that
copies can be edited independently. Resource controls and controller recovery
establish the additional along-curve branch. Neither source proves that every
option has been replayed successfully in the native UI.

## Recovered calculations

The generator clamps instance counts to at least two. Activation initializes
linear, secondary and circular counts to two, circular fill to 360 degrees and
centre coordinates to zero. Length defaults pass the numerical value 10 through
a helper that first calls a virtual floating-value helper, then formats its
result with precision settings
and parses the text back to double. The unit IDs, concrete conversion methods and default precision are now mapped
in [native length units](NATIVE_LENGTH_UNITS.md); decimal edge cases and live
acceptance across settings remain open. It must not be reduced to a hard-coded
unit scale.

For finite nonnegative circular fill angles below 360 degrees, the angle step
uses `fill / (instances - 1)`. At 360 degrees or above, it uses
`fill / instances`. Exactly 360 therefore omits a duplicate at the original
location. The unchecked Flip state negates the step; Flip reverses its sign.
The 360 and degrees-to-radians constants and the branch/division instructions
were checked against the digest-verified image, rather than accepted solely from
decompiler variable types.

With retained orientation, circular copies use a translation calculated from
the selected group's stored anchor rotating around the requested centre. Without
it, source geometry rotates about that centre. Activation derives the anchor
from single-precision extrema of selected native point records. The six bound
classes' special handling and ordinary arc defining-point order are now mapped
in the selected-group anchor follow-up below.
It is not established as the analytic bounding box of every supported curve.

Along-curve Equal spacing uses path length divided by `instances - 1`, except
when the native start/end points are less than 0.0001 units apart, where it uses
`instances`. Path evaluation accepts distances up to length plus
`1.1920928955078125e-7`; Flip reverses path traversal and tangent direction.
The retained-orientation branch preserves the initial path frame's rotation;
the other branch uses each evaluated path frame. The concrete evaluation and
distance-to-parameter methods are bound below, with component replay for line,
arc, Bezier and cubic B-spline fixtures. Complete controller path behavior remains
an acceptance gate.

Accept also remaps and copies selected relation records with numeric kinds
3, 4, 19 and 20 when both referenced source entities have corresponding copies.
Their native command names are now mapped:

| Numeric kind | Native command     | Command ID | Dispatch branch |
| ------------ | ------------------ | ---------- | --------------- |
| 3            | Make Perpendicular | `0x829e`   | `0x14070bf72`   |
| 4            | Make Parallel      | `0x829d`   | `0x14070bd48`   |
| 19           | Make Colinear      | `0x84c3`   | `0x14070e8de`   |
| 20           | Make Equal         | `0x84c4`   | `0x14070eb02`   |

These are derived static bindings. Retained REA menu evidence binds the first
three labels to command IDs. The Make Equal tooltip belongs to the embedded
button at byte offset `0x8fa0`; callback `0x1405c85f0` accesses its window at
`0x8fe0` and sends `0x84c4`. Two selector/target dispatch tables connect those
commands to branches that store the corresponding relation kind before calling
the known insertion routine `0x140a401c0`. Independent copies therefore retain
selected internal perpendicular, parallel, collinear and equal relations; they
must not drop every relation.

Ghidra did not recover a function owner for this raw dispatch region. A separate
digest-bound decoder using Capstone 5.0.6 from the installed Ghidra distribution
checked the two table decodes and 25 critical instructions. This establishes the
command-to-record-kind mapping, not complete dispatcher analysis, executed paths,
solver equations or which quantity Make Equal constrains on every curve class.
Raw code stays in private evidence. The shared sketch model now represents a
collinear relation through GUI and MCP `sketch_set`; see
[the application contract](SKETCH_COLLINEAR.md). Its numerical solver formulation
has not been established as native-equivalent, and duplication remains open.

The first insertion opens the native history change once; subsequent insertions
share it. Project persistence and exact history behavior still need live replay.

## Direction and count handler follow-up

Both direction lists are ordered X Axis, Y Axis, Sketch line. The first two
choices replace the stored direction with `(1,0,0)` or `(0,1,0)` respectively.
Choosing Sketch line leaves that vector unchanged in the combobox handler; the
separate pick workflow must supply it. Enabling Direction 2 selects Y Axis and
resets its stored vector to `(0,1,0)`, even after a previous secondary direction.
The picked-line calculations are now bound below; curve eligibility, coordinate
frame and native degenerate-input fixtures still require validation.

The primary, secondary and circular instance edit handlers clamp values below
one to one. The linear/grid generator independently clamps both active counts
to at least two. A value of one is therefore not proven to mean an original-only
preview or acceptance. Preserve this distinction until native UI replay resolves
it; do not silently replace these two observed rules with one validation rule.

For linear/grid spacing, the native instructions load each full binary64 value
into XMM1, clamp it against zero, call the unit service at virtual slot `+0x20`,
and use the XMM0 result in the translation calculation. In particular, the
decompiler's `SUB84` expression does not establish truncation to 32 bits. The concrete converter methods and precision selector are now mapped in
[native length units](NATIVE_LENGTH_UNITS.md). Numerical replay across settings
and formatting edge cases remain open.
For finite spacing inputs, the pre-conversion operand is `max(spacing, 0)`;
this does not prove that the converter is linear, identity, or globally constant.

REA dossiers bind six handlers to the original message-map controls. A separate
Capstone check verifies 46 instruction anchors and rejects an intentionally
incorrect editor minimum. The secondary virtual-table thunk at `0x140664808`
adjusts the object pointer and enters the destructor, not a picked-line callback.
The actual picked-line branch is now bound separately below. These are static
observations, not executed native acceptance tests.
The provider was closed and its owned Java process exited after retention.

## Picked-line direction, spacing and grid state

The view initializer `0x1406f55f0` obtains the dialog from factory
`DAT_141620f30` and stores it at view offset `0x3140`. The retained factory
registration names `DialogFactorycSubCopyCurvesDialog`. View callback
`0x1406fa340`, switch case `0x0e`, accesses that same member and calls the bound
duplication preview generator. This connects the picked-line branch to the
Duplicate selected dialog.

Before reading endpoints, the branch checks a selected-item context byte, a
non-null selected curve and a true result from virtual query `+0x30`. The precise
curve-type mapping of that query is now bound for six classes in the follow-up
below; this is not an executed picking fixture. The selection resolver also
recurses through groups and clears temporary point-record bits; it must not be
invoked as a supposedly read-only geometry getter during analysis.

For an eligible picked curve, it reads virtual endpoint indices zero and one,
computes `endpoint1 - endpoint0` in three binary64 components, measures
`sqrt((dx*dx + dy*dy) + dz*dz)`, and normalizes the vector. For finite lengths,
normalization multiplies by the reciprocal when length is at least `2^-52`
(`2.220446049250313e-16`). Below that threshold, it leaves the original vector
unchanged and returns no local error. This is not evidence that the native GUI
can create or select a degenerate line; earlier authoring and eligibility guards
remain to be tested. The expanded sum of squares is not a stable-hypot formula.

The callback preserves the measured length before normalization and passes that
full double to the matching spacing setter. The setter clamps non-positive
values to zero, then uses the recovered [unit/precision helper](NATIVE_LENGTH_UNITS.md).
Picking therefore changes both direction and spacing. It selects combobox index
two, Sketch line, and writes the normalized direction to the primary or secondary
vector. In grid mode, a primary pick clears the primary flag and arms the
secondary flag. A secondary pick clears both. The callback then updates controls
and regenerates the preview. The picked coordinates' exact frame and live UI
transitions still need equivalent fixtures.

The parent callback's complete analyzed body is 23,015 bytes. Its high-P-code
value flow is truncated and its indirect-call relationship coverage is partial;
no complete semantic reconstruction is claimed. A complete retained Evidence
bundle was exported after inline delivery exceeded the MCP response budget.
Independent verification checks 59 instruction anchors, two negative controls,
and six spans containing 185 decoded instructions (827 bytes).

A read-only snapshot of the current native process matched all six code spans
twice. It also bound the indirect length call to the current `ucrtbase.sqrt`
export by matching the address, mapped DLL path and 32 entry bytes against the
host export. No target function executed and no scan geometry was read. The
helper made 22 region queries, peaked below 15 MiB under a 4 GiB/25% CPU Job,
and closed its process/Job handles. The analysis provider also closed with no
pending cleanup or remaining owned Java process. These checks bind current code;
they do not establish native numerical acceptance or GUI/MCP duplication parity.

## Along-curve distance and frame follow-up

The generator passes a full binary64 path distance in `XMM1` to wrapper
`0x14065fe60`. Its apparent integer cast in recovered pseudocode is not an
instruction-level conversion. The first copy starts at the spacing value;
subsequent copies use repeated binary64 addition, not `index * spacing`.
For example, six additions of `0.1` yield `0.6`, whereas `6 * 0.1` yields
`0.6000000000000001`. This illustrates a rounding distinction; it is not a
native numerical replay.

For ordered finite inputs, the wrapper admits distances from zero through
`length + 2^-23`, inclusively. Flip replaces the admitted distance with
`length - distance`; a lower clamp to zero precedes virtual `+0x168`. That
call receives binary64 tolerance `2^-23` in `XMM3` and writes the curve
parameter to a stack double. Virtual `+0xb8` then receives that parameter in
`XMM1` and the point/tangent output pointers. Its concrete curve-class
implementation is now bound to the inner sketch-edge wrapper below. Numerical
fixtures and complete eligibility remain open. The ordered-comparison description must
not be treated as NaN validation: the actual bounds use `COMISD` and `JA`,
whose unordered behavior differs from a high-level finite check.

Both initial and subsequent frame construction call the already recovered
`0x140365fe0` with constant normal `(0,0,1)` and the evaluated tangent hint.
The constant was read from the installed process because its address is
virtual-only in this analysis image; no file-offset bytes were invented.
The frame builder and rigid inverse are described in
[NATIVE_MIRROR_COORDINATES.md](NATIVE_MIRROR_COORDINATES.md). This does not
resolve every selected curve's sketch/world coordinate mapping.

Flip's tangent helper `0x14016b160` uses guarded sign-bit negation. A NaN
first component returns unchanged. It also returns unchanged when the
absolute Float32 difference between the first component and `FLT_MAX` is
less than `2^-23`, preserving the native invalid-point sentinel. Otherwise
it XORs the sign bits of all three doubles. Ordinary finite tangent vectors
therefore reverse, including the signs of zero components; an unconditional
three-component negation would lose the sentinel behavior.

The structured follow-up pins 27 instruction anchors, eight RIP-relative
constant bindings and the existing generator/wrapper REA identities. A passive
current-process check matched six code spans totaling 578 bytes and read the
frame/tolerance/sign-mask constants twice with identical results. Two altered
constant controls and two malformed/nonfinite decoder controls were rejected.
The helper used 28 region queries and peaked at 14.43 MiB under its existing
4 GiB/25% CPU Job. Both handles closed; no target function was called and no
vertex/facet buffer was read. No new analysis provider was started.

This supplies implementation details for the pending shared duplication
operation; it does not establish curve evaluation, native numerical acceptance,
or GUI/MCP duplication parity. Application source and tool discovery remain
unchanged. No application build, unit/CAD suite or browser replay was rerun.

## Selected-group anchor and defining points

The retained activation dossier for `0x1406609b0` covers 2,048 bytes. A
digest-bound static check verifies 26 instruction anchors and the six previously
identified class tables. The new query/getter entries were read from the static
image; they were not recaptured from a live process.

Only curves whose selected byte at `+0xd2` is nonzero contribute. Virtual
`+0x170` returns a point collection with begin/end pointers at `+8/+0x10` and
`0x50`-byte records whose first three doubles are XYZ. The six bound classes use
these records:

| Class           | Collection offset | Records contributing to the anchor |
| --------------- | ----------------- | ---------------------------------- |
| Line            | `+0x198`          | All records                        |
| Arc             | `+0x198`          | All except the final center record |
| Circle          | `+0x198`          | Zero-based record 3, the center    |
| Spline          | `+0x238`          | All records                        |
| Ellipse         | `+0x198`          | All records                        |
| Partial ellipse | `+0x198`          | All records                        |

Virtual `+0x38` identifies the exclude-final policy on the bound arc class;
`+0x40` identifies the record-3 policy on the bound circle class. This is not a
complete list of eligible native curve categories or an analytic curve-bounds
calculation.

Each coordinate converts from binary64 to Float32 before strict ordered
minimum/maximum updates. All selected curves contribute to one set of extrema.
After checking ordered bounds strictly inside the positive/negative `FLT_MAX`
sentinels, the midpoint adds each minimum/maximum pair in Float32, widens that
sum to binary64, multiplies by 0.5, and converts back to Float32. It does not add
in binary64 before halving. Strict updates also retain the first zero sign;
JavaScript `Math.min`/`Math.max` have different zero-tie behavior. Synthetic
finite bounds can overflow the Float32 sum before halving. No native UI
authoring or MXCSR state was captured for that edge case. Activation initializes
only the dialog anchor's X component to `FLT_MAX`; it does not reset all three
components at that instruction.

The ordinary arc setter `0x1401e4d70` retains its three defining XY points in
outer fields `+0x80/+0x98/+0xb0`, forces their Z components to zero, appends them
in that order, and stores the computed center as a fourth record. The outer sync
`0x1401e3570` forwards those points to inner creation method `0x140275720`.
Instruction-level copies and argument setup bind its call at `0x140275aa0` to
the three-`gp_Pnt` `GC_MakeArcOfCircle` constructor. The constructor uses its
first and third arguments as endpoints and the second as a through point,
as documented by the [OCCT tutorial](https://github.com/Open-Cascade-SAS/OCCT/wiki/tutorial).

That import binding is derived from static IAT values: two known export RVAs
independently give the same old module base, after which slot `0x140eacd98`
resolves to `TKGeomBase.dll+0x192f00` and its exact three-point constructor
export. This is not a fresh live module binding. Forty defining-point
instruction checks and four constant checks support the chain; bounded slices
do not imply recovered unwind-function extents.

Ordinary P1 is therefore an independently retained through point, rather than
a calculated halfway point. For example, the same unit semicircle can retain
P1 `(0,1)` or `(0.6,0.8)` between endpoints `(-1,0)` and `(1,0)`. Synthetic
control-record anchors are respectively `(0,0.5)` and `(0,Float32(0.4))`.
ScanForge's current `SketchArc` stores endpoints, center and direction, with no
independent through-point reference. Reconstructing P1 from that analytic arc
would discard native state. Any representation correction must include GUI
authoring, the shared `sketch_set` operation and MCP contract, persistence and
history in one change. No such application change is made here.

Ordinary preservation has exceptions. The setter's near-point fallback compares
squared P0-P1/P2-P1 distances with `0.0001` and can replace P1. Its closing or
coincident-endpoint branch uses squared-distance threshold `1e-8` and can replace
P0. These exceptional paths are recorded, not established as complete numerical
fixtures.

Thirteen synthetic arithmetic cases passed and eight altered anchor policies
were distinguished or rejected. Three additional defining-point metadata
consistency controls rejected changed chains; these compare metadata and do not
independently mutate/redecode binary instructions. The two owned static readers
peaked at 77.04 and 157.60 MiB under the existing 4 GiB/25% CPU policy. Both exited
and closed their handles without cleanup errors. Independent read-only review
found no blocking issue in this scoped evidence.

No native function executed, private image was mapped as code, current native
process was accessed, or new analysis provider started. Application builds,
unit/CAD tests and browser replay were not rerun for this evidence-only change.
Duplication remains unimplemented and absent from MCP discovery. See the
[structured anchor contract](evidence/sketch-duplicate-anchor-contract.json)
for hashes, addresses, limits and remaining acceptance work.

## Implementation and validation gate

Before adding duplication, resolve remaining curve categories and degenerate
control-point paths, relation equations,
unit/precision numerical replay, picked-line eligibility/frame fixtures, path evaluation and
acceptance history on equivalent fixtures. Then implement all supported modes through one
shared operation used by GUI and MCP, with an observable preview/accept/cancel
contract, instance maps, bounded work, revision/retry/cancellation checks and
atomic history. Discovery must not advertise duplication before it exists.

Static checks verified the image/template digests, all 49 dialog controls,
30 message-map entries and terminator, Accept/Cancel bindings, numerical constants
and circular divisor branch. The follow-up checks bind all four copied relation
names and recover the spacing-helper formatting boundary. No new application
behavior, GUI/MCP end-to-end run, native numerical replay or full test-suite run is claimed by this investigation.
The analysis provider was closed after evidence retention.

See the [structured controller facts](evidence/sketch-duplicate-controller.json)
for exact evidence identities and unresolved boundaries. Raw decompiler output
and the captured image remain private analysis material.

## Concrete curve dispatch and kernel evaluation

Four bounded passive captures now bind the native type metadata, six outer curve
vtables, the inner geometry getter/factory, and fourteen imported routine targets.
Each capture read its selected metadata twice with identical results, verified the
exact process creation identity and installed executable hash, and closed both
handles. No target command or geometry routine executed and no scan buffers were
read. These observations are about that recorded process, which later exited.

Among the six bound outer classes, the picked-line query at virtual `+0x30`
returns true for the line class and false for arc, circle, spline, ellipse and
partial ellipse. This resolves those concrete table entries, not every possible
curve subclass or the complete UI eligibility chain. Their shared `+0xf0` getter
at `0x1401e0540` reads the geometry pointer at object offset `0x190`. Consequently,
the outer class's `+0x168` entry is not the path distance evaluator.

The base constructor obtains that inner object from service factory virtual
`+0x28`, bound to `0x140273450`, whose constructor installs table `0x141157ac0`.
The inner slots are:

| Slot     | Method                           | Address       |
| -------- | -------------------------------- | ------------- |
| `+0x120` | Reported path length             | `0x140273ff0` |
| `+0x168` | Distance to normalized parameter | `0x140274030` |
| `+0xb8`  | Point and tangent                | `0x140278bb0` |

For ordered finite inputs, distance inversion obtains the edge's geometric curve
and first/last parameters with `BRep_Tool::Curve`, loads `GeomAdaptor_Curve`, and
computes range length with `GCPnts_AbscissaPoint::Length`. It rejects lengths below
`1e-7`, clamps distance into `[0, length]`, and constructs `GCPnts_AbscissaPoint`
from adaptor, distance and starting parameter. This is the overload without an
explicit tolerance argument; the caller's extra `2^-23` argument must not be
mistaken for a selected tolerance overload. On success the stored value is
`(solvedParameter - firstParameter) / (lastParameter - firstParameter)`, in
binary64 arithmetic. It is neither raw curve parameter nor distance divided by
length in the general spline case. Kernel exceptions and unordered floating
comparisons have not been replayed.

Point/tangent evaluation delegates to `0x1401ec8a0`. On a non-degenerate edge it
clamps the normalized parameter for finite ordered inputs, evaluates
`first + (last - first) * normalizedParameter` through `BRepAdaptor_Curve::D1`,
and normalizes the derivative through `0x140154070`. A degenerate edge returns
its first vertex and the initially zero tangent. The `+0xb8` slot wrapper returns
false immediately when its native body handle at `+0x90` is zero, without writing
either output. Otherwise it calls the delegate, then unconditionally returns true.
The delegate initializes both outputs to zero and returns false if its topology
pointer is null; the wrapper discards that result. The enclosing duplication path
helper also ignores the wrapper status: its success follows the earlier distance
inversion. Valid-path runtime fixtures must establish the actual states reached
through the UI before reproducing failure behavior.

Reported path length uses a separate branch: `PK_BODY_ask_first_edge` followed
by helper `0x14026cbf0`. Static import candidates identify `PK_EDGE_ask_geometry`
and `PK_CURVE_find_length`; their two additional slots were not recaptured live.
The helper multiplies the result by a global scale whose current value remains
unread. It also temporarily changes a global flag, so it must not be invoked as
a supposedly read-only measurement probe. A single-kernel analytic length must
not silently substitute for this mixed path before numerical comparison.

Independent verification passed 50 checks, including twelve critical instruction
anchors, and three altered-class/getter/arithmetic rejection controls.
All fourteen captured import targets matched exact installed DLL export RVAs and
32 entry bytes. The largest successful helper peaked at 18.49 MiB under its
unchanged 4 GiB/25% CPU Job. A later attempt to capture full function spans and
the two extra imports stopped before any read because the process could not be
opened; the following inventory found no native process. It is retained as a
failed attempt, not counted as validation. The analysis session also closed with
no pending cleanup or remaining owned Java process.

The [structured controller evidence](evidence/sketch-duplicate-controller.json)
retains the artifact/Evidence IDs, capture hashes, import identities and limits.
No application behavior, GUI/MCP schema or discovery changed, so no build,
application unit/CAD suite or browser replay was rerun for this evidence-only
slice. Duplication remains unimplemented. Remaining gates include matching native
line/arc/spline fixtures, closed/reversed path behavior, selected-group anchors,
unit settings, copied relations, all four preview modes and atomic GUI/MCP history.

## Line and arc component numerical replay

The installed OpenCascade 7.7 components now have a controlled numerical replay
for seven generated edge fixtures and 56 samples. The fixtures use the existing
application worker's edge builders and BREP serializer, then load those BREP files
in a disposable native helper. They include a 3D line, a short line, clockwise and
counterclockwise arcs, a major arc in a tilted plane, and reversed line/arc
topology. This tests the recovered OpenCascade branch, not the full duplication
controller or the separate kernel that reports path length.

The helper calls `BRep_Tool::Curve`, `GeomAdaptor_Curve::load`, the recovered
no-explicit-tolerance `GCPnts_AbscissaPoint` constructor, range length and
`BRepAdaptor_Curve::D1`. The geometric adaptor is initialized through the exported
edge-adaptor constructor and getter before loading the curve and range explicitly.
Ten function bindings match the installed DLL export RVAs and 32 loaded entry
bytes; all three explicitly loaded component paths match their intended files.
The local static dependency closure is hashed before and after the run.

For these finite valid line/arc fixtures, the maximum analytic length difference
was `2.042810365310288e-14`; the largest point or unit-tangent difference was
`2.0872192862952943e-14`. Tangent normalization is performed by the harness from
native `D1` output, so this is not validation of the native normalization wrapper.
Distances below zero and beyond length are clamped by the reconstructed caller
in the harness before invoking the kernel. Its normalized result uses
`(solved - first) / (last - first)`. The native kernel's evaluated points,
derivatives and parameters are identical between the forward/reversed topology
pairs. This does not prove how the complete native controller selects or reverses
a path, nor the nonlinear inverse for splines.

An independent file-only verifier checks all 56 samples, both reversal pairs,
fixture/source hashes, resource receipts and ten export bindings. It rejects
three altered-result controls: multiplying instead of dividing by parameter
range, flipping a clockwise tangent, and reversing the line endpoint result.

Both owned helpers retained the 4 GiB/25% CPU policy, 3 GiB physical admission,
2 GiB disk admission and finite leases. Fixture generation peaked at 490.53 MiB;
the final native replay peaked at 34.34 MiB. Both child trees exited, their
handles closed and their receipts contain no cleanup errors. The native
executable, its private analysis image and its reported-length kernel were not
executed or opened by these helpers. C++ object storage is reclaimed at child
exit; this is not an in-process destructor or leak test.

See [component numerical evidence](evidence/sketch-duplicate-curve-numerics.json)
for fixture inputs, source/component hashes, function bindings, owner receipts,
official header provenance and explicit limits. No application behavior, GUI/MCP
contract or discovery changed. Duplication remains unimplemented; the existing
full-controller, spline, unit/frame/relation and GUI/MCP acceptance gates remain
open. No application build, full suite or browser replay was repeated for this
evidence-only change.

## Nonlinear curve comparison with the application kernel

Six further fixtures now compare the installed native geometry components with
the application's existing WASM kernel over 48 samples. They cover an open cubic
Bezier curve and its reversed topology, a range trimmed to `[0.2, 0.85]`, a
closed Bezier curve, a straight nonuniform Bezier curve with a stationary start,
and a cubic B-spline with a nonuniform internal knot at `0.35`. The candidate and
native runs use byte-identical generated BREP fixtures and identical requested
distances, with source/kernel hashes checked before and after execution.

All 480 native output doubles match the WASM results byte-for-byte: first/last
parameters, range length, solved parameter, point and `D1` coordinates. Another
192 input/derived doubles also match, for 672 comparisons in total. Raw
little-endian bytes are retained before JSON serialization, so a changed sign
bit on zero cannot disappear through numeric JSON equality. These are component
outputs and harness calculations, not execution of the full native wrapper.

The nonlinear cases reject a distance-divided-by-length substitute. For the open
Bezier fixture, half the path distance gives normalized parameter
`0.7313368860354995`, not `0.5`; the maximum parameter difference from that
substitute across these fixtures is `0.3256644374765935`. Independent de Casteljau
and de Boor evaluation agrees with native points within `3.552713678800501e-15`
and derivatives within `1.9539925233402755e-14`. The straight nonuniform fixture
has `x(u) = 3u^2 + 7u^3`; its distance residual is at most
`1.7763568394002505e-15`. Its first derivative is exactly zero at the start.
This does not validate the native tangent-normalization wrapper on that state.

The file-only verifier checks byte comparisons for all 48 samples, ten installed export
bindings, both kernels' matching BREP/source inputs, the reversed curve pair,
closed endpoints, trimmed range and stationary derivative. It rejects three
altered results: using a uniform distance parameter, omitting the trim origin
and flipping a zero sign bit. An initial fixture run failed during WASM object
cleanup because the helper deleted both a curve handle and its raw geometry
wrapper. That failed run is retained separately and excluded from passing
validation. The corrected private helper leaves ownership with the handle.

All successful owned helpers kept the existing 4 GiB/25% CPU limits and finite
leases. Their children exited and handles closed without cleanup errors; the
largest successful helper peaked below 490 MiB. No native application process,
private analysis PE or separate reported-length kernel was accessed by these
helpers. Their process teardown is not an in-process destructor/leak test.

The [nonlinear component evidence](evidence/sketch-duplicate-spline-numerics.json)
records fixtures, byte counts, hashes, owner receipts, failure accounting and
remaining limits. This supports reusing the existing kernel's recovered
distance/evaluation overloads for these cases. It does not establish general
rational/periodic spline behavior, units, selected-group anchors, copied relations
or all four modes' complete native-controller acceptance. No application code,
GUI/MCP contract or discovery changed. Duplication remains unimplemented; no
application build, full suite or browser replay was repeated for this slice.
