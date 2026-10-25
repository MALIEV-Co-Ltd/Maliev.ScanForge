# Reference point and line reconstruction contract

Reference points and reference lines remain unimplemented construction objects.
The ribbon entries are placeholders, and no MCP tool advertises their creation.
This document records the native evidence and the shared application work needed
for [M4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/4). It does not
establish numerical equivalence or completion of that milestone.

## Observed construction modes

The installed manual, SHA-256
`acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`,
documents these workflows on PDF pages 40–42 (printed pages 34–36). The extracted
text and rendered pages were inspected privately. No manual assets are included
in this repository.

| Object | Mode                   | Documented input and behavior                                                                                                                                                                                |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Line   | Typed endpoints        | Enter start/end XYZ or pick their locations from existing geometry. The dialog exposes length in millimeters; endpoint arrows resize the displayed line.                                                     |
| Line   | Two primitives         | Select two objects using the selectors or viewport picks. Two planes produce their intersection; plane/cylinder projects the cylinder axis onto the plane; two cylinders or two lines produce a transversal. |
| Line   | Average                | Select one or more primitives. The documented example constructs an average axis from two approximately concentric cylinders.                                                                                |
| Point  | Typed coordinates      | Enter XYZ.                                                                                                                                                                                                   |
| Point  | Line midpoint          | Select a line to obtain its middle point.                                                                                                                                                                    |
| Point  | Primitive construction | Select the relevant primitives to construct their intersection. The manual does not give the complete supported pair matrix.                                                                                 |
| Point  | Three planes           | Select three planes to construct their intersection.                                                                                                                                                         |

Acceptance adds an object to the object tree. These objects are inputs to later
construction, pattern and alignment operations. The dialog also supports
cancellation; temporary interaction must not be treated as an accepted object.

The manual leaves these numerical and lifecycle details unresolved:

- The full allowed primitive combinations and treatment of parallel, coincident,
  skew, degenerate and invalid inputs.
- The average-axis weighting, direction-sign conventions and selection order.
- Endpoint ordering, finite line extent, default length and the anchor used when
  changing length.
- Numeric tolerances, normalization, rounding and failure conditions.
- Whether accepted objects retain live source dependencies or copied geometry,
  and how subsequent edits, source deletion and project reopen behave.

These are reconstruction requirements, not permission to substitute convenient
formulas or silently omit construction modes.

## Static trace

The current installed executable has SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
The preserved analysis image is bound to that executable and has SHA-256
`a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`.
The capture identity is retained in the [structured evidence](evidence/reference-geometry-discovery-20261023.json).
Analysis images are read as data and never executed.

A bounded literal scan found 39 matching strings and 26 decoded RIP-relative
address references. Four useful entry candidates are:

| Label reference | Candidate entry | Observed pointer to candidate |
| --------------- | --------------- | ----------------------------- |
| `0x1405778ca`   | `0x1405776a0`   | `0x1411a6018`                 |
| `0x14057e50f`   | `0x14057e500`   | `0x1411a6f68`                 |
| `0x1406b235a`   | `0x1406b20e0`   | `0x1411d6428`                 |
| `0x1406b9df6`   | `0x1406b9d70`   | `0x1411d6df0`                 |

These candidates have preceding padding, continuous instruction decoding to the
label reference, and an observed pointer in the captured image. Those facts do
not alone prove complete function boundaries, reachable dispatch, class identity,
ABI or numerical behavior. The image's exception directory is not mapped in its
preserved sections, so it cannot supply independent function bounds.

The structured evidence records the analyzer results separately from byte-level
observations. A provider timeout is an analysis limitation, not an application
memory failure or evidence that the native construction is unsupported.

Two broad auto-analysis imports reached the same three-minute startup deadline,
including a derivative with four candidate discovery entries. Both sessions
closed and their owned Jobs became empty. A focused static import with default
auto-analysis disabled then recovered 14 selected functions across three runs:
the four initial candidates, two acceptance paths, their four control/update
paths, two object constructors and two geometry dispatch targets. All 14
decompilations completed. The first focused run took 11.83 seconds and peaked at
1,090,547,712 bytes of aggregate Job memory, under the unchanged 4 GiB / 25% CPU
policy. The other runs and cleanup receipts are also retained in the evidence.

The line acceptance path calls `0x140573170`; the point path calls
`0x14057f640`. Those functions dispatch through slot `0x1f8` on their construction
objects. The constructor-assigned table candidates resolve that slot to
`0x14040e340` for lines and `0x14041b1e0` for points. These two recovered bodies
were the initial numerical-analysis targets. Their dependency ordering and all
error branches still require comparisons against native results. The preserved
image omits the RTTI type-name storage; the fresh runtime read described below
supplies that identity evidence separately.

### Numerical helpers and current runtime binding

Further focused analysis recovered six feature-extraction helpers and six math
or construction helpers. Independent decoding checked 3,557 instruction starts
across 14 numerical-path functions. The only mnemonic differences were the
equivalent `MOV`/`MOVABS` and `SETC`/`SETB` spellings.

A fresh identity-bound read of the running installed application then compared
all 14 code spans twice against the preserved static image. All bytes matched.
It also resolved both construction-object type descriptors from their current
mapped storage and bound the two math imports to the current system runtime's
`sqrt` and `cos` exports. The process handle closed; no native functions were
called, hooks installed, geometry read, input sent or target memory written.
The [numerical evidence](evidence/reference-geometry-numerics-20261023.json)
retains the hashes, read limits and cleanup results. This establishes current
code and import identity, not an execution result for a constructed object.

The static numerical rules now include:

| Path                          | Corroborated rule                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vector normalization          | Normalize when the computed length is at least `2^-52`; preserve smaller vectors.                                                                                                                                                                                                                                                                                       |
| Closest points between lines  | Accept only when the absolute determinant is strictly greater than the supplied tolerance. Construction passes `2^-23`. Return a point on each line; skew lines need not intersect.                                                                                                                                                                                     |
| Plane intersection            | Require cross-product squared length at least the supplied tolerance (`0.001` in the construction calls), then a selected 2D determinant of magnitude at least `2^-23`. Normalize the cross product and choose the dominant axis, breaking ties X before Y before Z. The anchor uses that axis and the stored plane offsets; it is not a generic minimum-norm solution. |
| Near-parallel classification  | Compare the absolute normalized direction/normal dot product with `cos(1 degree)`. Equality follows the general intersection path; the larger-dot branch uses fallback geometry.                                                                                                                                                                                        |
| Line/plane point intersection | Require squared normal/direction dot product strictly greater than direction squared length times `0.0001`; a rejected branch can retain the prior point.                                                                                                                                                                                                               |
| Average line                  | Sum extracted segment midpoints without radius/length weights. Normalize each input axis, flip it when its dot product with the running axis sum is negative, then normalize the sum. The sum uses explicit near-zero guards.                                                                                                                                           |
| Average line extent           | A previous length at most `2^-23` selects an extent centered on the average midpoint using the largest input half-length. Otherwise project the previous endpoints onto the averaged axis. The final stored segment updates only when its reconstructed length exceeds `2^-52`.                                                                                         |

The construction dispatch contains distinct fallback and unchanged-state paths;
these must not be replaced with one blanket parallel-input exception. Exact
primitive eligibility, CAD/curve pick resolution, dependency ordering and all
state transitions still need dedicated coverage. Static extraction does not
replace original-code numerical comparisons for these new modes.

`src/reference-geometry-numerics.ts` now implements closest-line points, plane
intersection and normalization. Datum alignment delegates its existing
closest-line calculation to the shared helper with the same `2^-23` tolerance.
GUI and MCP datum operations already use that path, so their schema, validation,
revision/retry/cancellation and history contracts do not change. No new tool is
required for this internal refactor. The normalization and plane-intersection
helpers are foundations for the pending construction operation.

Thirteen analytic tests cover the new helpers, including threshold equality,
non-unit directions/normals, skew lines, dominant-axis ties, signed zero and
immutable inputs. Together with the existing native datum fixtures and shared
datum API suites, the focused run passed 1,045 tests in seven files under the
unchanged 4 GiB / 25% CPU policy. The analytic cases are explicitly not labeled
native captures. Full construction and rendered GUI/MCP acceptance remain open.

## Retained construction state and project records

The [lifecycle evidence](evidence/reference-geometry-lifecycle-20261023.json)
extends the static trace to acceptance, reference storage, geometry payloads and
the enclosing project reader. It records 47 inspected entries, 6,165 independently
decoded instruction starts and 306 checked direct-flow targets. The instruction
lists are not complete-function counts: the analyzer can recover additional
switch arms during decompilation after its initial listing was collected.

A fresh read-only binding matched all 47 selected code ranges against the running
installed executable twice. Its advertised exception directory contains 34,418
records, with four out-of-order transitions near the tail. The verifier scans
the whole bounded directory linearly. Forty-three selected entries have matching
advertised ranges; four use only the analyzer body range containing the entry.
Disjoint tail-call ranges are kept separate, and the four fallback ranges do not
establish complete function ownership. The capture read 480,754 bytes in 158
calls, closed its process handle and made no target calls or writes. All owned
analysis Jobs retained the 4 GiB / 25% CPU limits and closed cleanly.

### Source and dependent references

The acceptance methods at `0x140573930` and `0x14057fcd0` remove the accepted
object's old reverse links from its previous inputs, clear its input set, then
add references according to the selected construction mode. Input identifiers
and dependent identifiers occupy separate ordered sets. The common insert,
erase and clear methods agree with the earlier
[authoring-root evidence](NATIVE_ALIGNMENT.md#published-authoring-roots).

The common record method at `0x140471f30` writes and reads object identity,
update level, counted input identifiers and counted dependent identifiers. Each
identifier occupies 16 bytes. Its load path clears each destination set and
inserts the saved identifiers. The separate name method at `0x14046f820` retains
counted UTF-16 code units. This establishes that the format retains links; it
does not by itself prove every live edit, deletion or broken-link recovery rule.

The existing [generic scene-refresh evidence](NATIVE_DATUM_ALIGNMENT.md#generic-scene-refresh-execution)
establishes update propagation through dependent references and update levels.
The point and line wrappers additionally bind their specialized geometry update
methods through slot `0x1f8`. Construction integration must extend the shared
application dependency mapping and preserve this distinction between scheduling
an update and evaluating the geometry.

The shared dependency collector now maps validated semantic reference common
source identities into its existing graph. It preserves those stored links even
in inactive modes and does not infer dependencies from retained ordered picks.
The existing alignment GUI and MCP operation share the collector; reference
movement remains blocked. Six new cases cover transitive discovery, pick/common
separation, inactive sets, invalid payloads, cycle validation and application-API
responses. The five-file run passes 198 tests after a successful build. Source
reevaluation, native comparison and rendered lifecycle remain unfinished; see
`evidence/reference-dependencies-20261024.json`.

### Full reference records and geometry-only payloads

The enclosing reader at `0x1404676d0` dispatches line and point cases `0x26` and
`0x27` through reader slots `0x1b0` and `0x1b8`. The corresponding static table
at `0x141189e78` selects `0x140489120` and `0x140489840`. Their paired write/read
branches retain the following state in addition to common names and links:

| Object | Retained fields                                                                                                                                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Line   | Double-precision start/end coordinates; a four-byte construction mode; counted 28-byte records containing a 16-byte identifier and 12-byte coordinate portion; a separate counted array of 12-byte coordinate records. |
| Point  | Three double-precision coordinates; construction mode and two additional four-byte fields at offsets `0x2bc` and `0x2c0`; a 12-byte field at `0x2c4`; a counted array of 12-byte coordinate records.                   |

The coordinate record arrays are distinct from the common input/dependent sets.
Their complete interpretation across fitting, primitive construction and CAD
picks still requires correlation with the control and geometry paths. The live
reader instance and serialization dispatch were not observed.

The smaller object-level payload methods `0x14040d340`/`0x14040d460` and
`0x14041ac20`/`0x14041ad20` are separate from those full records. In particular,
the line payload loader reconstructs direction and length. Testing only these
payloads would miss mode, source-link and retained-pick persistence.

The application therefore needs explicit semantic point/line geometry plus its
construction definition, resolved source references and retained pick data.
Representing an accepted reference as coordinates alone would discard observed
state. The same definition must travel through shared GUI/MCP operations,
inspection, undo/redo, project save/reopen, transforms and dependency discovery.
No such application schema or creation capability is introduced by this evidence
update. Native object-output comparisons, actual save/reopen results, deletion
policy and rendered GUI/MCP acceptance remain outstanding.

## GUI and MCP integration obligations

### Point evaluation outcomes

The [point outcome audit](evidence/reference-point-outcomes-20261023.json)
corroborates five existing function records with 1,534 independently decoded
instruction starts and 161 direct-flow targets. Ten selected branches, seven
coordinate/state stores and five constants were checked separately. The owned
verification Job retained the 4 GiB / 25% CPU policy and closed cleanly. This was
a static audit; it did not call the native evaluator or read a new live object.

The point controller copies its mode to the construction object. Mode `2` writes
typed XYZ through the unit conversion service; the geometry evaluator preserves
those coordinates. Mode `3`, submode zero, takes the first input in the ordered
identity set: an axis produces its segment midpoint, a point/sphere produces its
stored center, and failed extraction produces the origin. A nonzero submode uses
the first two identities. Repeated identities collapse in the common input set;
click order is not its evaluation order. Mode `4` requires exactly three inputs.

| Pair categories         | Static result                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Point-like / point-like | Arithmetic midpoint.                                                                                                            |
| Point-like / axis       | Projection onto the unbounded axis, using its endpoint difference and squared length.                                           |
| Point-like / plane      | Subtract the plane-equation value times the stored normal; this branch does not divide by normal squared length.                |
| Axis / axis             | Midpoint of closest points when the angular and determinant tests accept; otherwise the midpoint of the two segment midpoints.  |
| Axis / plane            | Intersection when the squared dot-product test passes; otherwise retain the prior point and skip the ordinary state-word store. |
| Plane / plane           | Origin through failed second-input extraction.                                                                                  |

These categories describe the inspected primitive helpers, not complete CAD or
scan-pick eligibility. Reversing mixed categories follows corresponding branches,
but does not establish bitwise-identical floating-point evaluation order.

The important state distinction is at the branch targets. Axis/plane rejection
at `0x14041b72e` or `0x14041b95e` jumps to `0x14041c249`, past both geometry
publication and the two-byte `0x100` store at object offset `0x2b0`. In contrast,
three-plane failure reaches the zero-coordinate store at `0x14041c228` and then
the ordinary state store at `0x14041c23f`. The three-plane path uses the existing
plane-intersection helper for the first two planes, then the line/plane test for
the third. Missing, ineligible or rejected inputs can therefore overwrite the
point with the origin instead of retaining its previous position. The higher
level interpretation of the two native flag bytes remains separate evidence work.

The application evaluator needs explicit updated, fallback, origin-written and
unchanged outcomes. API validation errors must remain distinct from these native
geometric outcomes. This audit does not establish the native dialog's input
admission, behavior for non-finite intermediate values, final acceptance or
native project round trips. No construction tool or ribbon action is enabled.

The approved [persistent construction design](superpowers/specs/2026-10-23-reference-construction-design.md)
maps this state to shared GUI/MCP operations, semantic geometry, retained recipes,
stable raw ordering identities and the complete project/history lifecycle. It is
approved for implementation on 2026-10-23 and is not an implementation-completion record.

### Internal implementation checkpoint

`reference-construction-values.ts` now validates detached Float64 point/line
values and encodes their little-endian bits for lossless JSON boundaries,
including signed zero. `reference-construction-identity.ts` resolves provisional
raw ordering keys without mutating the scene, checks collisions across all
objects, and returns migration assignments only for participating sources.
These modules have not yet been connected to project Entity publication.

`reference-point-evaluation.ts` implements the recovered point arithmetic on
already-resolved, ordered primitives. It distinguishes normal updates,
axis-midpoint fallback, origin writes and retained geometry/state. Plane
projection uses the stored equation, while axis/plane and final three-plane
intersection use the stored plane origin. Input resolution, source refresh,
controller writes and public request validation remain outside this helper.
Non-finite results are rejected at the semantic-value boundary; equivalence
outside the established finite/non-overflowing domain is not claimed.

The initial foundation and point checkpoint passed 98 analytic tests in four files. The
application build passes; a separate instruction-level arithmetic audit found
no discrepancy in the scoped point helper. Native output comparison and the
full construction lifecycle remain open. Existing datum MCP behavior is
unchanged; no new reference construction GUI action or MCP command is published.
See [implementation evidence](evidence/reference-construction-foundation-20261023.json)
and the [implementation plan](superpowers/plans/2026-10-23-reference-construction.md).

The subsequent [line implementation evidence](evidence/reference-line-implementation-20261023.json)
records the current source hashes and 154 passing analytic tests in five files,
including the existing point and numerical suites. `reference-line-evaluation.ts`
implements stored mode, endpoint stores, ordered averaging and finalization;
`reference-line-pairs.ts` supplies ordered pair candidate endpoints. Both use the
same precise value layer intended for shared GUI/MCP operations. They remain
internal until source resolution and the complete persistent editor lifecycle
are integrated and accepted.

Pair construction has no prior-length extent-preservation policy. Point/axis and
point/plane pairs start at the point in either input order. Axis/plane pairs
project both axis endpoints onto the plane; they do not intersect the axis with
the plane. Axis/axis fallback projects the midpoint of both segment midpoints
onto each original axis. Plane/plane fallback projects the midpoint of the plane
origins onto each plane using its raw normal and stored equation offset.

Successful direct-plane intersection uses the maximum of the four stored extent
fields as half-length. For CAD-derived planes, newly recovered bounds helpers
merge only a valid second box into the first and return the largest Float32 axis
span. The line caller uses half that span and projects a center calculated from
the first object's bounds sampled twice, with Float32 rounding at each midpoint
and mean step. The merged-box center and a box diagonal would produce different
results. An inverted first box can be repaired by a valid second box; validity
checks are intentionally asymmetric. Raw bounds resolution remains a prerequisite
for this internal branch.

Independent static corroboration covers seven selected procedures, 2,085 listed
instruction starts, 179 direct-flow targets, nine branch checks and seven operand
checks. These are not proof of complete function coverage or original-code output
acceptance. The build, final typecheck and focused suites passed within the same
4 GiB / 25% CPU policy. No construction GUI action or MCP tool is advertised yet.

### Line state, defaults and retained input order

The [line state audit](evidence/reference-line-state-20261023.json) adds six
focused control/setter procedures and independently checks twelve relevant
function records: 3,896 listed instruction starts and 372 direct-flow targets.
Selected record-range operands, finalization branches, the state-word store and
constants were also checked. The focused analysis and verification Jobs stayed
within the existing 4 GiB / 25% CPU limits and closed cleanly. No native function
was executed and no new live binding of the six added entries was performed.

Line modes do **not** use the point evaluator's sorted-set order. Mode `3` reads
the first two records from the retained array at outer offsets `0x2d8..0x2e0`,
stepping 28 bytes per record. Each contains an identity and a 12-byte pick suffix.
The controller appends the first selector's record and then the second's, while
separately inserting their identities into the common input set. The inspected
controller has no record deduplication: repeated records can coexist with one
deduplicated dependency. Whether the native UI admits every such selection is
not established by this trace.

Mode `5` uses the same ordered record vector for average-axis evaluation; the
common input set only supplies a nonempty guard. Each successful axis extraction
increments the contribution count before normalization, contributes its midpoint
without length/radius weighting and updates the maximum half-length. Running
direction-sign adjustment follows record order. An extracted zero-length axis
therefore cannot be silently dropped merely because a later normalization yields
zero. Preselected average objects are copied into records with zero pick suffixes;
the origin of that preselection vector's order remains separate evidence work.

The shared construction wrapper applies the average common-source guard before
binding resolved records: an empty set leaves records inactive and re-finalizes
prior endpoints, including the ordinary completion-state write. Definition
validation still runs; pair mode is unaffected. Seven new regressions and 191
related tests pass in the exact seven-file run. Native runtime and rendered
acceptance remain open; see `evidence/reference-empty-average-20261024.json`.

The initial inner line constructor clears start, direction and length. The outer
constructor chooses mode `2`. The new-line command subsequently seeds an X-axis
segment from the returned scene X bounds, with Y and Z zero. For finite bounds,
inverted bounds or the extreme float sentinels select an origin-to-10 mm X-axis
fallback. A zero X span does not itself select that fallback. These are command
initialization rules before later dialog/preselection adjustments, not observed
final UI defaults.

The [numeric initialization checkpoint](evidence/reference-numeric-initialization-20261025.json)
independently corroborates seven retained constructor/dispatch procedures and
574 listed instruction starts. Both outer construction families call base
constructors that write state word `0x100`. Their shared validity getter returns
the upper byte; this getter alone does not prove a typed-Apply admission rule.
No new acceptance rejection is inferred from it.

`initializeNativeReferenceLine` now implements the finite Float32 scene-bound
seed. Every axis participates in inversion and inclusive extreme-float sentinel
checks; valid bounds supply only X endpoints, with Y/Z zero. Zero X span passes
the bounds check and the strict endpoint setter retains the cleared inner line,
including zero direction and length. `beginNumericReferenceConstructionPreview`
uses this seed before typed endpoint writes and uses the constructor state word.
Explicit point coordinates are supplied by the caller; this does not infer the
raw inner point constructor's coordinate default. Existing-object edits continue
to require their own retained geometry/state rather than these new-object seeds.
Public construction source admission, controls, Apply eligibility and original
native output/save-reopen comparisons remain unfinished.

The [scene-bounds scope audit](evidence/reference-scene-bounds-scope-20261025.json)
extends this to nine retained procedures, 1,817 independently decoded listed
instruction starts and 260 direct flows. Static controller type descriptors and
locator/table records identify the base and concrete-model bounds candidates.
The base query initializes an empty Float32 box, filters collection entries with
a native predicate, excludes one interface and unions valid per-object boxes.
The concrete query additionally obtains special-source bounds; a source flag
and valid special box can return before ordinary aggregation. Otherwise the
ordinary collector and inclusive scalar merge remain involved. Source-order
choices on equal finite coordinates matter, including signed zero.

The ordinary candidate enumerator, object predicates/exclusion/placement paths
and special backend records still require mapping to application source state.
Static table candidates do not establish every live receiver or subclass. Keep
the authoritative scene-bound provider gated on those mappings; the numeric
initializer's explicit six-value snapshot is not itself scene admission. This
checkpoint changes no application or MCP behavior and makes no new native
numerical/runtime acceptance claim.

The virtual endpoint setter at `0x140a93410` computes
`sqrt((dy*dy + dx*dx) + dz*dz)` and writes start, unit direction and length only
when length is strictly greater than `2^-52`. The typed-endpoint controller uses
`sqrt((dx*dx + dy*dy) + dz*dz)` after unit conversion and has the same strict
threshold. The arithmetic orders must remain distinct. Rejected candidates leave
the previous stored line untouched at these setters.

Missing sources have a subtler outcome in the construction evaluator. Pair and
average modes seed candidate endpoints from the previous stored start plus
direction times length. Missing records or unresolved sources can reach ordinary
finalization, reconstructing and normalizing that segment again. It is therefore
not necessarily a bitwise no-op. Final candidate length at most `2^-52` skips
the geometry stores, but ordinary paths still write `0x100` to outer offset
`0x2b0`; only the initial guard's early return skips that state store too.

For averaging, prior length at most `2^-23` selects the mean midpoint plus/minus
the maximum half-length. A larger prior length selects projection of the old
endpoints onto the averaged axis. Both paths pass through the final length gate.
Fallback handling must preserve previous geometry, record order and these tests,
rather than always generating a fresh arbitrary-length segment.

The dialog data-exchange method maps its length member to control `0x421`.
Refresh reconstructs the endpoint and measures its distance from the start before
unit conversion, instead of simply copying the stored length. Whether that
control can independently drive a length edit is still unresolved. A bounded REA
inventory of the installed executable found 15 resources and no `RT_DIALOG`
entry; this says nothing about the runtime dialog's availability or editability.
Do not add a free-standing length setter based only on the displayed label.

These findings require ordered records and deduplicated dependencies to survive
the shared GUI/MCP editor, inspection, undo/redo and project round trips. Native
output comparisons, endpoint drag anchoring, full pair fallback arithmetic and
rendered acceptance remain open; no application capability changes in this audit.

### Source resolution and CAD provider boundary

The [source-resolution audit](evidence/reference-source-resolution-20261023.json)
corroborates ten selected procedures, 1,781 listed instruction starts, 142 direct
flows and five selected branches. Four additional provider wrappers were recovered
in a bounded static-analysis Job. This is static evidence, with no native function
execution or new live binding.

The point and line extractor families have different eligibility. Both extract
sphere centers, reference points, cylinder/cone/reference-line axes and direct
planes. Only the line extractors take retained Float32 pick coordinates and enter
the additional source paths. The later source-identity and sketch-record audits
identify selected concrete targets in those paths. A shared resolver must retain
this distinction rather than infer eligibility from a display mesh.

Additional line candidates compete by strictly smaller squared distance in their
stored traversal order. Equal-distance candidates preserve the first result. The
initial best squared distance is the finite value `3.4028234663852886e38`. Axis
and plane paths select the nearest candidate before checking its geometric
eligibility. If conversion fails, they do not retry the next-nearest eligible
candidate. The plane caller accepts its extracted normal only when
`abs(sqrt((ny*ny + nx*nx) + nz*nz) - 1) < 2^-23`; equality rejects, and this caller
does not renormalize it.

The newly inspected helpers dispatch into alternate CAD providers and use runtime
unit scales. Their wrappers do not yet establish equivalent projection, parameter
domain or coordinate-frame contracts for an application replacement. One axis
provider branch copies origin and direction without a visible write to the
caller's extent output; the caller subsequently reads that scratch location as a
double after it was also passed as a byte output to the projection helper. This
requires further path and runtime-state evidence before deterministic endpoint
behavior can be claimed. It is not evidence of an observed application failure.

The narrow point-field investigation also does not establish the purpose of the
retained fields at offsets `0x2c0/0x2c4`, or prove they are unused. Source resolution,
versioned recipes, native comparisons and the shared GUI/MCP workflow remain open.

There is earlier, separate evidence for the pointer-based axis provider:
[`alignment-datum-cad-axis-native.json`](../tests/fixtures/alignment-datum-cad-axis-native.json)
records 72 cylinder/cone/torus cases for the same controller address on analysis
image `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`,
explicitly selecting its OpenCascade branch. The existing
`nativeDatumCadAxisReference` implements that branch's arithmetic. Reconcile this
evidence and its source bindings before duplicating the conversion. It does not
verify the current carrier, the alternate provider, retained pick resolution or
the new construction workflow.

The [source primitive checkpoint](evidence/reference-source-primitives-20261023.json)
adds internal extraction from resolved native payload snapshots. Direct stored
cylinder and reference-line axes retain their raw direction and extent. Cone
endpoints use offset and `(length + offset)` separately, preserving addition
before multiplication. Plane origin, equation and direct half-extents remain
independent. Missing objects are distinguishable from existing objects whose
primitive extraction fails.

For resolved OpenCascade cylinder/cone/torus parameters, the adapter reuses
`nativeDatumCadAxisReference` and reconstructs the construction endpoint as
`direction * length + start`. It does not substitute the trimmed last-parameter
point; decreasing parameter bounds can produce different endpoints. Historical
axis/plane fixture regressions and new analytic cases pass, but they do not
establish native execution of this construction adapter on the current image.
The later alternate-provider and sketch-record checkpoints extend the internal
boundary. Classification 7, full pick acquisition, provider extent, unit-scale
initialization and scene identity resolution remain incomplete.

### Stored sketch point selection

The [sketch point checkpoint](evidence/reference-sketch-point-20261023.json)
binds the picked-point fallback to a sketch owner and its ordered child list.
Static constructor and virtual-slot tracing establish the inner owner, child
count and indexed linked-list traversal. Line and spline children expose stored
point-record containers from different fields. This does not establish how the
records are generated or identify them as control points, endpoints or an
arbitrary curve tessellation. Passive metadata reads matched 1,415 selected code
bytes on both passes; no native functions or geometry buffers were accessed.

`resolvePickedSketchReferencePoint` accepts an already resolved snapshot of that
ordered data and the owner's three-row affine transform. It preserves the native
multiply/add order, promotes the retained Float32 pick, and compares sequentially
summed squared distances against promoted FLT_MAX. Strict improvement preserves
the first exact tie across both child and record order. Nonfinite transformed
results produced by finite source values cannot win. Source absence and an
existing source with no qualifying point return distinct unavailable records.

The adapter validates finite canonical inputs and returns detached Float64
positions; that validation is an application boundary, not recovered native
handling of malformed snapshots. Analytic tests cover transform order, raw scale
and shear, Float32 rounding, distance accumulation, ties, the exact initial bound,
overflow and signed zero. They are not original-native numerical replay. Record
production, source/pick coordinate provenance, construction transactions and
rendered GUI/MCP acceptance remain required before publication. No public tool,
schema, import admission or authoring command is activated by this helper.

### Sketch backend and stored-record production

The [backend audit](evidence/reference-sketch-backend-20261023.json) follows the
child constructor through the active factory to its concrete curve backend.
Repeated passive reads verify the active factory pointer, selected virtual slots
and 8,721 instruction bytes across constructor, builder and conversion paths.
Eleven selected import targets match installed OpenCascade DLL exports and entry
bytes. Folded export aliases remain explicit; an address shared by several
exports does not identify one method without its receiver/call context.

One spline builder copies accepted points into a temporary list only when their
squared distance from the last accepted point is strictly greater than `1e-8`.
It uses the ordered sum of X, Y and Z squared differences. This is a temporary
curve-building filter: the backend separately retains the original input record
container. Replacing the authoritative records with this filtered list would
alter reference selection. Two-, three- and larger-point cases take different
builder paths, and closed/tangent-constrained paths remain distinct.

The conditional record-export path obtains an OpenCascade B-spline from a curve
adaptor, reads its knot array, and evaluates the curve at each mapped knot. The
parameter arithmetic is `((k - firstKnot) * (1 / (lastKnot - firstKnot))) *
(lastParameter - firstParameter) + firstParameter`, preserving that operation
order. A scalar native minimum with the upper parameter precedes evaluation;
this does not establish a lower-bound clamp. Each emitted record retains the
evaluated XYZ and parameter. This path supplies knot evaluations, not control
poles or a uniform display tessellation. Other paths retain supplied records,
so a universal replacement with knot samples would also be incorrect.

Separately, the spline's display subdivision path copies its stored source
collection when subdivision is disabled or produces an expanded collection with
intermediate evaluations when enabled. The reference-point getter returns the
source collection, not that expanded collection. Exact branch predicates,
provider errors, refresh order and owner/pick frames still require full lifecycle
validation before a scene resolver can publish results.

The current ScanForge `Sketch` v1 stores separate segment and arc arrays and has
no spline record representation or common ordered child collection. Its placement
API uses a rigid UV frame. These facts prevent treating existing display points
as a complete native source snapshot. The required model extension must preserve
ordered source children, each curve's authoritative records and placement, with
the same validation/persistence/history through GUI and `sketch_get`,
`sketch_set`, `sketch_manage`, and the planned construction operations. The audit
does not activate new schemas or agent capabilities. Original-native numerical
and rendered GUI/MCP acceptance remain open.

### Arc, circle and ellipse source records

The [conic source checkpoint](evidence/reference-sketch-conics-20261024.json)
traces selected rebuild, creation and backend paths through 21 procedures.
Passive reads bind the child getters and selected virtual methods to the running
application. The kernel constructors are identified as `GC_MakeArcOfCircle`,
`GC_MakeCircle` and `GC_MakeEllipse`; their folded `Value` getters require caller
context because many exports share the same address.

The selected three-point arc and circle paths retain four child records in
order: first defining point, middle defining point, last defining point, center.
The input points are flattened to local Z zero. These are child source records,
not the curve backend's separate records: the arc backend retains three defining
points, while the circle backend retains its center. Replacing the child getter
with backend samples would therefore change picked-reference results.

Creation and rebuild are stateful. For an empty source collection, the arc builder
initializes its fourth record from the possibly adjusted middle point, then
replaces it with the computed center after successful center/radius calculation.
For an existing collection it first updates only the first three records; a fit
failure can leave the prior fourth record. Internal curve fields and retained
source records therefore cannot be assumed interchangeable on failure. Record
writes precede the backend success result. This does not establish whether the
outer editor publishes or rolls back an unsuccessful rebuild. A failed provider
result must not be treated as proof that all records were absent or cleared.
The circle rebuild and backend reset details below distinguish those paths;
complete editor rollback still needs separate tracing.

The ellipse's three-point rebuild uses its first two points as diameter ends.
It obtains the center by averaging them, normalizes their difference for the
first axis, and uses half their distance as its first radius. The second radius
is the third point's distance to the infinite diameter line. The completed child
records are the negative first-axis endpoint, positive first-axis endpoint,
positive perpendicular-axis endpoint, negative perpendicular-axis endpoint,
then center. For local XY data the perpendicular is `[-axisY, axisX, 0]`.
If the second radius exceeds the first, the backend rotates its supplied axis
and swaps the radii, but the child record order stays in the original authoring
axis order. The backend stores four endpoints without the child center record.
Fewer than three supplied ellipse records are copied as incomplete input and
return failure; this is distinct from generating a completed ellipse.

The existing ScanForge drawing path does not retain these source contracts.
`drawThreePointCurve` stores an arc's endpoints and center; for a circle it calls
`drawSketchCircle`, which creates two circular edges from a center and one radius
point. Both paths discard the middle pick. Native source records cannot be
reconstructed uniquely from this representation. The shared model extension
must retain defining records and their identity/order explicitly, alongside the
derived curve used by existing profile and display consumers. Legacy geometry
alone cannot prove missing authoring provenance.

#### Ordered source-record storage

`src/sketch-source-records.ts` supplies an internal versioned record store for
the source side of this model. It retains owner identity, the twelve stored frame
values, ordered child identities/kinds and each child's ordered Float64 XYZ
records. The JSON-safe codec stores little-endian Float64 bits, preserving signed
zero and precision that ordinary JSON numbers or display Float32 buffers lose.
Unavailable, empty and incomplete child collections remain distinct. There is
no count-based claim that an arc, circle, ellipse or spline is valid.

Whole-child replacement validates and copies the proposed result before returning
it. It retains surrounding owner order and never merges stale middle/center
records into a rebuilt child. Prior values remain detached for a future shared
history transaction. The stored value can feed the existing selected-sketch
resolver directly; tests exercise exact middle/center picks and first-child ties
after encoding and decoding. This is application storage and analytic resolver
integration, not native-file import or an observed native save/reopen result.

The internal admission budgets are 8,192 children and 32,768 total XYZ records.
These are explicit application resource policies, not inferred native limits.
Decoding checks aggregate numeric payload sizes before allocating them. Unknown
record fields, unsupported kinds (including unverified groups), duplicate IDs,
nonfinite coordinates and sparse arrays fail validation rather than silently
losing data. Arbitrary string identities retain their UTF-16 code units.

This store is not yet attached to `Sketch` v1, `SavedSketch`, project files or
the authoring UI. It does not make the existing reduced curve graph authoritative
for native records. Solver, trim, mirror, curve rebuild and undo must publish
geometry and these records together through the shared editor before activation.
Existing `sketch_get`, `sketch_set` and `sketch_manage` remain the GUI/MCP contract;
no new construction capability is advertised by this internal prerequisite.
Native rebuild failure publication, nested groups, full source admission and
rendered GUI/MCP/native acceptance remain outstanding.

`nativeReferenceCircumcenter` in `reference-geometry-numerics.ts` now implements
the recovered common three-point center calculation as an internal helper.
It preserves ordered dot products, product grouping, the inclusive determinant
threshold `Number.EPSILON`, and the barycentric accumulation. On degeneracy it
returns the ordered centroid with `nondegenerate:false`; callers must not treat
that center as a successfully constructed circle. As with the other arithmetic
helpers, callers own canonical coordinate validation and provider admission.
The supported arithmetic contract uses finite bounded coordinates and finite
intermediates; malformed native floating-point handling is not generalized.

Eleven analytic tests cover a 3D triangle, obtuse geometry in cyclic orders,
thresholds below/at/above equality, collinear and repeated points, signed zero,
immutable inputs and a rounding-sensitive determinant case. They do not replay
native code. This helper does not change existing drawing commands, agent
schemas or source admission. Shared GUI/MCP source integration, native numeric
comparison and rendered lifecycle acceptance remain open.

### Center/radius circle inputs and editing

The [circle input checkpoint](evidence/reference-sketch-circle-inputs-20261024.json)
identifies a center/radius helper called by a native command path. It admits a
finite radius at or above `2 ** -23`, then supplies three points to the existing
child rebuild: `X * radius + center`, `Y * radius + center`, and
`center - X * radius`, in that order. Two agreeing passive reads identify this
helper's basis vectors as local +X and +Y. The helper preserves the supplied Z;
the child subsequently flattens its defining points to Z zero and fits the
center again. Passing the input threshold does not prove that this later fit or
the backend succeeds. It also does not establish that every interactive circle
tool uses this command path.

`nativeReferenceCircleInputPoints` preserves this ordered input calculation as
an internal shared numerical dependency. It requires already validated finite
bounded input. Negative and subthreshold radii return no input records; the
helper does not take the absolute value or invent a default. Zero products and
the distinction between addition and subtraction remain explicit to preserve
signed zero. Returned records are detached. Twelve analytic cases exercise the
threshold and its immediate neighbors, order, offsets, signed zero, immutability
and the distinction between input admission and final fitting. They are not
original-native numerical replay or published authoring acceptance.

The separate radius-edit method has different semantics: it takes the absolute
radius and substitutes `0.01` when that magnitude is strictly below `2 ** -23`.
It rescales the three defining points along their existing radial directions;
it does not regenerate the cardinal points above. A degenerate middle radial
direction uses the observed local +Y fallback. Moving the fourth, center record
translates all three defining points and the center in local XY, then updates
the backend. Editing one of the first three records instead invokes the
three-point builder. These paths must remain distinct in the eventual shared
authoring operations.

Independent decoding corroborates eight procedures, 842 instruction starts,
68 direct control flows and 12 selected input-helper anchors. Passive reads
match 4,235 selected code/constant/exception-metadata bytes twice, bind the
circle virtual methods and verify six selected function boundaries. Large
controller pseudocode remains exploratory: the initial instruction enumeration
for one switch controller omitted cases discovered during decompilation. It is
not included as a fully corroborated controller or complete GUI workflow.

Existing `sketch_get`, `sketch_set` and `sketch_manage` schemas and behavior are
unchanged. Integrating the defining records requires the same shared model,
executor/editor, validation, history and persistence for GUI and MCP. Source
owner/pick placement, interactive command admission, outer failure publication,
native output fixtures and rendered GUI/MCP acceptance remain open.

### Circle rebuild preparation and backend failure state

The circle rebuild checkpoint traces the three-input child builder at
`0x1401e6f80`, its fitting wrappers and the backend reset separately. The builder
copies the owner frame, copies the defining points, writes all three local Z
coordinates to positive zero, and invokes fitting on exactly these three points.
The fitting helper initializes its radius output to negative `Number.MAX_VALUE`.
It calls the shared circumcenter routine; when that succeeds, it computes radius
from the **third** defining point using `dy*dy + dx*dx + dz*dz`, then square root.
Radius must be strictly greater than `2 ** -23` for the fitter to publish its
center/radius. This strict test differs from the backend's inclusive admission.

The child replaces an unsuccessful fit's center with the middle defining point,
forces center Z to positive zero, clears its source collection and writes all
four records in A/B/C/center order. It then invokes the backend even when the
radius is the negative sentinel. A generic helper's centroid fallback is not
the circle child's retained center. The source writes do not imply that either
the backend or the editor accepts the circle.

The active backend circle entry at `0x1402753a0` calls reset before testing its
radius. Reset `0x140273cb0` clears the record range and backend kind, resets
bounds/cache fields and follows a tail-called cleanup fragment at `0x14026e0e0`.
The caller rejects radii strictly below `2 ** -23`; accepted radii proceed to
the previously identified OpenCascade circle construction. Kernel-handle failure
and successful publication remain distinct results. A failed fit must not bypass
reset and accidentally preserve an older valid backend curve.

`prepareNativeSketchCircleRebuild` in `src/sketch-circle-rebuild.ts` implements
the local preparation stage, returning copied placement, four precise source
records, fit status and a detached backend request. It does not execute the
kernel, publish an entity or report backend acceptance. Its opt-in finite-
intermediate guard uses the existing circumcenter arithmetic without changing
operation order; arithmetic overflow is an application validation error rather
than a claimed emulation of malformed native floating-point input. Existing
unchecked helper callers retain their earlier contract.

The new tests cover local-Z flattening, ordered records, middle-point fallback
instead of centroid, repeated/collinear inputs, determinant equality, input
admission versus fitting, signed zero, detached backend arguments, overflow,
and a radius case whose three point distances differ by floating-point rounding.
They also feed successful and failed preparation records through the source
codec and selected-sketch resolver. These are analytic tests, not original-
native numerical replay or native save/reopen validation.

Arc rebuild must remain a separate stateful path. The traced builder can adjust
its middle point when an adjacent squared distance is strictly below `1e-4`.
Its early fit failure precedes the backend call, unlike the circle builder's
unconditional backend request. Existing records and prior radius can therefore
survive different branches. Successful fitting can also set a closed flag and
copy the last defining point into the first internal field without rewriting
the first source record at that point. Complete closed-arc handling and outer
publication remain prerequisites; do not reuse the circle preparation to
implement arcs or normalize these distinct states into one record collection.

Independent decoding checks seven selected entries, 890 instruction starts,
90 direct flows and 19 selected anchors. A fresh pair of read-only probes matches
4,228 selected code/constant/descriptor/exception-entry bytes per pass and binds
the backend vtable. The reset includes an out-of-line fragment; some selected
exception entries cover only an initial fragment, not an entire procedure.
These probes execute no target functions and read no geometry buffers.
GUI/MCP authoring, backend lifecycle integration and rendered/native acceptance
remain unfinished; existing application discovery and agent contracts are
unchanged.

#### Stateful arc rebuild preparation

`prepareNativeSketchArcRebuild` in `src/sketch-arc-rebuild.ts` now implements
the separate local arc preparation stage. Callers supply prior radius, closed
flag and either an empty or complete four-record collection. Those carrier
checks, finite-input validation and overflow rejection are application policy.
No editor state is changed by this pure preparation function.
The radius field must be present but can explicitly be `undefined` when its
initial value is unestablished. An early failure preserves that state; a fallback
or fit that writes radius replaces it with a number. This is an internal carrier,
not a new public JSON schema or permission to persist undefined numerical fields.

The builder copies placement and A/B/C, clears local Z, and initially sets its
internal center to the original B. When either adjacent squared distance is
strictly below `1e-4`, it replaces B using the chord midpoint and perpendicular
normalized half-chord. That branch also writes radius before fitting. Empty
source storage becomes A/adjusted-B/C/adjusted-B; existing storage replaces its
first three records and initially retains its previous fourth record. The
outer determinant check is inclusive at `Number.EPSILON`. Failure there issues
no backend request, preserving the prior radius unless the midpoint branch
already changed it. Internal center and the fourth source record can differ.

After the center/radius helper, a positive radius replaces the fourth source
record with the fitted center. The helper's failure constant is promoted
negative Float32 maximum, distinct from the circle fitter's negative Float64
maximum. Explicit closure or endpoint squared distance strictly below `1e-8`
sets the closed flag and copies C into internal A. It does not rewrite retained
source A at that point. The backend request remains an arc with equal internal
endpoints; preparation does not invent a successful circle or assert backend
acceptance. A false closure argument does not itself clear a previous true flag.

Six additional static caller dossiers clarify flag ownership. Point editing
at `0x1401e4130`, transform rebuilding at `0x1401e3dc0`, and collection rebuilding
at `0x1401e5e90` pass the existing flag obtained through vtable slot `+0x120`.
Local and placed record replacement at `0x1401e5360` and `0x1401e5760` first
clear it through slot `+0x128`, then use a false rebuild argument on their refit
branches. The getters/setters access the flag at child offset `+0x200`.
Selected creation calls inside `0x1403a43d0` pass false and subsequently call
the owner insertion path. This caller inspection is static, not a new live
binding or evidence of complete outer transaction rollback.

Tests exercise local flattening, source/internal/backend separation, early
failure with empty and existing records, both adjacent-point repairs and its
strict threshold, failed fallback radius writes, explicit and near-endpoint
closure, caller-owned flag retention, rounding-sensitive radius, detached
inputs and requests, malformed states and overflow. Failed-edit source records
also round-trip through the exact codec and shared reference-pick resolver.
These tests do not execute the native program or validate its saved files.

The function remains an internal prerequisite. Existing `sketch_get`,
`sketch_set`, `sketch_manage`, GUI authoring and MCP discovery have no new
capability from this change. Integration still requires the real arc backend,
coherent curve/source editing and persistence, shared operation publication,
and native numerical plus rendered GUI/MCP acceptance. No public tool is
advertised for this incomplete workflow.

Evidence and validation receipts:
`docs/evidence/reference-sketch-arc-rebuild-20261024.json`.

#### Bundled-kernel arc backend

The internal `SketchArcBackend` in `src/cad/sketch-arc-backend.ts` uses the real
bundled OpenCascade three-point arc constructor, trimmed-curve handle and edge
builder. It owns one edge and three backend records, separate from the child's
four source records. The classic worker loads a generated local bundle compiled
from this TypeScript source and its shared numerical helpers; there is no second
handwritten copy of the circumcenter or normalization arithmetic.

Native backend `0x140275720` clears old state before its geometric checks,
recomputes the circumcenter, and measures radius from the third input. Its
radius threshold admits equality at `2^-23`. The following check has an unusual
scale dependency: calls at `0x1402759eb` and `0x140275a12` normalize the same
temporary vector B-A twice. The second chord C-A is not normalized. Admission
requires `abs(1 - abs(dot(C-A, twiceNormalized(B-A)))) >= 2^-23`. This must not be
replaced with a conventional collinearity test. For example, A=(0,0), B=(1,0),
C=(1,1) is rejected at this check, while doubling all three coordinates passes
it. A rounding-sensitive fixture distinguishes one normalization from two.

The implementation validates canonical finite requests before mutation. Valid
finite requests retire the old edge before the recovered numerical checks.
Geometric rejection leaves the backend empty; arithmetic overflow and kernel
exceptions propagate after the appropriate owned cleanup. These malformed-input
and exception policies are application checks, not observed native GUI rollback.
The supplied center is validated but the fit recomputes it from the points.
Success transfers edge ownership only after all construction temporaries retire.
Snapshots detach the three backend records; disposal is idempotent.

`tests/kernel-arc-smoke.mjs` runs the actual classic worker, generated helper and
bundled WASM using local files. It measures edge type, direction, endpoints,
midpoints and radii for both semicircle directions and a major arc. It checks
scale-dependent rejection, threshold equality and neighboring rejection, the
second-normalization rounding distinction, collinear/equal-endpoint rejection,
the closed preparation path, input/snapshot detachment, malformed requests,
overflow retirement, 32 replacements and final disposal. Controlled Value and
edge-completion failures use real allocated kernel objects and verify temporary
and previous-edge retirement; they do not claim observed native failures or
exhaustive leak detection. Existing CAD, curved-sketch and circle smoke suites
remain separate regression checks.

No scene, dispatcher, GUI or MCP operation has been added for this internal
backend. Shared child sessions and common editor transactions must still carry
preparation state and backend outcome together. Original-native numerical,
native save/reopen and rendered GUI/MCP acceptance remain outstanding. See
`docs/evidence/reference-sketch-arc-backend-20261024.json` for the validation scope.

#### Worker-local conic child ownership

`SketchConicChild` in `src/cad/sketch-conic-child.ts` combines the real arc/circle
backend with the corresponding shared preparation producer. The worker factory
creates a fresh owned backend. Snapshots detach preparation, source records,
backend records and the last rebuild outcome; native handles remain borrowed
inside the worker. This class stages one child and does not publish a scene,
shared editor transaction, persistent sketch or MCP operation.

Initialization is deliberately explicit. Factory `0x140a63150` passes a false
closed flag to constructor `0x1401e32f0`. The inspected constructor clears its
source collection and center but shows no direct stored-radius write. The base
constructor `0x1401e01c0` initializes the common points/frame and creates the
backend. The inspected direct stores do not establish an initial radius;
allocator contents and complete transitive initialization have not been proven.
The internal carrier therefore reports an uninitialized radius until a recovered
rebuild branch writes it, rather than inventing zero or reading native heap data.
This uncertainty is not a claim that every native allocation contains garbage.

For established radius values, the child validity predicate follows the traced
positive-radius and nonempty valid-backend conditions at `0x1401e3450`. It is
separate from last builder success. An early failed arc edit can retain an old
edge and a positive radius while storing new defining points and a stale fourth
source record; a fallback can write radius zero while leaving that edge present.
A positive fit followed by backend rejection stores the new preparation but
leaves no edge. Circle fit failure still attempts backend rebuilding and clears
the old edge. Snapshots expose these distinctions without reporting a failed
builder as a successful edit. The initial unknown radius has explicit
`uninitialized` validity; it is not silently treated as an observed native value.

Malformed requests or pure-preparation errors leave prior staged state unchanged.
Once backend work starts, its failure outcome and prepared source state remain
inspectable; exceptions propagate. Cancellation observed before work preserves
the staged child. A cancellation flag set during synchronous kernel construction
is checked after cleanup, then disposes the whole staged child and its records.
It does not interrupt WASM. The existing client worker-termination path continues
to own in-flight reset. Disposal is idempotent and invalidates borrowed edges.
These are application ownership rules; native GUI rollback is still unverified.

`tests/kernel-conic-child-smoke.mjs` exercises actual worker factories and real
kernel edges for both kinds, repeated failure-state transitions, deep detachment,
invalid requests, cancellation before and during work, exception cleanup and
independent child ownership. The unknown-radius preparation also has direct
regression tests. This does not complete common constraints/trim/mirror editing,
history/project persistence, worker child RPCs, shared GUI/MCP publication or
native/rendered acceptance. Evidence:
`docs/evidence/reference-sketch-conic-child-20261024.json`.

#### Local arc record replacement

`prepareNativeSketchArcLocalReplacement` and the worker child's
`replaceLocalArcRecords` implement the recovered local replacement route for
an already prepared arc. This operation is distinct from initial construction,
individual control-point edits and placed/world-record replacement.

The native replacement clears closure and derived caches before choosing a
route. With more than three incoming records, it compares the first three with
the current **internal** A/B/C, including Z. Each squared distance must be
strictly below `1e-5`, computed in X/Y/Z order. Exactly three records, equality,
or any larger distance selects the ordinary refit with closure initially false.
The refit still has its own near-endpoint closure rule.

The near-record route retains internal points, center and radius instead of
adopting the incoming coordinates. It applies literal positive-zero additions
to the points and center, then replaces the source collection with internal
A/B/C/center. This can change signed zero and repair a previously stale fourth
source record. It ignores the supplied fourth record's value. Backend rebuilding
still occurs, so retaining geometry does not mean retaining the old kernel edge.
The backend dispatch returns its actual success; no fitting occurred on this
route, represented by an undefined internal `fitSucceeded` diagnostic.

This distinction matters after an early failed fit: that fit can leave an old
valid edge alive, but a subsequent near-record replacement calls the backend
with the now-stored collinear internal points and retires the old edge. Closure
also makes internal A differ from source A, so comparisons must not use the
old source collection as a substitute. The common child lifecycle handles
exceptions and pre/post-work cancellation for both replacement routes.

Finite input, at least three records, the existing source-record budget and a
previously prepared child are application admission rules. Invalid requests
preserve staged state. The native derived-cache reset is traced, but private
native cache layouts are not reproduced in the application. Placed replacement,
individual point-edit policy, outer transaction rollback, persistence and
GUI/MCP publication remain separate integration requirements.

Twelve analytic cases and the expanded real-kernel child smoke cover retention,
refit, exact threshold equality, Z comparison before flattening, closure,
signed zero, source regeneration, backend failure and cancellation. Static
corroboration checks 247 selected instructions, 22 direct flows and 35 operand
anchors against the preserved image. These checks are not original-native
numerical or rendered GUI/MCP acceptance. Evidence:
`docs/evidence/reference-sketch-arc-local-replacement-20261024.json`.

#### Placed arc record replacement

`prepareNativeSketchArcPlacedReplacement` and the worker child's
`replacePlacedArcRecords` implement the separate world-record operation for an
already prepared arc. The supplied twelve-double frame places the existing
internal A/B/C for comparison with the first three incoming world records.
More than three records and three strict squared distances below `1e-5` select
center translation. Exactly three records, equality, or any failed comparison
select refitting. Both branches clear closure before performing their operation.

On the translation branch, the fourth world record is converted with translation
subtraction and the transposed rotation, accumulating Y/X/Z products in that
order. Its difference from the old local center is added to the existing center
and all three internal points. Assigning the converted center directly would
change rounding behavior; a cancellation-sensitive regression preserves this
distinction. Radius and the stored child frame remain unchanged. The supplied
frame controls comparison/conversion but is not copied on this branch. Local Z
is not flattened, and source records are regenerated from translated A/B/C/center
before the real backend rebuild. No fitting occurs on this branch.

Refitting converts the first three world records with the same transpose/order,
then calls the existing builder with the supplied frame and a false closure
argument. That builder flattens local Z and can still set closure through its
own near-endpoint rule. The fourth record does not control this branch.

Local and placed replacements share the internal translation-state producer and
owned backend/cancellation handling, while retaining their different branch
selection and frame rules. This finite raw-frame implementation is not a general
affine inverse or a change to public rigid-frame admission. Individual point
editing, common constraints/trim/mirror/history/persistence, and shared GUI/MCP
publication remain separate requirements.

Twelve additional analytic cases cover rotated/translated frames, stored versus
supplied placement, each world-point comparison, equality, closure, unknown
radius, cancellation-sensitive arithmetic, malformed inputs and overflow.
The actual-kernel child smoke measures the translated edge's center/radius,
checks three-record refitting and validates exceptions/cancellation/resource
retirement. Static corroboration covers 386 instructions, 11 direct flows,
43 operand anchors and 21 direct stores; it confirms no direct stored-frame or
radius overwrite in the translation branch. These are static and bundled-kernel
checks, not original-native numerical or rendered GUI/MCP acceptance. Evidence:
`docs/evidence/reference-sketch-arc-placed-replacement-20261024.json`.

#### Individual arc point edits

`prepareNativeSketchArcPointEdit` and the worker child's `editArcPoint` implement
the separate local control-point edit path. Indices 0, 1 and 2 replace the
corresponding internal A/B/C and refit with the existing frame and closure flag.
The untouched points come from internal state, which can differ from retained
source records after closure. The ordinary builder still flattens local Z,
repairs adjacent points, preserves early-failure state and handles closure.

Index 3 moves the center in local X/Y. Its requested Z does not drive the edit.
The X/Y difference from the old center is added to all three internal points
and the old center; each existing Z receives literal positive-zero addition.
Stored radius, placement and closure remain unchanged. Source A/B/C/center
records regenerate and the real backend is rebuilt without fitting. In
particular, this route preserves the nonzero local Z that a prior placed edit
can produce. Defining-point refits subsequently flatten it. Directly assigning
the requested center would change rounding and Z behavior.

Closure ownership differs from collection replacement: individual point edits
do not clear it first. A defining-point edit on a closed arc can preserve a new
source A while the builder copies internal C into internal A. A center move
preserves closure and translates those internal endpoints. Early failed refits
can leave an old edge alive; moving the center afterward still calls the backend
and can retire that edge on geometric rejection.

The native index guard returns false for indices outside its unsigned 0..3
range. The application boundary reports invalid indices as validation errors,
requires finite canonical XYZ even when center Z is unused, and requires an
already prepared arc. Malformed requests and pre-work cancellation preserve
staged state; exception and post-work cancellation follow the shared child
ownership path. These admission/error rules are application policy, not claims
about native outer transaction rollback.

Thirteen new analytic cases and the expanded actual-kernel smoke cover all
indices, closure/source separation, XY-only translation, nonzero Z, unknown
radius, stale source regeneration, rounding, invalid inputs and cleanup.
Static corroboration covers 144 instructions, 14 direct flows, 34 operand
anchors and 13 center-branch direct stores. It checks closure getter forwarding,
the zero Z delta and no direct frame/radius/closure overwrite on translation.
Transform editing, common model/solver/history/persistence and GUI/MCP
publication remain required. No public control-point tool is added by this
internal checkpoint. Evidence:
`docs/evidence/reference-sketch-arc-point-edit-20261024.json`.

#### Bundled-kernel circle backend

`SketchCircleBackend` in `public/cad-worker.js` now owns an actual OpenCascade
circle edge independently of scene CAD shapes. It uses an explicit local +Z
normal and +X direction, `gp_Circ`, `GC_MakeCircle` and the curve-based edge
builder. Its backend records contain only the center; the source child's four
records remain separate. The worker class is internal: no new message operation,
scene registration or GUI/MCP capability is advertised.

Canonical finite-value validation happens before mutation. A finite negative
fit sentinel is a valid rebuild request: the adapter releases the old edge and
clears its state before radius rejection. Radius equal to `2 ** -23` is admitted
by this backend, independently of the fitter's strict threshold. Successful
construction transfers the edge only after temporary handles are released.
Failed construction leaves an empty backend; an exception propagates after
cleanup. Disposal is idempotent, rejects later rebuilding/borrowing and retains
inspectable empty state. This is application resource/validation behavior;
native exception publication and editor rollback are not established by it.

`tests/kernel-circle-smoke.mjs` loads the real bundled kernel without a browser
or native executable. Its eighteen grouped checks inspect edge type, center,
radius, local basis and full-circle parameters, then exercise failed fits,
threshold neighbors/equality, detached inspection state, invalid requests,
32 successful replacements and disposal. The calculated X direction contains a
signed-zero component in this kernel; direction checks do not overwrite or
normalize it. Separate source-record signed-zero tests remain exact.

Two controlled faults use actual kernel temporaries: a circle-value exception
and an unfinished edge builder. Both release the old edge and constructed
temporaries. These are fault-injection checks of our ownership code, not observed
failures of the native program or exhaustive heap-leak proof. The existing CAD
and curved-sketch worker smoke suites also pass. The kernel binary digest is
`6cc2f3fa1611d32ad7563f7092aa1bf58741124302630cef7d21561ecd7b7284`;
its source/version provenance remains documented in `public/kernel/SOURCE_BUILD.md`.
Different native and bundled kernel builds are not assumed numerically identical.

The remaining work includes worker session ownership and cancellation, stateful
arc rebuilding, common geometry/source-record editing, history/persistence and
shared GUI/MCP publication. Kernel tests do not replace original-native numerical
fixtures, native save/reopen or rendered GUI/MCP acceptance.

### Sketch owner insertion and placed circle records

The [owner placement checkpoint](evidence/reference-sketch-owner-placement-20261024.json)
extends the circle evidence to frame access, source insertion and placed-record
rebuild. Frame access returns the stored twelve doubles; assignment copies all
twelve without normalization. Selected callers copy the owner's frame to the
new child explicitly. The insertion helper does not perform that placement
assignment itself.

Insertion first checks the child's validity method. For a circle this requires
a positive stored radius, a nonnull backend, a nonzero backend kind and a
nonempty backend record range. Only then does insertion update the child list
and register the child's backend with the owner's backend. This explains a
validation layer after the center/radius helper's returned flag is ignored by
its selected command caller. It does not establish exception rollback,
allocation-failure cleanup, command-result publication or every editor path.

The placed circle rebuild compares the supplied first three world records with
the transformed existing local defining points. With at least four records,
each squared distance must be strictly below `1e-5` to take the center-movement
branch. That branch converts the fourth record back to local coordinates,
computes its delta from the old center, translates all defining points and the
center, refreshes source records, and rebuilds the backend. Otherwise, it
converts the first three supplied records to local coordinates and invokes the
three-point builder with the supplied frame.

The inverse conversion subtracts translation and multiplies by the transposed
rotation block. It is a rigid-frame inverse, not a general affine matrix
inverse. Keep ScanForge's existing orthonormal frame validation. Forward and
inverse helpers also have explicit multiplication/addition orders; algebraic
equivalence alone is insufficient for binary64 fidelity. These findings do not
yet prove where every retained pick was acquired or which frame it belongs to.

This evidence extends independent decoding to eighteen procedures and binds
6,816 selected code/constant/metadata bytes on two agreeing live reads. No
additional application behavior or MCP schema is activated. The shared source
resolver still needs exact pick ownership and lifecycle evidence before it can
publish construction results.

### Open-spline construction contract

The [spline builder audit](evidence/reference-sketch-spline-20261024.json)
extends the backend evidence with the custom interpolation solver. Twelve
procedures have independent instruction/direct-flow corroboration; two passive
reads match 11,690 instruction bytes in the installed process. Seven selected
imports match installed DLL exports and entry bytes. These checks establish
code identity and call contracts, not observed curve outputs.

For more than three accepted points in the normal open-curve branch, the caller
selects cubic degree, centripetal parameterization and two natural endpoint
conditions. The endpoint conditions constrain the second derivative to zero;
they are not inferred tangent directions. The solver assembles its first
endpoint row, all interpolation rows in input order, then its last endpoint row.
With `n` input points there are `n + 2` control points and `n + 6` expanded knots.

The parameter increment between adjacent points is
`sqrt(sqrt((dy * dy + dx * dx) + dz * dz))`. Prefix accumulation adds the new
increment to the preceding prefix. Each prefix is divided by the final sum;
the implementation must not replace this division with multiplication by a
shared reciprocal. The total must not be strictly below `1e-14`. The generic
solver also has uniform, chord-length and power modes; this caller explicitly
chooses centripetal. The power-mode exponent passed by the solver is `0.8`.

For the default cubic path, start with four zero knots and end with four one
knots. Interior knot `3 + j`, for `j = 1 .. n - 2`, is the sequential sum
`((0 + t[j - 1]) + t[j]) + t[j + 1]`, divided by three. More generally, the
averaging helper subtracts the first endpoint constraint count from parameter
indices, clamps to the input range and averages `degree` parameters. Do not
substitute a kernel's preferred knot-generation policy.

The recursive basis and its first two derivatives omit a term when its knot
denominator is not strictly greater than `1e-14`. At degree zero, parameters
within a strict absolute difference of `1e-14` from the final knot select the
last positive knot span; other parameters use the usual half-open interval.
The dense solve selects the largest absolute pivot in the remaining rows,
preserving the first row on equal magnitudes. It swaps matrix and XYZ right-hand
side rows together, throws for a pivot strictly below `1e-14`, eliminates from
the pivot column onward and back-substitutes in descending row order. Arithmetic
order and threshold equality require explicit tests; a generic solver is not
automatically numerically equivalent.

After solving, the caller converts each control-point coordinate to Float32 and
promotes it back to Float64 before passing it to `Geom_BSplineCurve`. Expanded
knots are grouped by exact equality into unique knots and multiplicities. The
curve is nonperiodic. This rounding is part of this builder's geometry, separate
from display precision and from the original source records retained by the
backend. Keeping unrounded poles would change the constructed curve.

The three-point dispatch is different. It copies source XYZ without that pole
rounding step and calls `GeomAPI_Interpolate` with periodic false and tolerance
`1e-6`. On an unsuccessful interpolation result, the installed import identifies
the fallback as `GeomAPI_PointsToBSpline`: parameterization enum value `2`, minimum
and maximum degree `3`, continuity enum value `3`, and tolerance `1e-6`. The
numeric enum values are recorded without assigning names from an unverified SDK
version. A single natural-cubic replacement for both dispatches would therefore
be unsupported.

The general solver has additional tangent and curvature boundary branches;
their complete caller admission, failure propagation and numeric outputs remain
unverified. Closed curves, other two-point options, arc/circle/ellipse source
records and owner/pick placement still require evidence. This pass adds no
application implementation or public schema. Future integration must extend the
same sketch validation, editor operations, CAD worker, persistence/history and
MCP contracts together; native numerical and rendered GUI/MCP acceptance remain
required.

### Sketch pick acquisition and line acceptance

The [line-pick checkpoint](evidence/reference-line-picks-20261024.json) traces
the line tool's viewport handler at `0x1406b28d0`, preview controller at
`0x140573170`, selector admission at `0x140574400`, and acceptance at
`0x140573930`. Independent decoding checks 1,430 instruction starts and 182
direct flows across six procedures, with 18 selected quantization, storage and
acceptance anchors. Two agreeing passive reads bind 6,235 selected code,
descriptor and exception-metadata bytes per pass, plus three vtable/type
identities. The handler spans several exception-table fragments; the selected
entry metadata alone is not its full extent. No native calls, geometry-buffer
reads or UI input were used, and these are not native numerical output fixtures.

In the selected-record branch, the tool requires a cached sketch owner, a child
and a record index other than `-1`. It reads XYZ from the child's stored record
collection (80-byte stride), converts each local double to Float32 and promotes
it back to double. It then transforms through the sketch owner's twelve-double
frame, in the established component/addition order, and rounds each world
component to Float32. The first selector stores these twelve bytes at dialog
`+0x3720`; the second uses `+0x372c`. Selecting the first source arms the second
selector; accepting the second clears that selection flag. The preview copies
the source identity and stored coordinates into ordered 28-byte records.

`acquireSketchReferencePick` in `reference-source-primitives.ts` implements this
already-selected-record arithmetic for finite validated snapshots. It does not
perform hit testing, choose the owner/child/index, relax the public rigid-frame
contract or publish a construction. The later nearest-record resolver still
transforms the original double records, independently of this rounded pick.
Consequently, a selected record need not be the nearest record after acquisition
rounding. An analytic regression distinguishes those paths. Generic viewport
hits use another acquisition branch whose complete coordinate provenance remains
to be traced; this helper must not be applied indiscriminately to all picks.

Acceptance first updates the preview, copies its line geometry to the accepted
object, removes old dependency backlinks and clears its common input set. In
pair mode, it resolves the two selector identities. If either resolves to a
sketch interface, it changes the accepted mode to stored endpoints (`2`) and
does not re-add either dependency. Otherwise it re-adds the resolved inputs.
Average mode copies the preview's common input set. In all these paths the
ordered Float32 pick vector is copied afterward, including when inactive because
of the sketch-to-endpoints transition. Do not preserve a live pair dependency
for an accepted sketch-derived line or discard its retained records.

This establishes the selected acceptance branch, not complete command success:
scene publication, allocation/exception rollback and dependency refresh still
need their outer transaction evidence. The future shared GUI/MCP operation must
apply the same mode/dependency transition and preserve the copied line geometry
without recomputing it from rounded picks. No construction tool is advertised
by this checkpoint; shared lifecycle and rendered/native acceptance remain open.

### Sketch record selection and shared resolver branch

The [selection checkpoint](evidence/reference-sketch-selection-20261024.json)
extends the line-pick trace through tool setup `0x1406b1920`, hover handling
`0x1406b30c0`, shared selection `0x140698040` and cached-selection update
`0x140697f80`. The tool embeds the selector at `+0xf8` and enables its sketch
selection flag. Its cached owner, child, child index and record index occupy
separate fields. The updater locates the supplied child in the owner's stored
list; it does not derive a child identity from the nearest world coordinate.

The selector resets the child pointer and both indices before decoding the
viewport selection number. In the record namespace beginning at `200000`, it
walks scene iterator order, admits objects through their existing `+0x230`
predicate, queries sketch owners, then walks child and stored-record order.
Record count comes from the child's `+0x170` collection with 80-byte stride.
On a match it stores the child pointer, child index and record index and returns
the owner when sketch selection is enabled. The line hover handler rejects a
sketch with record index `-1` and excludes the line being constructed. The
lower selection namespace has different child/whole-object paths and must not
be interpreted as a stored-record index.

The selection-draw wrapper at `0x140698b30` starts independent child and record
counters at `10000` and `200000`. Its selected call to `0x140ad0390` reaches
`0x140ad0ac0` with the alternate/control-record flags disabled; that branch uses
the stored `+0x170` records. Other flag combinations use different collections.
The drawing helper also has a recursive child branch; nested-group admission
and correspondence to decoded indices remain unverified. Do not flatten nested
groups or substitute control points to manufacture a complete selection model.

Highlighting at `0x140698570` checks the cached record index against the stored
count and transforms its original double XYZ before the final Float32 display
conversion. It does not perform the local Float32 conversion used by click
acquisition. Highlight location, retained pick and resolved nearest point are
therefore distinct values. The general hit-test function `0x1407d6d90` also has
separate provider and scan branches; its selected code is bound, but complete
provider admission and numerical behavior are not established here.

`reference-construction-resolver.ts` now contains the internal
`resolveSketchConstructionPick` branch. An exact ordered snapshot and stable
source/child/record selection produce a detached selection description,
retained Float32 object pick and evaluated primitive. It reuses the acquired
world pick and searches all original ordered records, rather than forcing the
selected child to be the final nearest winner. It rejects ambiguous child IDs,
missing references and invalid indices without inventing replacement records.
Stable application string IDs are an adapter policy, not native viewport
selection numbers; arbitrary existing string identities remain valid.

This is not yet the complete scene resolver. The host must provide genuine
source records at a checked revision and own eligibility, dependency refresh,
locks, cancellation, resource admission and publication. Current Sketch v1
still lacks common child order and retained three-point provenance, so legacy
display geometry cannot be used to fill those gaps. Existing GUI/MCP commands
and schemas are unchanged. The eventual source inventory and construction
operations must use this shared branch together with the acceptance transition
above, history/persistence and native/rendered validation.

Independent verification covers ten selected procedures, 2,953 instruction
starts, 301 direct flows and 19 explicit selection/binding anchors. Two passive
reads match 12,575 selected code/descriptor/exception-metadata bytes per pass and
three vtable/type identities. Some methods span multiple exception fragments;
the selected entry metadata is not a claim about their entire extent. The
decompiler infers a void return for the selector, but the verified instructions
place the selected owner in RAX before the preserved-register epilogue. No
native calls, writes, geometry-buffer reads or UI input were used. Analytic
resolver tests remain separate from native numerical or rendered acceptance.

#### Arc local transformation and collection rebuild

The selected native transform wrapper applies the supplied matrix to internal
A/B/C using X, Y, Z and translation accumulation, then invokes the existing
three-point builder with the stored child frame and current closure. The builder
flattens transformed local Z. This refits a circle through transformed points;
it does not transform the existing kernel edge into an ellipse or change owner
placement. Internal endpoints can differ from source endpoints after closure.

The separate collection wrapper rejects fewer than three records and otherwise
always refits the first three local records with stored placement and closure.
It ignores the fourth record for geometry. Unlike local/placed replacement, it
neither chooses a retained-geometry branch nor clears closure before fitting.

`prepareNativeSketchArcTransform` and
`prepareNativeSketchArcCollectionRebuild` implement these routes through
`SketchConicChild.transformArcLocalPoints` and `rebuildArcRecords`. Canonical
finite input, bounded collections and prepared-arc admission remain application
policy; raw matrix admission does not establish public affine eligibility.
Early-fit failure, backend rejection, exception and cancellation continue to use
the existing staged child ownership rules.

Static corroboration checks 165 instructions, three direct flows and 37 operand
anchors across the two wrappers. This is preserved-image evidence, not fresh
live binding or original-native numerical execution. Twelve analytic cases and
29 grouped real-kernel child checks cover transformation/refit, closure,
collection selection and resource retirement. The full GUI/MCP source model,
solver, history/persistence and native/rendered acceptance remain incomplete.
See `docs/evidence/reference-sketch-arc-edit-routes-20261024.json`.

#### Circle point edits and local transforms

The native circle point editor refits indices 0..2 from internal A/B/C with
stored placement. Index 3 subtracts the old center from the requested X/Y, adds
that delta to the old center and all three defining points, and adds literal
positive zero to their existing Z. Requested center Z is unused. Radius and
placement are retained, source A/B/C/center records regenerate, and the circle
backend is rebuilt without fitting. A failed-fit negative radius is retained by
this translation route; moving its center does not repair an invalid circle.

The local transform wrapper transforms internal A/B/C in X/Y/Z/translation
order and refits using stored placement. The builder flattens local Z and
always issues a backend request, even after failed fitting. Consequently a
collapsed transformed circle retires its previous edge, unlike an arc's early
fit-failure path. Nonuniform scaling refits a circle through the three points;
it does not generate an ellipse. These raw internal matrix semantics do not
establish public transform eligibility.

`prepareNativeSketchCirclePointEdit` and `prepareNativeSketchCircleTransform`
feed the shared child owner's `editCirclePoint` and
`transformCircleLocalPoints`. Circle source A/B/C records currently retain the
same coordinates as the internal defining points; no arc-style closed endpoint
substitution occurs. Fit status is undefined for center translation. Native
invalid indices return false; the application's canonical boundary rejects
invalid indices, nonfinite input and overflow before staged mutation.

The selected two native wrappers contain 263 instructions. Independent static
checks verify their direct flows, selected operand anchors and center-branch
stores preserving frame/radius. Real-kernel checks measure moved/scaled circles,
retire collapsed geometry and test exception/cancellation cleanup. This does not
prove original-native numerical or GUI/MCP acceptance. Circle radius/collection
edit routes and coherent ordered source/editor/history integration remain open.
See `docs/evidence/reference-sketch-circle-edits-20261024.json`.

#### Circle radius edits

The native radius setter uses the magnitude of a negative input. A magnitude
strictly below `2^-23` becomes `0.01`; equality is retained. It subtracts the
stored center from A/B/C and resizes each direction without refitting. A/C use
the normalizer directly. For B, squared length below `2^-52` selects local +Y;
equality and larger values use the normalizer. The normalizer separately compares
length against `2^-52`, so the two guards must not be collapsed. A zero endpoint
direction remains zero while a zero middle direction becomes +Y.

Each new point is direction times radius plus the stored center. Center and frame
are preserved; resizing uses all three coordinates rather than flattening Z. Source A/B/C/center records
regenerate, radius is replaced and the backend receives center/radius even when
the defining points cannot form a valid three-point circle. Radius editing can
therefore rebuild a backend after a failed fit without claiming a successful fit.

`prepareNativeSketchCircleRadiusEdit` and `SketchConicChild.editCircleRadius`
implement this internal operation. Finite radius and intermediate arithmetic are
application admission policy. Static verification checks 161 instructions,
selected operands and constants. An earlier two-read passive metadata capture
establishes the +Y fallback vector; no new live observation or original-native
numerical execution is claimed. Analytic threshold tests and real-kernel radius,
invalid-state recovery and resource-lifetime checks are recorded in
`docs/evidence/reference-sketch-circle-radius-20261024.json`. Shared GUI/MCP
publication, collection edits, history/persistence and native/rendered acceptance
remain required.

#### Circle local record replacement and collection rebuild

The local replacement wrapper compares incoming A/B/C against current internal
defining points using squared XYZ distance. More than three records and all
three distances strictly below `1e-5` select translation. Equality, a failed
comparison or exactly three records selects a refit. Z participates in the
comparison before any fitting flattens it.

Translation subtracts the old center from the fourth incoming record and adds
that XYZ delta to the old center and all defining points. Radius and stored
placement are preserved, source A/B/C/center records regenerate and the backend
is rebuilt without fitting. Unlike individual center editing, local replacement
uses incoming center Z. Unlike arc local replacement, it consumes the fourth
record rather than discarding its coordinates. Adding the computed delta cannot
be replaced by direct center assignment because rounding differs.

The separate collection rebuild wrapper unconditionally refits the first three
records with stored placement; the fourth has no geometric role. Its native
body assumes three available records. The application validates minimum count,
all finite records, resource limits and intermediate arithmetic before mutation.
Native invalid-coordinate handling and application admission are not claimed
identical for malformed input.

`prepareNativeSketchCircleLocalReplacement` and
`prepareNativeSketchCircleCollectionRebuild` feed the shared child's
`replaceLocalCircleRecords` and `rebuildCircleRecords`. Static verification
corroborates 281 instructions, selected branch/arithmetic operands and translation
stores preserving placement/radius. Analytic and real-kernel tests cover the
branch boundary, XYZ movement, failed-fit retirement and exception/cancellation
cleanup. See `docs/evidence/reference-sketch-circle-records-20261024.json`.
Placed-record editing, complete source/session/history integration and original
native numerical/rendered GUI/MCP acceptance remain open.

#### Circle placed-record replacement

The circle's placed-record virtual method compares the supplied world records
against internal A/B/C transformed by the supplied frame. More than three records
and three strict squared distances below `1e-5` select center translation. Exactly
three records, equality or any failed comparison selects refitting.

Both branches subtract frame translation and use the transposed matrix with
Y/X/Z product accumulation to convert world coordinates. Translation converts
the fourth world record, subtracts the old local center, then adds that XYZ delta
to the old center and defining points. It preserves stored placement and radius,
regenerates source records and rebuilds the backend without fitting. Refitting
converts first three records and adopts the supplied placement; the existing
circle builder flattens their local Z. Finite raw matrices here do not authorize
public non-rigid authoring or define a general affine inverse.

`prepareNativeSketchCirclePlacedReplacement` and the child owner's
`replacePlacedCircleRecords` preserve these routes. Translation reuses local
circle replacement with exact prior A/B/C and the converted target, retaining
delta-addition rounding and stored-frame ownership. Canonical input validation,
resource limits and checked intermediates precede staged mutation.

Static vtable inspection identifies the circle slot corresponding to the arc's
placed edit. A focused preserved-image analysis and independent verification
cover 397 instructions, selected comparison/inverse operands and translation
stores that preserve frame/radius. No new live binding or original-native
numerical execution is claimed. Rotated-frame, threshold, inverse-order and
real-kernel center/radius/refit/cleanup checks are recorded in
`docs/evidence/reference-sketch-circle-placed-20261024.json`. Remaining curve
models, shared GUI/MCP source/session/history integration and native/rendered
acceptance remain required.

#### Application staging of retained conic state

The recovered distinction between latest preparation and actual backend state
also constrains application staging. A failed arc fit can retain an older valid
edge, while backend rejection can leave an empty child after earlier success.
`SketchConicChild.fork` keeps the last successful backend request separately,
copies the current edge only when present, and detaches preparation/outcome.
Fresh copies own independent kernel handles and clean up on failure or observed
cancellation. This is application transaction groundwork, not a claim about
native cloning, editor rollback or persistence. Real-kernel evidence is in
`docs/evidence/reference-sketch-child-fork-20261024.json`; the remaining coherent
integration is mapped in `SKETCH_MODEL_INTEGRATION.md`.

#### Application ordered child ownership

`SketchChildCollection` connects current child state to the ordered source-store
contract without reconstructing lost legacy provenance. Its snapshots preserve
owner placement, child placement, source order, unavailable versus empty records,
and complete child diagnostics. Shared construction-pick resolution consumes
these snapshots, including order-sensitive nearest-record ties.

Whole-child replacement validates canonical state and source budgets before
transferring exclusive ownership. Retired children remain alive for caller-owned
history/disposal. Independent collection copies clean up partial copies on
failure; final disposal attempts every owned child's cleanup. These are explicit
application ownership rules, not recovered native transaction semantics. Real
arc/circle checks and generic ownership tests are recorded in
`docs/evidence/reference-sketch-child-collection-20261024.json`. Generic support
for a kind tag is not implementation of its geometry. The remaining editor,
solver, history/project and GUI/MCP requirements are mapped in
`SKETCH_MODEL_INTEGRATION.md`.

#### Application staged child acceptance

The ordered child collection now owns at most one pending replacement. It
validates the hypothetical source store before taking candidates, keeps committed
children intact during preview and checks a collection-local revision and abort
signal before acceptance. Successful acceptance returns prior children alive;
discard, stale access, cancellation and owner disposal retire staged candidates.
Cleanup continues through individual failures. Independent copying excludes
pending changes and preserves the committed revision baseline.

These are application transaction safeguards around recovered child behavior,
not evidence of native preview/rollback policy. They do not decide acceptance of
failed fits or establish public editor, history, persistence or GUI/MCP parity.
See `SKETCH_MODEL_INTEGRATION.md` for the remaining integration boundaries.

#### Ellipse collection and backend implementation

`prepareNativeSketchEllipseCollectionRebuild` implements the selected collection
route. Source clearing precedes fitting. Fewer than three records are copied
without flattening and return an unsuccessful outcome without calling the backend.
Otherwise, only the first three records are used with local Z zero. Diameter
length is compared with 0.0001 inclusively; shorter diameters leave the cleared
sources empty and preserve previous geometry/backend. Unproven initial geometry
is represented as unavailable rather than an invented native constructor value.

For admitted diameters, the center is their midpoint, the authoring axis is the
normalized second-minus-first direction, and the first radius is half the length.
The second radius is computed by projection onto the infinite diameter line,
retaining X/Y/Z numerator and Y/X/Z denominator accumulation. Five child source
records retain the authoring axes. A strictly larger second radius swaps only the
backend radii and rotates its axis clockwise. Equal radii do not swap. Zero
second radius still produces a backend request; no circle-style fit threshold is
introduced.

`SketchEllipseBackend` resets its prior edge before finite kernel construction,
using the supplied center and direction with +Z normal, the ellipse constructor,
ellipse curve builder and edge builder. Its four records use the supplied backend
axis/radii, not the child's source order. Canonical validation is application
policy. Actual kernel errors propagate after retiring the prior edge and cleaning
temporaries. `SketchEllipseChild` retains preparation, outcome and last successful
backend input separately, allowing independent copies of retained geometry after
early failures. Cancellation follows the existing staged conic lifecycle.

Static corroboration covers five selected procedures, 764 instruction starts and
66 direct flows on the preserved image, plus diameter branch/constant checks and
the earlier import bindings. No original-native numerical execution, fresh live
binding, outer acceptance or native file compatibility is claimed. Other ellipse
edit routes and public GUI/MCP authoring remain incomplete.

#### Ellipse source-handle and placed edits

Focused static tracing identifies the ellipse point slot, placed replacement and
the transform-slot regeneration thunk. Independent checks corroborate three
procedures, 445 instruction starts, 37 direct flows, 15 selected branch/division
anchors and five vtable slots. No native code was executed or newly bound live.

Point editing first compares the selected stored source record with the requested
XYZ. Only movement strictly greater than 2^-23 proceeds. Handles 0 and 1 compute
center-minus-target and target-minus-center respectively, admit a radius at least
0.0001, directly divide the components and replace the first radius/axis.
Handles 2 and 3 use the corresponding signed vectors, replace the second radius
and rotate the normalized XY axis while retaining Z. Handle 4 assigns the center
XYZ exactly. Changed geometry regenerates all five sources before the backend
call; a rejected movement or radius leaves state unchanged and returns failure.
No point edit flattens input Z or performs the diameter fit. Missing geometry or
selected records and malformed indices are rejected at the application boundary.

Placed collection replacement clears sources, subtracts supplied-frame translation
and uses the recovered transpose accumulation. Fewer than three inputs produce
converted XYZ records with the previous geometry/frame/backend. Otherwise only
the first three converted XY records enter the diameter fit. A successful fit
adopts the supplied frame; early diameter rejection retains the old frame and
geometry while sources remain empty. Extra records do not select a translation
shortcut. Raw nonrigid arithmetic is retained internally without granting public
affine authoring support.

`SketchEllipseChild.editPoint` and `replacePlacedRecords` use the same backend,
copying, cancellation and ordered staging lifecycle as collection rebuilding.
No-op edits report no backend attempt. The selected transform slot merely calls
geometry regeneration; outer transform behavior remains unproven and is not
implemented as an invented coordinate transform. Remaining routes, native
validity/display, editor/history/persistence and GUI/MCP acceptance remain open.

#### Line replacement state and provider success boundary

Selected line collection, local and placed replacement paths differ. Collection
rebuilding uses the first two XY points, flattens Z and rejects length strictly
below Number.EPSILON, using Y/X accumulation followed by a literal zero addition.
Local replacement uses the first and last full XYZ records, with no identical
coincidence precheck. Placed replacement converts first/last records using the
supplied frame's transpose arithmetic, preserving the observed endpoint-specific
accumulation. Application validation requires enough finite records before these
paths; this does not infer native handling of malformed containers.

The direct zero-offset builder stores supplied placement, endpoint fields and
their midpoint before calling the backend. A backend failure leaves those fields
alongside previous child source records. Success obtains midpoint XY from the
backend, clears endpoint/midpoint Z and publishes exactly two endpoint records.
`src/sketch-line-rebuild.ts` implements this preparation/completion boundary with
detached state, finite arithmetic checks and explicit backend results.

Backend tracing establishes a separate inclusive length threshold of 1e-7. The
backend resets prior geometry, constructs an analytic trimmed line and stores
backend endpoint records before testing a converted body identifier and its first
edge. A historical import binding was matched against the installed second
provider's export and entry bytes. This is static/historical corroboration, not
a new live binding. The native return value cannot be replaced with a check that
an OpenCascade edge merely exists. The replacement backend/body conversion and
midpoint provider remain unimplemented; the pure helper deliberately takes their
actual result rather than fabricating it.

Independent checks cover seven selected procedures, 759 instruction starts,
85 direct flows and nine backend-success anchors plus exact thresholds. Point
edit recovery and outer publication remain separate unresolved routes. No owned
line child, native numerical execution, public worker tool or GUI/MCP authoring
is claimed by this state-only checkpoint.

Additional static tracing of line conversion and midpoint evaluation verifies
five procedures (872 instruction starts and 115 direct flows). The conversion
line branch admits length at 1e-8 and applies a mutable coordinate scale; the
scale's value is not available in the preserved file-backed image. A nonzero
converted body gates midpoint retrieval, which evaluates the stored edge at
fraction 0.5 through `(last - first) * fraction + first`. Extra provider imports
and option meanings remain unresolved. The installed executable's import table
does not supply those runtime-slot bindings, and no new runtime acquisition was
performed. This is static flow evidence, not numerical or backend acceptance.

The subsequent line-edit checkpoint resolves eleven imported calls through
named installed-PE anchors, captured import pointers and DLL export RVAs, then
corroborates them against a bounded passive current-session metadata read. The
line branch calls analytic line creation followed by wire-body construction;
the midpoint path uses an edge adaptor's first/last parameters and evaluation.
Two repeated metadata reads agree on scale 0.001 and reciprocal 1000. This
updates the earlier missing-scale/import evidence without treating a mutable
setting as a universal constant. At that checkpoint provider option meanings
and cross-kernel failure equivalence remained open. No native function calls
or geometry reads were performed.

Subsequent static inspection of the installed geometry provider resolves the
wire-creation options from its own field labels and instruction operands. The
caller supplies tolerance 1e-6 in provider coordinate units, permits disjoint
results, disables general topology, enables checking, requests returned edges
and disables returned source indices. A separate sequential-mode field is
identified; the exact selected enum remains in the private evidence. None of
these findings makes the tolerance a proven minimum admitted line length.

The provider separates analytic-curve creation, interval preparation,
endpoint/topology construction and first-edge lookup. Tracing reaches the
endpoint evaluator and connection preparation, but the complete single-line
degenerate outcome and cross-kernel failure equivalence remain unproven. In
particular, mutable provider tolerances must not be replaced with a guessed
constant or the open-source kernel's defaults.

This checkpoint independently decodes 1,974 direct-flow-reachable wrapper
instructions and checks another 1,293 listed instruction starts and 210 direct
flows from six selected internal procedures. These counts describe static
coverage, not numerical tests. Initial internal function snapshots contained
only an entry instruction; chained unwind ownership ranges and decompiler
basic blocks improve the capture, while unresolved indirect flow remains
explicit. Linear decoding of unwind ranges is not treated as instruction proof
because those ranges can include embedded switch data. Raw decompiler output
and addresses remain private. See
`docs/evidence/reference-sketch-line-wire-provider-20261024.json` for the
sanitized checkpoint. No native execution, DLL loading, live process access or
geometry-buffer reads occurred in this checkpoint.

The conversion-parameter checkpoint implements the recovered line arithmetic in
`prepareNativeSketchLineConversion`, with
`SketchLineCurve.prepareBodyConversion(scale)` supplying actual edge evaluations.
The normalization helper has an inclusive machine-epsilon length guard and
uses reciprocal multiplication after XYZ squared-length accumulation. The
conversion invokes that helper twice, admits source length >= 1e-8, scales the
evaluated first point and scales the saved source length into `[0, length]`.
The supplied scale is explicit; the earlier observed session value is not an
application default. This preserves the rounding difference between one and
two normalizations and between source-length scaling and scaled-endpoint
subtraction. The conversion helper's native true return does not establish
successful provider allocation, reinforcing the separate body/first-edge gate.

Further static checks cover three topology/attachment procedures (969 listed
instruction starts and 223 direct flows), 35 normalization instructions and
19 arithmetic anchors. The topology constructor has separate vertex and curve
attachment checks; its full failure equivalence remains unfinished. The
square-root import is correlated with installed runtime exports and 60 matching
adjacent historical import entries, not a fresh process binding. Eleven new
analytic tests and 18 grouped real-kernel line checks cover the implementation,
including evaluated-coordinate sourcing, exact rounding, signed zero, threshold
equality, overflow, handle retirement and primary-edge preservation. These
checks are not an original-native numerical replay. Evidence:
`docs/evidence/reference-sketch-line-conversion-20261024.json`.

The next static attachment checkpoint follows geometry eligibility, ownership,
existing attachments and actual curve/vertex association. Six decompiled
procedures and one separately decoded attachment helper corroborate 6,773
instruction starts and 1,952 direct flows, with 12 selected call/store/return
anchors. The fresh-curve edge helper writes the geometry/owner links and returns
success on every recovered normal-return path; its only calls prepare metadata
for writing. It contains no floating-point length comparison. This narrowly
rules out that helper as a numerical minimum-length gate, not later wire checks.
The common attachment dispatcher also handles already-owned geometry; those
branches must not be mistaken for the fresh-line path.

Full body acceptance remains unproven. The wire constructor continues through
later repair/check paths and status-dependent cleanup before publication.
Decompiler type and unreachable-block warnings remain explicit limitations;
verified instruction starts and direct flows are not a complete cross-kernel
behavior oracle. No provider code was executed and no application behavior or
GUI/MCP contract changed. Evidence:
`docs/evidence/reference-sketch-line-attachment-20261024.json`.

Further tracing identifies a concrete wire rejection check: two vertex points
overlap when their squared separation is less than or equal to the square of
their summed tolerances. Each vertex without a stored tolerance independently
uses half a runtime resolution setting. The squared distance accumulates Y, X,
then Z; replacing it with a distance calculation changes underflow behavior.
`checkNativeSketchWireVertexSeparation` implements this isolated check using
explicit provider-coordinate points, optional nonnegative vertex tolerances and
an explicit positive resolution. It returns detached comparison diagnostics.
Malformed/nonfinite inputs and arithmetic overflow are rejected at the canonical
application boundary. A false overlap result is not complete body acceptance.

The caller maps overlap failure to a rejected wire status and retires failed
body candidates. A separate later check validates coordinate bounds against
runtime settings and returns a boolean; its decompiler's inferred `void` return
is contradicted by the return instructions and caller test. The resolution and
coordinate-bound settings reside in virtual data absent from the installed
file's stored bytes; this checkpoint does not guess their values. Shared-checker
tail calls are retained as separate function ranges. Exact edge-validation
outcomes, runtime settings and complete body/first-edge behavior remain required.
Evidence: `docs/evidence/reference-sketch-wire-vertex-separation-20261024.json`.

The earlier edge endpoint comparison differs from that final wire check. For
two distinct vertex objects, it first replaces each XYZ coordinate difference
whose absolute value is strictly below a runtime threshold with zero. Equality
at that threshold is retained. It then uses the same inclusive Y-X-Z squared
separation and summed-tolerance comparison. The separate
`checkNativeSketchDistinctEdgeVertexSeparation` helper implements this branch;
the final wire helper keeps its unclamped behavior. A shared vertex object takes
a different topology branch, which is not represented by these point records.

A fresh, read-only capture verified the process creation identity, executable
hash, mapped provider path/import and selected code prefixes before reading
fixed scalar settings twice. It observed resolution `1e-8`, delta-zero threshold
`1e-18`, coordinate envelope `1000.0000000000001` and relative comparison tolerance
`1.5987211554602254e-14`, in the provider's units where applicable. Application
scale was `0.001` and its reciprocal `1000`. These are observations from that
verified session, not universal defaults; both helpers still require explicit
settings. No native functions were called and no geometry buffers were read. The capture
does not constitute a native numerical comparison of constructed geometry.
The remaining curve/endpoint validity checks and complete body publication are
still open. Evidence:
`docs/evidence/reference-sketch-edge-vertex-separation-20261024.json`.

Fresh topology tracing now corroborates the type-specific initialization of
edge and vertex tolerances to the unset sentinel. The open-line constructor
allocates a distinct second vertex and reciprocal edge uses. Static startup
registration binds the relevant initializer slots; this is not a live dispatch
table snapshot or proof that all subsequent metadata operations succeed.

The ordinary analytic-line endpoint check projects onto the infinite line using
the prepared direction without renormalization. It forms the projection
parameter in Y-X-Z dot-product order, zeros each residual strictly below the
delta-zero threshold, and accepts squared Y-X-Z distance <= squared tolerance.
Nonpositive effective tolerance rejects even an on-line point. An unset native
tolerance resolves through a separate per-thread array; it must not be replaced
with the previously captured linear resolution. The recovered return is boolean
despite an inferred void decompiler signature.

`projectNativeSketchLinePoint` implements this isolated calculation with explicit
effective tolerance and threshold, detached projected coordinates/parameter,
and canonical malformed/nonfinite/overflow rejection. Tests cover equality on
all residual axes, squared underflow, nonpositive tolerance, direction rounding,
conversion parameters, reversal and input ownership. This helper does not check
the trimmed interval or establish body/first-edge validity. Effective native
thread tolerance, interval validation, bounds and full body outcomes remain
integration requirements. Evidence:
`docs/evidence/reference-sketch-line-projection-20261024.json`.

The subsequent parameter-order checker classifies a straight line as
nonperiodic. Its ordinary path requires `(last - first) * orientation > 0`,
where the fresh line's orientation is forward (`+1`), and reverse uses `-1`.
Equal parameters fail; this particular comparison adds no minimum span.
The error path reports invalid parameter ordering through a protected-call
wrapper. Its callback's return value alone is not the wrapper's result.
Reentrancy guards and unset-parameter recovery remain surrounding concerns.

`checkNativeSketchLineParameterOrder` now implements the isolated comparison
with explicit finite parameters and boolean orientation. It returns the signed
oriented span and whether it is positive; malformed values and canonical
arithmetic overflow throw. Tests retain signed zero, subnormal positive spans,
adjacent large parameters, reverse orientation and wrong-order rejection.
The coordinate-bounds dispatcher is traced to its edge-specific calculation,
which still needs recovery before complete body acceptance can be implemented.
Evidence: `docs/evidence/reference-sketch-line-parameter-order-20261024.json`.

The fresh/default line branch of that edge calculator now has corroborated
instruction and call-flow evidence. When two attached vertex points are present
and the edge has its default tolerance, a line initializes six min/max bounds
from the first vertex and merges the second. Strict extrema comparisons retain
the first coordinate on ties, including signed zero. If the initialized X
maximum equals the static unset sentinel, the merge replaces all six bounds
with the second point. Other axes do not trigger that empty-box path. The native
calculator then publishes a cached box; cache hits and other edge cases have
separate paths.

`prepareNativeSketchLineVertexBounds` implements this isolated fresh-line
calculation from actual vertex coordinates, returning detached minimum/maximum
XYZ tuples. It does not project/sample endpoints, expand by tolerance, update a
cache or admit a body. Tests cover all axes, equality, reversed vertices, signed
zero ties, the asymmetric unset-box branch, extreme finite coordinates, input
validation and independent output ownership. Final coordinate-envelope
comparison, cache lifecycle and complete body/first-edge outcomes remain open.
Evidence: `docs/evidence/reference-sketch-line-vertex-bounds-20261024.json`.

The scalar coordinate-envelope comparison is now recovered and implemented as
`checkNativeSketchLineBoundsEnvelope`. It takes a canonical minimum/maximum box,
an explicit positive coordinate envelope and explicit nonnegative relative
tolerance. The signed limit is half the envelope. Bounds are checked in native
X minimum/maximum, Y minimum/maximum, Z minimum/maximum order. Boundary equality
passes. For a finite coordinate outside its signed limit, the recovered path
accepts `abs(1 - boundary / coordinate) <= relativeTolerance`; replacing that
with absolute distance divided by the boundary changes the result.

The helper returns the half extent and either an inside result or detached
first-failure axis/side/coordinate/relative-difference diagnostics. Tests cover
all six sides, exact relative equality, the following representable residual,
signed-zero/half-envelope underflow, large finite coordinates, explicit
historical-setting analytic fixtures, input ownership and canonical validation.
The original checker repeats this comparison while traversing body edges and
returns a boolean in AL despite an inferred void decompiler signature. Complete
body iteration, unavailable boxes, cache/metadata errors and publication remain
outside this isolated comparison. Evidence:
`docs/evidence/reference-sketch-line-envelope-20261024.json`.

Provider endpoint evaluation now has a corroborated line-specific dispatch and
evaluator. Each XYZ result is prepared direction times parameter plus origin,
using separate multiplication and addition. It performs those operations even
at parameter zero, which can change the origin's signed zero. The router rejects
its unset-parameter sentinel. The prepared direction is not normalized again
and this infinite-line evaluation does not clamp to a trimmed interval.

`evaluateNativeSketchLinePoint` implements that arithmetic and is now used by
the real `SketchLineCurve.prepareBodyEndpoints` method. The method first queries
the actual primary edge through the existing conversion path, then returns
detached conversion/start/end data in provider coordinates. It preserves primary
geometry and retires query handles on evaluation or overflow failure. This
supplies endpoint data for wire construction; it does not allocate or authorize
a converted body or first edge. The existing native topology/bounds traces also
show that the line box initializes from the forward edge-use vertex, which is
the line's end vertex; future composition must preserve that order on ties.

Analytic tests include independently calculated binary64 endpoint values that
differ from scaled input coordinates. Actual kernel checks exercise controlled
edge evaluations, invalid scales, failure cleanup, detached data, disposal and
repeated rebuild/query retirement. Derivative buffers, full body admission and
native numerical/rendered comparison remain unfinished. Evidence:
`docs/evidence/reference-sketch-line-endpoints-20261024.json`.

`SketchLineWireCandidate` now owns a real converted analytic wire and a separately
owned first-edge handle. Its factory consumes detached prepared endpoint data
and an explicit requested topology tolerance in the same provider units.
Canonical mismatches reject before kernel allocation. A nonpositive forward
interval produces no candidate. Construction uses explicit vertex points and
parameters, checks the real wire with the kernel analyzer, and obtains its first
edge through topology exploration. Temporary handles retire before ownership is
returned; partial failure and cleanup errors retire every remaining candidate
handle. Disposal attempts both owned handles and reports aggregated causes.

A binding probe found that the high-level edge maker rejects a roughly 50 nm
interval even with smaller supplied vertex tolerances. The lower-level builder
creates and validates that interval with its distinct vertices intact, avoiding
an extra application minimum. OpenCascade reports a larger vertex-tolerance
floor in the pinned runtime. The snapshot therefore records **requested**
tolerance; native semantic checks must keep their own explicit tolerances.
The candidate's kernel validity and first edge do not establish original-native
body admission. Kernel direction normalization and tolerance behavior remain
separate numerical-comparison concerns.

Actual kernel tests verify exact stored endpoint coordinates, reversed/3D lines,
signed-zero vertex data, parameter bounds, short intervals, detached requests,
zero/invalid tolerances, partial build/query failures, aggregated cleanup,
independent owners and repeated retirement. The shared worker exports this
internal owner without a new public RPC or GUI action. Evidence:
`docs/evidence/reference-sketch-line-wire-candidate-20261024.json`.

The recovered scalar checks are now composed by
`checkNativeSketchFreshLineGeometry` for a fresh forward single line with two
distinct vertex objects and default vertex tolerances. It requires explicit
linear resolution, delta-zero threshold, endpoint tolerance, coordinate envelope
and relative comparison tolerance. Endpoint tolerance remains independent of
resolution. It checks distinct-edge separation, start/end projection, parameter
order, final vertex overlap and then envelope, returning detached diagnostics
and the first failing stage. This single-edge scope has no distinct-edge pairs.
The box uses actual end/start vertex data in native order, not projected points.

`SketchLineWireCandidate.createChecked` now runs this shared sequence before
allocating a wire, using half the explicit resolution as requested topology
tolerance. Its result distinguishes geometry rejection, kernel rejection and a
constructed candidate. `SketchLineCurve.prepareBodyCandidate` connects actual
primary-edge queries to that path; invalid settings reject before queries, and
the returned candidate belongs to the caller. Prepared-data validation is shared
with raw candidate construction to avoid separate parser behavior.

Unit and actual kernel tests verify stage priority, independent settings,
end-first signed-zero ties, detached data, no wire allocation on rejection,
short-line construction and kernel failure after passed scalar checks. These
results cover fresh-line scalar geometry and resource construction. Original
global/reentrancy state, metadata/recovery/status handling, complete body/child
acceptance and original-native numerical/rendered comparison remain open.
Evidence: `docs/evidence/reference-sketch-line-geometry-gate-20261024.json`.

Point editing and affine transformation are statically corroborated across two
procedures, 163 instruction starts, 11 direct flows and 12 selected recovery
anchors. Handles 0/1 admit candidate XYZ length >= 0.0001 and request rebuilding
even if the handle did not move. On failure, two saved copies of old start are
passed to the recovery build. The method then returns true independently of
the build outcomes. `prepareNativeSketchLinePointEdit` retains that recovery
input; `prepareNativeSketchLinePointRecovery` computes it only on request.
Application input validation rejects invalid handle indices before preparation.

`prepareNativeSketchLineTransform` applies the supplied raw 3x4 matrix to both
internal XYZ endpoints while retaining stored placement. There is no collection
or point-edit length precheck on this route. Both routes use the same proposed
state/backend-completion boundary. Concrete body creation, owned child execution,
cache invalidation, public GUI/MCP editing and original-native numerical
acceptance remain unfinished.

The primary line curve stage is now implemented in `SketchLineCurve`. Its
finite length admission, XYZ request, directed trimmed interval and normalized
adaptor evaluation are kept separate from native converted-body success. The
bundled kernel's `gp_Lin` and parameter-bound segment maker provide owned
transient geometry without directly deleting objects retained by curve handles.
The pinned upstream [segment implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/33d9a6fa21ca4fa711da7066655aa2ba854545ee/src/GC/GC_MakeSegment.cxx)
and [constructor declarations](https://github.com/Open-Cascade-SAS/OCCT/blob/33d9a6fa21ca4fa711da7066655aa2ba854545ee/src/GC/GC_MakeSegment.hxx)
establish that the selected overload creates a line trimmed to supplied bounds.
This source reference supports the bundled-kernel construction path, not native
provider equivalence.

Actual kernel tests cover 3D endpoints/line type/parameter range, fraction
clamping, retained malformed-input geometry, reset on short/overflowing geometry,
inclusive constructor admission, detached request state, independent disposal,
query/build/cleanup exceptions and repeated handle retirement. No `builderSucceeded`
result is fabricated from primary curve creation. Converted body creation,
first-edge validation, native numerical comparison and public GUI/MCP line
authoring remain required.

### Internal definition storage

The [definition storage checkpoint](evidence/reference-construction-definition-20261023.json)
adds the version-1 codec in `reference-construction.ts`. Its established core
represents point coordinates/center/pair/threePlanes and line
endpoints/pair/average. Typed coordinates use Float64 little-endian bits;
retained line picks use exactly twelve Float32 bytes. Both survive JSON with
signed zero and subnormals intact. Canonical pick copies reject values requiring
rounding; coordinate acquisition must own any later quantization explicitly.

Common sources remain distinct, raw-key sorted identities. Line records retain
order and duplicates, including identities absent from the common set. Empty or
extra retained containers are preserved because their evaluator outcomes differ;
the codec does not invent GUI admission rules. Numeric modes retain inactive
containers rather than clearing them. Unknown versions/fields, conflicting
identities and invalid numeric encodings are rejected without source lookup.

The storage tag `native-pick-record-f32` states precision, not coordinate space.
Picked point/endpoint provenance, exact subfeatures and unresolved point fields
are not represented as guessed options. The codec is an internal dependency;
project/history wiring, separate evaluated geometry/state and the complete
shared GUI/MCP workflow remain required. The 49 codec tests and 203-test focused
run establish analytic storage behavior, not native save/reopen or rendered
acceptance. No new construction operation is advertised.

### Application boundaries

Before implementation, the affected boundaries are:

| Boundary                | Current state                                                                                                                       | Required coherent change                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ribbon/dialog           | `referenceLine` and `referencePoint` are planned entries in `src/ui/ribbon-model.ts`.                                               | Enable a dialog only with its shared operation, all supported modes, preview/cancel behavior and visible validation.                                                                        |
| Shared executor         | No persistent reference-construction operation exists.                                                                              | Resolve inputs at the requested revision, calculate through one shared implementation, and publish accepted results atomically with normal history and retry protection.                    |
| MCP discovery/schema    | No creation tool is advertised.                                                                                                     | Add discoverable creation/preview/apply operations as appropriate, exposing modes, object references, XYZ, millimeter lengths, diagnostics and failures. Do not advertise unfinished modes. |
| Persistent geometry     | Internal reference-point/line kinds and semantic persistence foundations exist; public construction/import admission remains gated. | Complete source resolution and publication using these semantic values, preserving serialization, digest, inspection and restore behavior.                                                  |
| Rendering and selection | Existing entities assume scan, CAD or fitted primitive display.                                                                     | Render/pick the point or finite line while preserving semantic coordinates and agent access to the same state.                                                                              |
| Datum transformation    | `DatumPrimitive` already supports point/line numerical transforms; `datumFeatureMetadata` currently maps fits and plane frames.     | Extend entity integration without changing the recovered numerical transform order.                                                                                                         |
| Alignment references    | `alignment_references` exposes CAD faces and fitted primitives.                                                                     | Expose new semantic references through stable IDs and the existing shared reference consumer.                                                                                               |
| Other consumers         | The native objects support subsequent construction and patterns.                                                                    | Audit eligibility, transforms, dependencies, duplication/deletion and export semantics; fail unsupported operations explicitly.                                                             |
| Documentation           | Agent schemas and usage live in `docs/AGENT_GUIDE.md`; architecture in `docs/MCP_ARCHITECTURE.md`.                                  | Update both with the implemented contract and recovery behavior in the same change.                                                                                                         |

The eventual tests must cover native numerical comparisons, each construction
mode and failure case, public MCP contract access, revision/retry/cancellation,
history and project round trips, and a rendered GUI/MCP comparison on the same
geometry. Source immutability and resource cleanup are required across failed or
cancelled previews. Static labels and unit tests alone cannot close acceptance.

The shared datum calculation has been refactored without an intended behavior or
MCP schema change. Reference-point/line creation remains unavailable through both
the GUI and MCP. Current rendered application acceptance remains outstanding.

The normal-return wire validation disposition is now explicit in the shared
`resolveNativeSketchWireValidation` helper. It accepts incoming status 0 or 6
and supplied general-check results. General success requires an explicit bounds
result; general failure requires the explicit version-sensitive promotion result.
General results 5/6 map to status 5, result 13 maps to 7, other failures from 0
map to 4, and incoming 6 survives other failures unless promotion applies.
Bounds failure always maps to 4. No version setting or checker result is guessed.
`SketchLineWireCandidate.applyValidationResult` applies this mapping to actual
ownership: status 0/6 retains wire and first edge; other statuses dispose both.
Malformed results preserve resources; retirement attempts both handles even if
cleanup throws. Retention is not native backend success, and these supplied
results do not replace the unfinished topology/metadata/reentrancy checks or
protected error paths. Shared GUI/MCP publication remains gated on that work.
Evidence: `docs/evidence/reference-sketch-wire-disposition-20261024.json`.

`SketchLineChild` now executes the recovered line state helpers through an
explicit full-backend result contract. Collection rebuild, local and placed
replacement, raw local transform and point edits share one attempt lifecycle.
Source records are replaced only after backend success and a finite midpoint;
failed attempts retain proposed XYZ fields and previous source records. Point
admission remains separate from builder success. A false point build lazily
executes the recovered old-start/old-start recovery; exceptions do not enter that
boolean-failure route. Snapshots and backend requests are detached. Pre-abort
preserves the child; post-work abort retires staged ownership and retains cleanup
errors. Disposal during a callback cannot republish state.

This worker-local child takes supplied initial state and an owned backend. It
has no production full-body adapter, fork/cache/display-validity protocol or
public editor operation yet. Kernel tests deliberately leave complete native
admission unavailable while exercising actual primary/candidate retirement and
100 lifecycle cycles. Successful state publication is checked with controlled
backend results only. Neither an edge nor a checked wire fabricates backend
success. This is an internal shared lifecycle checkpoint, with no GUI-only or
new advertised MCP operation. Native protected exception transfer, full backend
admission, ordered-child staging/persistence and GUI/MCP acceptance remain open.
Evidence: `docs/evidence/reference-sketch-line-child-20261024.json`.

`SketchLineBackendDraft` now owns the primary edge and converted-wire candidate
as distinct resources. A shared canonical request parser validates before reset.
Reset clears kind/records, retires primary geometry, then retires candidate
handles, attempting both even after cleanup failure. Normal conversion failure
retains the newly constructed primary and its two XYZ records; a rejected
primary retains neither. A thrown conversion query retains the primary but
leaves records/kind unpublished. Draft midpoint queries return positive zeros
when no candidate body exists and otherwise evaluate the primary at one half.

The draft reports pending validation, explicit validation retention/rejection
and application errors. Supplied validation can retire a body while preserving
the primary and backend records. Malformed inputs preserve previous resources;
snapshots are detached. It does not return a native accepted/builder-success
flag and is not the production full-admission adapter for `SketchLineChild`.
Full provider checks, native protected exception transfer and shared GUI/MCP
publication remain required. This is a worker-local shared resource owner,
with no GUI-only behavior or newly advertised public operation.
Evidence: `docs/evidence/reference-sketch-line-backend-draft-20261024.json`.

Fresh-line scalar failures now include a detached `nativeFailurePath` diagnostic.
It describes the selected normal-return path with earlier checks passed and
incoming wire status zero: endpoint overlap is edge 2/general 3/wire 4;
projection failure is edge 3/general 12/wire 4; parameter-order failure is edge
4/general 12/wire 4. Final wire overlap propagates general 13/wire 7, and bounds
failure after general success propagates general 1/wire 4. Passed scalar checks
carry no failure path or inferred native accepted/whole-run status. The draft
owner exposes this information through its existing detached checks snapshot.

Additional static tracing resolves the auxiliary query's omitted caller
argument: the body is supplied directly. Its lookup uses attached body metadata
and can inspect an additional body-specific fallback. An empty auxiliary list
has not been inferred. Fresh body allocation
and attribute attachment/copy still need corroboration before full acceptance.
Initial analyzer captures listed only one instruction per auxiliary entry;
independent PE-unwind-owned decoding verifies the selected query's 107 starts.
Six selected procedures total 6,056 starts and 1,288 direct flows, with 42
result/argument anchors and three independently resolved edge dispatch entries.
Other indirect general-checker sites and full protected error/reentrancy paths
remain explicit limitations. No original-native execution or geometry reads.

This diagnostic change is internal shared geometry behavior, with no GUI-only
feature or new public operation. Complete backend admission, shared editor and
GUI/MCP/document lifecycle validation remain required. Evidence:
`docs/evidence/reference-sketch-line-failure-path-20261024.json`.

Fresh body initialization is now corroborated separately from the later
validation state. The allocator selects the registered body initializer; that
initializer clears the attribute container, auxiliary fallback and topology
containers. Its registration entry is reached from the provider startup path.
The selected body-ownership attachment branch directly updates ownership and
list links without storing either auxiliary-metadata field.

This does not close the admission gate. Creation mode also has conditional
post-initializer callbacks, and creation finalization can enter notification
processing. Their configuration and transitive effects remain unverified.
Initializer defaults therefore cannot establish empty metadata at the later
auxiliary query. Callback effects, subsequent topology/geometry attachment,
complete protected errors and original-native numerical acceptance still need
proof before the draft can become a successful production backend.

Independent decoding covers 12 selected procedures, 7,018 instruction starts,
381 direct flows and 42 initialization/registration/notification anchors. It
also corroborates all 584 analyzer-listed starts for the three newly selected
constructor/initializer/ownership procedures. A registration leaf is bounded
by its actual startup call, direct traversal, return and following padding;
its initializer store is independently resolved. The allocator's unrelated
indirect selector remains explicit and the finalizer tail is separately owned.
No runtime implementation or public MCP contract changes at this checkpoint;
the previously tested build remains byte-identical. Evidence:
`docs/evidence/reference-sketch-line-body-defaults-20261024.json`.

Creation-hook tracing now separates watch configuration from notification
bookkeeping. Named class-watch registration configures per-class creation
callbacks; item/tag-watch routes configure tag-watch callbacks. Under the
previously anchored provider mapping, the preserved application image has no
captured pointer binding matching those API entries. This is a bounded negative
observation: a dynamically requested API pointer could have been released or
stored outside that image, so watch configuration is still unproven.

The selected notification route directly records entity identifiers and event
bookkeeping in notification-owned lists. Its entity-state helper writes one
notification header byte; the entity identifier getter only reads header data.
An optional path copies header bookkeeping into another list through separately
decoded integer insertion. These direct effects do not write the auxiliary
metadata pointers. Arbitrary registered callbacks and transitive allocator,
copy-on-write and protected error effects remain outside that conclusion.
No empty-metadata or whole-native accepted result is inferred.

Independent checks cover 13 selected procedures, 2,152 starts, 463 direct flows,
25 selected anchors, seven callback-slot stores and three named API owners.
All 660 analyzer-listed starts for the two configurators and notification
procedure are corroborated against original bytes and direct targets. Bounded
leaf returns/padding and a separately owned list-error tail remain explicit.
This is a static evidence checkpoint; runtime implementation and public MCP
contracts are unchanged. Evidence:
`docs/evidence/reference-sketch-line-creation-hooks-20261024.json`.

### Self-connection candidate comparison

The shared `checkNativeSketchWireSelfConnection` scalar helper now preserves
the recovered three strict comparisons. Endpoint squared distance must be
less than an explicitly supplied squared threshold before querying a witness.
The witness must then be strictly farther than that threshold from each
endpoint. Distances accumulate Y, X, then Z without coordinate clamping;
equality fails the candidate test. A short straight line therefore does not
become a loop merely because its endpoints are nearby.

Inputs and results are detached finite XYZ values. The caller supplies a lazy
witness sampler; the helper does not substitute a midpoint or assume a native
sampling policy. It skips sampling for separated endpoints and skips the
second distance comparison after the first witness comparison fails. Reached
nonfinite arithmetic throws an application error; this finite-value guard is
not a recovered native error status.

Static checks revalidated 3,421 instruction starts across six selected scopes
and 26 anchors. The parameter resolver still contains an unresolved indirect
switch. Complete sample selection, connection-record processing, short-wire
topology and whole-body acceptance remain open. No native accepted result is
inferred from this helper. Evidence:
`docs/evidence/reference-sketch-self-connection-20261024.json`.

### Known-parameter straight-line witness

The straight-line branch is now resolved for prepared analytic lines whose
endpoint parameters are already known. The point records retain their supplied
parameters, the parameter cache returns without projection, and the line's
nonperiodic classification leaves those values unchanged. The witness uses
`(lastParameter + firstParameter) * 0.5`, then the existing analytic evaluation
`direction * parameter + origin`. Averaging endpoint coordinates can produce
different rounded values and is not substituted.

`checkNativeSketchLineSelfConnection` composes that sampling rule with the
strict scalar comparison. `SketchLineWireCandidate.checkSelfConnection`
exposes the same diagnostic for its retained prepared data, rejects use after
disposal, and does not allocate kernel handles or change topology/ownership.
The comparison threshold remains an explicit squared value. Invalid native
unset endpoint coordinates are rejected if sampling is reached; malformed,
nonfinite and overflow handling remains an application boundary, not complete
native status translation.

Two selected line dispatch tables, the unset sentinel and half constant are
bound to original bytes. The verifier rechecks 3,638 distinct instruction starts
and 34 selected anchors; the earlier analytic evaluator check is also rerun
with fresh output (219 listed starts across three scopes and 22 anchors).
Unresolved indirect cases remain outside the selected known-parameter line
path. Unset-parameter recovery, other curve kinds, downstream connection graph
processing and complete body admission are not established. Evidence:
`docs/evidence/reference-sketch-line-witness-20261024.json`.

The real-kernel fixture also distinguishes the retained converted interval from
the nominal source midpoint scaled afterward: its witness parameter is
`2.5000000000000002e-8`, rather than `2.5e-8`. The initial fixture expectation
failed on that bit and was corrected without changing the recovered arithmetic.

### Early analytic line input interval

Before connection collection, the native known-parameter analytic line path
checks `firstParameter - lastParameter`. Its absolute value must be strictly
greater than a separate runtime parameter-zero threshold, and the difference
must be negative. Equality, reversal or a span within that threshold produces
status 3 on the selected normal-return diagnostic path, starting from status 0.
This differs from the later projected-parameter ordering check, which only
tests a strictly positive oriented span.

`checkNativeSketchLineInputInterval` preserves this subtraction/comparison order
and requires an explicit finite nonnegative threshold. A retained wire
candidate exposes the same read-only diagnostic through `checkInputInterval`.
No threshold is inferred from linear resolution, endpoint/vertex tolerance or
the connection tolerance. Its referenced runtime storage is not backed by
original PE file bytes; a current value has not been established. Unset
parameters and nonfinite/overflow inputs are rejected at the application
boundary rather than assigned a fabricated native whole-run result.

The selected partial-line dispatch evaluates the supplied endpoints; the
separate full-range line dispatch reports an input error. The connection-list
caller skips graph processing for an empty list and later wraps an ordinary
line interval before its edge builder. These selected branches do not establish
the full no-connection topology path or complete body admission.

The static decompiler job expired without producing an evidence result and
retired all owned children. Direct byte/dispatch checks provide the retained
evidence instead. No successful decompiler, native execution or live setting
capture is claimed. Evidence:
`docs/evidence/reference-sketch-line-input-interval-20261024.json`.

Independent direct verification covers 4,434 distinct instruction starts,
31 selected anchors and three line dispatch tables. The unbound runtime
threshold remains a required input, not an inferred constant.

### Angular-precision identity and coupled envelope

The earlier parameter threshold is now traced to the provider's session
angular-precision setting. Two selected numeric-profile initialization routines write
`1e-11`. A named session setter reaches the same runtime store; for finite
values its scalar bounds are inclusive `1e-11` through `1e-5`, with an
additional constraint comparing the current per-thread endpoint tolerance to
`(runtimeBound * 0.1) * requestedAngularPrecision` in that order. Diagnostic
exceptions and all context/lifecycle effects remain outside this selected-path
statement.

On the selected successful setter path, the coordinate envelope is updated to
`endpointTolerance / angularPrecision`, before subsequent ratio multipliers.
For the explicit fixture `endpointTolerance = 1e-8` and
`angularPrecision = 1e-11`, that produces `1000.0000000000001` (binary64 bits
`408f400000000001`), consistent with the earlier recorded envelope. This is a
static-derived fixture, not a new native execution or current-session capture.

The initialization value must not silently become a universal helper default:
the setter mutates it, and another context-field route also calls the setter.
The existing scalar diagnostics therefore retain explicit threshold inputs.
Their nonnegative arithmetic test domain does not constitute native setting
admission; the native setter's own finite bounds and coupled constraint are
separate requirements.

Direct verification covers 2,983 distinct instruction starts, 24 selected
anchors, three reached writer stores, nine selected constants and two named
session API owners. Candidate discovery searched selected legacy RIP-memory
opcodes in executable PE sections; it is not an exhaustive inventory of
indirect, pointer-based or other instruction-family writes. The current
application session value and complete topology/body admission remain
unproven. Evidence:
`docs/evidence/reference-sketch-angular-precision-20261024.json`.

### Interval wrapper and converted direction fidelity

The selected native interval-wrapper body directly stores the supplied curve
pointer, both endpoint XYZ values and both parameters. Direct verification
covers all 94 reached instruction starts and 17 data-flow anchors, with no
unresolved direct flow. Allocator and copy-on-write transitive effects remain
outside that conclusion.

Own-kernel differential checking found that another direction normalization
changed retained curve/endpoint bits. The baseline retained 12 counterexamples
from 100 deterministic fixtures (the diagnostic record limit was 12; this is
not a measured mismatch rate). The shared candidate now uses a checked binding
adapter to preserve the already prepared direction on its newly owned kernel
object. All 100 fixtures match direction, origin and endpoint bits after the
correction; binding failure/rollback/cleanup branches are also checked.

The adapter's ownership, layout and kernel-upgrade requirements are documented
in [CAD direction fidelity](CAD_DIRECTION_FIDELITY.md). The vendor WASM remains
unchanged. This correction does not authorize native body acceptance or complete
the no-connection topology/editor path. Evidence:
`docs/evidence/reference-sketch-direction-fidelity-20261024.json`.

### Selected no-neighbor open-edge structure

For the ordinary-line caller branch with null neighbors, no existing vertices,
a usable incoming status and a one-edge count, the selected flags request
forward construction without a closing-edge decrement. The start constructor
allocates a vertex; the edge constructor allocates a separate end vertex, one
edge and reciprocal directed edge records. Its endpoint attachment helper
connects the old start and new end to those reciprocal directions. Direct
verification covers five procedures, 3,402 distinct instruction starts and
50 selected anchors. Full original-command reachability and transitive
allocator/copy-on-write/notification/geometry-status effects remain open.

`tests/kernel-line-open-topology-smoke.mjs` checks the corresponding shared
candidate structure: exactly one edge, two distinct underlying vertex identities,
forward/reversed endpoint orientation, exact prepared XYZ values and interval,
an open edge/wire and a valid kernel shape. Six fixtures include `2e-8`/`5e-8`
provider-unit spans, reversed coordinates, signed zeros and a rotated
line; 100 replacement/retirement cycles repeat these checks. A too-short checked
candidate remains rejected while its primary curve survives.

The fixture explicitly separates requested semantic tolerance `5e-9` from the
bundled kernel's reported vertex tolerance `1e-7`. Two vertex occurrences alone
would not prove distinct topology; the smoke tests underlying identity as well.
These results do not establish connected-wire merging, closed-profile validity
or whole original-native body admission. Evidence:
`docs/evidence/reference-sketch-open-topology-20261024.json`.

### Selected line attachment return disposition

For the ordinary nonclosing builder branch starting with wire status zero,
the point attachments continue only on status `1`. The range stage continues
on `1` or `5`; the curve attachment continues only on `1`. A normally returned
curve-attachment `5` maps to wire status `1`; other failures on these selected
paths map to `4`. A continuing event assigns no final accepted wire status.
Independent byte checks cover 2,054 distinct instruction starts, 34 selected
anchors and two dispatch tables. Diagnostic transfers, exceptions and the
complete physical attachment dispatcher remain outside that conditional proof.

The common worker implements this disposition in `sketch-wire-attachment.ts`.
Its candidate and draft retire both wire and first-edge handles on rejection,
while retaining the primary curve, line kind and original source records.
Malformed events preserve state; attachment events after validation are rejected
by the draft. Cleanup failures preserve their causes and still retire the wire.

Seven real-kernel test groups, including 100 retirement cycles, exercise supplied
controlled attachment events. They do not record original-native return values
or establish whole-body acceptance. Earlier physical-attachment evidence remains
in `reference-sketch-line-attachment-20261024.json`; this checkpoint adds caller
disposition and resource ownership behavior rather than replacing that proof.
Evidence: `docs/evidence/reference-sketch-attachment-disposition-20261024.json`.

### Fresh line ownership initialization

The selected line-type initializer is now bound to its startup registration.
It explicitly clears ownership and dependency-list fields and writes unset
coordinate sentinels. Independent checks cover 200 instruction starts across
the registration leaf and initializer, plus the startup call and 11 selected
initializer anchors. Its only direct call target is metadata write preparation.

These are initialization facts. They do not prove that allocation callbacks or
later construction leave those fields empty at attachment time. The earlier
physical-attachment success path therefore still requires that precondition;
full admission is not inferred from zeroed fields. This static check changes no
runtime settings or public GUI/MCP operation. Evidence:
`docs/evidence/reference-sketch-line-initializer-20261024.json`.

### Line creation before edge attachment

The bound line-creation API calls the selected constructor with creation mode
two. That constructor allocates the line type, directly copies origin/direction
coordinates, and invokes a post-creation mode-ten path. The selected line branch
bypasses the first type switch; the mode-ten continuation invokes an additional
bookkeeping helper with code nine before further class-gated work.

The API then invokes context ownership association. Its selected geometry
branch depends on a runtime class flag and calls the attachment wrapper with
flags three. The class table is not file-backed, so static file evidence does
not establish that flag's current value or the resulting owner. In particular,
the initializer's cleared ownership field must not be carried forward as an
assumed attachment-time invariant. Post-creation helpers, creation callbacks
and later association must be accounted for in complete admission.

Independent checks cover 1,153 distinct instruction starts, 34 selected anchors
and one selected dispatch-table entry. The full parent switch and transitive
effects are not established. This static checkpoint changes no application or
MCP behavior. Evidence:
`docs/evidence/reference-sketch-line-creation-provenance-20261024.json`.

### Selected post-creation cache bookkeeping

The selected post-creation code-nine helper can remove matching entity-cache
records, clear their slots and release cached allocations. Its direct stores
affect cache slots and local retirement lists rather than the input line's
geometry fields. Context lookup, cache enablement and class flags gate that
work; their active values remain unbound. Deallocator and other transitive
effects are not inferred from the direct stores alone.

For mode ten, the selected bit test skips the intermediate helper. A later
class-gated helper queries a typed attribute and can issue a diagnostic; another
returns early for the ordinary line type. Independent byte checks cover 337
distinct starts and 25 anchors across these procedures and the selected caller
continuation. This narrows the post-creation gap without establishing whole
native admission. Evidence:
`docs/evidence/reference-sketch-line-collection-20261024.json`.

The internal projected-candidate selector now returns only the winning original
index. It preserves Float32 pick/sentinel arithmetic, the finite FLT_MAX
squared-distance bound and strict first-tie ordering. It never reads axis
parameters or retries by geometric eligibility. The earlier unpublished CAD
composition combined alternate-provider projection with OpenCascade axis
completion without establishing their source correspondence; it has been removed.
The historical `reference-cad-pick-20261024.json` receipts do not prove that
composition native-equivalent. Direct/OpenCascade extraction and alternate
extraction remain separate, and no caller extent is invented. Twelve selector
cases and 179 related tests pass after build. Actual provider projection, source
ownership/refresh and native/rendered construction remain unverified. Evidence:
`evidence/reference-projection-selection-20261024.json`.

Rendered application-viewport checkpoint (2026-10-24): an isolated semantic
point/finite-line fixture now exercises the actual production WebGL viewport and
ApplicationApi handlers. Seven browser checks pass: visible pixels and semantic
inspection; GUI/API point agreement; finite-line agreement and endpoint miss;
locked/hidden exclusion; clipping pixels/picks; reference-only MCP Fit; repeated
replacement/removal/disposal. Point picks match exactly; line coordinates differ
by at most 0.000064 mm under the 0.02 mm pointer tolerance. Renderer geometries
remain two across 25 replacements, then fall to zero on removal; disposal removes
the canvas. No console warnings/errors were recorded. This is a fixture-host
viewport check, not native rendering parity or the full React construction/
import/history lifecycle. All build inputs remained pinned. See
`evidence/reference-rendered-viewport-20261024.json`.
