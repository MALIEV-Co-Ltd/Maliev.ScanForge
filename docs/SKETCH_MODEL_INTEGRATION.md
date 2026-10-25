# Ordered sketch model integration

Status: internal implementation in progress, 2026-10-24. This is part of the
full reconstruction goal, not a replacement milestone or a public capability.

## Current boundaries

| Boundary                  | Current implementation                                                                                                                                                                                                                             | Required integration                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative user sketch | `src/sketch.ts`: version 1 points, separate segment/arc arrays and constraints                                                                                                                                                                     | Ordered typed children with retained defining inputs and stable identities; legacy geometry cannot supply discarded middle picks or child order               |
| Source records            | Exact Float64 storage plus `src/cad/sketch-child-collection.ts` ordered ownership; snapshots derive from current child state and feed shared pick resolution                                                                                       | Complete geometry adapters and atomic shared editing; never attach a stale optional sidecar                                                                   |
| Conic geometry            | `src/cad/sketch-conic-child.ts`: separate preparation, outcome and actual backend; arc/circle edit intents                                                                                                                                         | Integrate remaining curve types and enumerate required operations before claiming full sketch support                                                         |
| Ellipse geometry          | `src/cad/sketch-ellipse-child.ts`: collection rebuild, point handles, placed replacement, five retained child records, real kernel edge with four separate backend records, independent staging copy                                               | Remaining ellipse routes, authoritative model integration and original-native acceptance                                                                      |
| Line state                | `src/sketch-line-rebuild.ts`: separate proposed fields, retained sources and backend completion for collection/local/placed, endpoint edit/recovery and affine transform routes                                                                    | Concrete backend/body-conversion parity, midpoint provider, owned line child and edit lifecycle                                                               |
| Line primary curve        | `src/cad/sketch-line-curve.ts`: owned analytic trimmed edge, detached construction request and normalized parameter evaluation                                                                                                                     | Compose with equivalent converted-body creation and first-edge admission before reporting native backend success                                              |
| Staging                   | Independent conic `fork` preserves actual backend/preparation/outcome; line draft `fork` preserves primary/candidate presence and diagnostics; collection `stageSplice` owns one pending edit with local revision and boundary cancellation checks | Complete line-child backend adapter and host document revision, retry, lock, cancellation propagation, memory admission, lease and atomic publication/history |
| Solver, trim, mirror      | Existing graph operations in `src/sketch.ts`, `src/sketch-trim.ts`, `src/sketch-mirror.ts`                                                                                                                                                         | Update retained source state and derived geometry together, including changed child identities/order; never synthesize lost provenance from samples           |
| History/project           | Existing sketch history and project serialization                                                                                                                                                                                                  | Persist precise inputs, required prior state and ordering; preserve undefined radius, signed zero and failed-fit/backend distinctions through undo and reopen |
| GUI/MCP                   | GUI uses shared `sketch_set`; `sketch_get`/`sketch_set` in `src/automation/operations.ts`, `sketch_manage` in `authoring-operations.ts`                                                                                                            | Extend the same validated model/executor and catalog together, with structured source/results, diagnostics, limits and recovery documentation                 |

## Retained backend state

A failed arc fit can change the latest defining records while retaining a valid
older edge. Copying or restoring only the latest records loses that edge; copying
only the edge loses the failed edit and its diagnostics. A failed circle backend
can instead leave an empty backend after earlier success. Its stale successful
input must not resurrect geometry during copying.

`SketchConicChild.fork` preserves these independent facts. It allocates a fresh
backend only after live/pre-cancellation checks, rebuilds the current edge from
the retained successful backend request when an edge exists, and detaches the
latest preparation/outcome. An empty backend stays empty. Copies own separate
kernel handles; edits, failures and cancellation dispose only copied resources.
The factory must provide a fresh empty independent backend. This is application
staging policy, not recovered native clone/rollback behavior.

This method does not serialize state, register worker sessions or scene objects,
or expose an MCP tool. Public editing remains gated until the common source,
solver, history/persistence and publication lifecycle is complete. Do not use a
global CAD worker reset to cancel one staged child.

## Ordered worker ownership

`SketchChildCollection` owns an ordered set of stable child identities. Whole-child
replacement validates the resulting identities, finite owner/child frames,
records and aggregate source budgets before transferring ownership. The same
child instance cannot belong to two collections. Reordering requires an exact
identity permutation. Retired children are returned alive so the caller can
retain them for history or dispose them explicitly.

Snapshots contain both the owner-frame source store and each child's complete
detached state, including its own placement. Source records are read from current
preparation rather than cached separately, and unavailable/empty records remain
distinct. Shared construction-pick tests verify that nearest-record ties follow
this order. Caller-held references must not mutate children after transfer;
edits must stage independent copies and replace the accepted child.

Collection copies use a caller-provided independent child copier. Failed partial
copies retire only fresh copies, and collection disposal attempts every child's
cleanup even if one throws. Actual conic tests cover staged replacement, retained
failed-fit state and original/copy resource isolation. The generic contract
accepts all five source kinds; fixture tests of those kinds do not implement or
validate missing line/spline geometry adapters or remaining ellipse edit routes.

This remains worker-local groundwork. It supplies no RPC, lease, project codec,
GUI control or MCP operation. Host cancellation propagation, document revision/retry/lock policy and
history acceptance must be supplied by the common editor transaction.

## Bounded staged acceptance

`stageSplice` takes exclusive ownership of already prepared independent children
only after complete replacement admission. One pending edit is allowed per
collection; its hypothetical source document must satisfy existing source limits.
This bounds retained staged children to one additional source document, not a
native memory-budget claim. Preview leaves committed order/state untouched.
Successful acceptance revalidates the candidates, advances the collection-local
revision and returns replaced children alive for history/disposal. Collection
copies inherit the committed revision and omit pending edits.

Reordering or replacement makes an outstanding stage stale. Its next preview or
accept call rejects and retires only the candidates. Cancellation behaves the
same way at call boundaries, without an abort listener that could dispose kernel
resources during rebuilding. Explicit discard is idempotent; owner disposal
attempts cleanup of all pending and committed children even after a cleanup error.
Admission failure leaves candidates with the caller. Closed stages cannot be
accepted again. Retained references must not mutate transferred children.

This is application ownership policy, not recovered native preview acceptance.
It neither decides whether a failed native fit should be accepted nor supplies
public command retry protection, locking, leases, history or persistence. Those
decisions belong to the future common GUI/MCP editor operation. Analytic ownership
tests and actual conic kernel cleanup tests are distinct from that acceptance gate.

## Ellipse collection rebuilding

Ellipse collection inputs with fewer than three records remain incomplete XYZ
sources without a backend call. Complete inputs use only the first three points
with local Z flattened. Their first two points define a diameter, with length
0.0001 admitted at equality. A shorter diameter clears the source collection but
retains previous geometry and the backend. The third point supplies distance to
the infinite diameter line, not the diameter segment. Complete sources retain
negative/positive authoring-axis ends, positive/negative perpendicular ends and
center, in that order.

When the second radius exceeds the first, only the backend request swaps radii
and uses the clockwise rotated authoring axis. The backend keeps its own four
endpoints and constructs an analytic ellipse through the bundled geometry kernel.
Finite geometric rejection resets the prior edge; malformed application inputs
are rejected before mutation. Kernel failures and fit outcomes stay separate.
Independent copies preserve an older valid edge alongside incomplete or failed
latest source records. Collection staging uses the same ownership path as conics.

Point handles 0/1 change first radius and axis about the fixed center; handles
2/3 change second radius and rotate the axis; handle 4 assigns the exact XYZ
center. Movement must strictly exceed 2^-23. Radial handles admit radius 0.0001
at equality and divide coordinates directly during normalization. These edits
retain XYZ rather than flattening to the collection-fit plane. Rejected movement
leaves preparation and the edge unchanged and reports no backend attempt.

Placed replacement converts supplied records with the native transpose arithmetic.
Incomplete inputs retain converted XYZ with old geometry/frame/backend. Complete
inputs fit converted XY from the first three records. Only successful fitting
adopts the supplied frame; early diameter failure clears sources while retaining
the old frame/geometry/backend. These routes share the same preparation, backend
application and staging ownership boundary.

Direct creation, remaining radius/settings routes, full transforms, native
validity/display and outer editor acceptance remain open. The selected native
transform slot only delegates regeneration; it does not establish how outer
placement changes. No ellipse GUI or MCP authoring operation is activated until
the shared editor contract is complete.

## Line rebuild state and provider gate

The line collection route takes its first two points, flattens Z and admits length
at least Number.EPSILON. Local replacement instead takes the first/last XYZ
records without that precheck. Placed replacement uses first/last records with
the supplied frame's transpose conversion. Proposed frame/endpoints/midpoint
are written before the backend result; previous source records remain on failure.
Successful completion obtains backend midpoint XY, flattens endpoint/middle Z
and replaces the child sources with two endpoints.

The native backend has a separate inclusive 1e-7 length threshold. It constructs
an edge and stores backend records before checking a converted body's first edge
in a second provider. Therefore an existing kernel edge does not prove reported
success. The pure state helpers take an actual backend outcome and midpoint;
they do not synthesize success. Concrete body conversion, midpoint retrieval,
owned line child/staging, point edit recovery and native comparison remain open.
The helpers are not exported as a public worker command or GUI/MCP operation.

Further static tracing finds a conversion length threshold of 1e-8, separate
from the backend's 1e-7 admission, and coordinate scaling through a mutable
global. A subsequent bounded passive metadata check observed scale 0.001 and
reciprocal 1000 in the current native session; this is not a universal default.
The midpoint getter
requires a nonzero converted body and evaluates the stored edge at normalized
fraction 0.5, mapped as `(last - first) * fraction + first`. It does not simply
return the provisional endpoint average. Named import anchors and DLL exports
resolve the conversion to analytic line creation and wire-body construction;
fresh passive import-entry checks corroborate those bindings. Subsequent static
provider tracing resolves the wire options: tolerance 1e-6 in provider coordinate
units, disjoint results allowed, general topology disabled, checking enabled,
returned edges requested and returned source indices disabled. The sequential
mode is also identified as a separate option; its caller-selected enum is
retained privately. The tolerance is not established as a minimum line length.
Equivalent open-source body failure behavior remains unresolved.
These findings do not establish a working replacement backend or native
numerical equivalence.

Point handles 0/1 replace one internal XYZ endpoint. Admission checks the
candidate line length against inclusive 0.0001, rather than checking handle
movement. Even an unchanged handle requests rebuilding when that length passes.
On candidate backend failure, the native recovery call uses the saved old start
for both endpoints, not the previous endpoint pair. Preparation preserves those
two copies and defers recovery arithmetic until the caller requests that second
build. The native edit returns true after the attempted sequence regardless of
backend success; preparation's `admitted` flag is not backend success or editor
acceptance. The future owned line child must execute and report both outcomes.

Affine transformation applies raw 3x4 arithmetic to internal XYZ start/end,
retains the stored placement and requests rebuilding without a length precheck.
Existing source records remain until successful backend completion. These pure
helpers do not invalidate native display caches, execute a concrete backend or
publish an application edit; those lifecycle boundaries remain open.

`SketchLineCurve` now provides the primary edge stage through the generated
worker helper. Canonical malformed requests preserve the old edge; finite
geometry resets it before inclusive 1e-7 length admission. It constructs a real
analytic line trimmed to `[0, length]`, retains XYZ inputs independently, and
evaluates a clamped normalized fraction through the edge adaptor. Temporary
kernel handles retire on success, rejection and exceptions; failed cleanup
attempts all remaining deletions and also retires an unaccepted candidate edge.

`rebuildCurve` reports only primary curve creation. It supplies no converted
body, native backend result or midpoint-publication permission. The future
composite line backend must keep body/first-edge admission separate, retain
native distinctions after conversion failure, and execute the owned child edit
lifecycle. No public worker RPC, GUI action or MCP authoring tool is added by
exporting this internal component. Tests against the actual bundled kernel do
not establish native cross-kernel equivalence.

`SketchLineCurve.prepareBodyConversion(scale)` now evaluates the actual primary
edge at both ends and prepares its analytic conversion parameters through
`prepareNativeSketchLineConversion`. It requires an explicit finite positive
coordinate scale. The conversion admits source length >= 1e-8, calculates the
XYZ squared length in the recovered order, normalizes the direction twice by
reciprocal multiplication, then scales the evaluated origin and original
source length. It does not recompute length from rounded scaled endpoints.
Signed zeros and the two normalization steps' rounding are retained.

The result contains only origin, direction and interval. It allocates no
provider curve or body, supplies no success permission and does not interpret
wire tolerance as a new minimum interval. A scaled interval that underflows to
zero remains a parameter result awaiting actual body admission. Malformed
inputs and finite-input arithmetic overflow are rejected at the canonical
application boundary; failed queries preserve the owned primary edge and retire
their temporary handles. Native allocation/attachment/check outcomes and the
complete line-child lifecycle are still required before shared publication.

Static tracing now separates the fresh-curve attachment helper from common
eligibility and ownership checks. The helper links geometry and edge and returns
success on normal completion, without a numerical length comparison. This does
not establish wire-body admission: later repair/check results, cleanup and
first-edge publication remain unresolved. Keep the conversion result separate
from backend success until those outcomes are implemented and validated. See
`docs/evidence/reference-sketch-line-attachment-20261024.json`.

The recovered vertex-separation check is now available as the pure shared
`checkNativeSketchWireVertexSeparation` helper. It consumes provider-coordinate
vertex records and an explicit resolution; absent vertex tolerances resolve
independently to half that resolution. Its inclusive squared comparison retains
native arithmetic order and underflow. Diagnostics contain resolved tolerances,
squared separation, squared tolerance sum and overlap only. They allocate no
body and cannot authorize child midpoint or editor publication. The runtime
resolution must be established rather than inferred from the wire join tolerance.
Remaining edge validation, coordinate bounds and body/first-edge results still
gate the composite backend and shared GUI/MCP integration.

The earlier comparison for distinct edge vertex objects now has a separate
`checkNativeSketchDistinctEdgeVertexSeparation` entry point. It additionally
requires an explicit nonnegative delta-zero threshold and clamps each coordinate
difference only when its absolute value is strictly smaller. The final wire
check performs no such clamping. Neither result substitutes for shared-vertex
topology, curve/endpoint validity or complete body acceptance. A read-only
settings capture now supplies session-bound numerical evidence; captured values
are not installed as defaults or inferred from point identity.

## Acceptance sequence

The internal `projectNativeSketchLinePoint` prerequisite now reproduces the
analytic-line endpoint projection, strict residual zeroing and inclusive squared
tolerance check. It consumes an already prepared direction and explicit effective
tolerance/threshold; it never substitutes captured resolution for the separate
native per-thread tolerance. A successful projection says nothing about trimmed
interval validity, complete wire admission, child midpoint or publication.
Fresh topology initialization is statically corroborated, but the remaining
interval/bounds/body outcomes still gate owned line-child integration. Neither
this helper nor the separation helpers is exposed as an application feature.

`checkNativeSketchLineParameterOrder` covers the ordinary nonperiodic line's
strict oriented endpoint-parameter order. It returns a detached span/order
result without inventing a minimum interval. The surrounding recovery and
protected-call status path, coordinate bounds and complete body acceptance are
still integration requirements. It shares the projection module and remains
outside the worker and public GUI/MCP operations.

The internal `prepareNativeSketchLineVertexBounds` helper now covers the fresh
line/default-tolerance box calculation from attached vertex points. It preserves
first-coordinate ties and the native empty-box sentinel branch. Its detached
minimum/maximum tuples are inputs for later coordinate-envelope validation;
neither a box nor ordered/projectable endpoints authorize body publication.
Cache lifecycle, complete admission and owned line-child integration remain
unfinished.

`checkNativeSketchLineBoundsEnvelope` connects a canonical box to the recovered
signed envelope/relative-tolerance comparison. Its explicit settings and detached
first-failure diagnostics preserve boundary and tolerance equality without
inventing session defaults. The pure helper does not traverse native topology or
handle unavailable-box/cache errors. Full body admission and publication remain
gates before the existing projection, order and box helpers enter a shared
GUI/MCP operation.

The real primary-line backend now exposes internal `prepareBodyEndpoints`,
which evaluates the primary edge, prepares provider parameters and evaluates
detached provider start/end points with the recovered arithmetic. It preserves
the owned primary edge on query failure. These named endpoints remove ambiguity
when later topology/bounds composition needs the end vertex first. Endpoint data
does not imply converted-body/first-edge success. Full wire admission and owned
line-child integration still gate public shared authoring.

The worker now also owns real converted-wire candidates through
`SketchLineWireCandidate.create(kernel, endpoints, requestedTolerance)`.
The factory validates the prepared data, builds explicit vertices/parameters,
checks a real wire and retains a real first-edge handle. It retires temporaries
before returning and disposes both owned handles on failure. A lower-level edge
builder preserves short intervals that the high-level maker rejects. Requested
tolerance is explicit and is not confused with the kernel's reported floor.
This resource owner supplies the next body stage; full native admission and
the owned line-child attempt/state protocol still gate shared publication.

Fresh-line scalar checks now run through one shared geometry function before
`SketchLineWireCandidate.createChecked` allocates a candidate. All five settings
are explicit, including endpoint tolerance independently of resolution. The
result reports geometry rejection, kernel rejection or a constructed candidate,
with detached per-stage diagnostics. The primary-edge backend's internal
`prepareBodyCandidate` validates settings before queries and returns caller-owned
candidate resources. Full native state/recovery and the owned child/host
publication protocol remain separate requirements; no public operation is added.

1. Complete the ordered child model and required operation inventory for all
   curve kinds; retain child placement independently of owner selection frame.
2. Connect shared solver/trim/mirror edits through staged child ownership and
   publish derived geometry, records and history in one accepted change.
3. Add exact persistence and legacy handling without inventing absent authoring
   provenance. Verify failed edits and retained geometry across undo/reopen.
4. Extend shared GUI/MCP schemas, executor, adapter and agent documentation in
   the same coherent change. Verify revision/retry/lock/resource/cancel behavior.
5. Run original-native numerical/save-reopen and rendered GUI/MCP comparisons.
   Internal analytic and kernel tests do not substitute for those gates.

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

The shared worker entry also exports the recovered scalar self-connection
candidate comparison. Explicit squared thresholds and lazy witness queries
preserve strict boundaries and avoid treating short lines as loops. Real
kernel fixtures cover a short line, a valid low-level wire candidate, a full
circle and 100 primary-resource replacement cycles. Witness sampling in these
fixtures is explicit test input, not proof of the original sampling policy.
The helper does not mutate topology or supply complete backend admission;
ordered model publication and the shared GUI/MCP editor remain unfinished.
See `docs/evidence/reference-sketch-self-connection-20261024.json`.

For prepared straight lines with known endpoint parameters, the common worker
now supplies the recovered analytic witness itself. The retained wire candidate
offers a read-only `checkSelfConnection` diagnostic using the same pure helper;
returned geometry is detached and disposed candidates reject queries. This
removes the caller-supplied witness requirement for that selected line path.
It does not complete connection topology, body admission or ordered editor
publication. Evidence: `docs/evidence/reference-sketch-line-witness-20261024.json`.

The common worker also retains a separate early input-interval diagnostic for
known analytic line parameters. It requires a supplied parameter-zero threshold,
preserves strict boundaries and does not replace the later projected interval
check. `SketchLineWireCandidate.checkInputInterval` reads retained prepared
data without retiring or changing handles, including when its diagnostic is
negative. This is still internal groundwork: production admission must bind
that runtime setting and complete downstream topology before publication.
Evidence: `docs/evidence/reference-sketch-line-input-interval-20261024.json`.

The input interval's separate threshold is identified as session angular
precision. Selected numeric-profile initialization writes use `1e-11`; the mutable
setter couples coordinate envelope to endpoint tolerance divided by angular
precision. Shared admission must bind a consistent session profile rather than
assume independent defaults for these settings. Explicit scalar diagnostic
inputs remain unchanged because the active application value and full context
lifecycle are still unbound. This static checkpoint adds no public authoring
operation. See `docs/evidence/reference-sketch-angular-precision-20261024.json`.

Converted line candidates now preserve prepared analytic directions through a
checked adapter for the bundled kernel binding. Ordinary constructor
renormalization changed some direction/endpoint bits; 100 deterministic real
primary/conversion/candidate fixtures now match their prepared data exactly.
The adapter owns its new direction until transfer, checks memory layout before
restoring coordinates, rolls back failed readback and preserves cleanup causes.
See [binding compatibility requirements](CAD_DIRECTION_FIDELITY.md). Complete
native topology/admission and shared editor publication remain unfinished.

The selected ordinary/no-neighbor one-edge structure now has direct native
branch evidence and a permanent real-kernel regression. Six fixtures and 100
cycles check distinct endpoint identities, endpoint orientation/XYZ, interval,
one-edge count and no closure. Requested and kernel-reported tolerances remain
separate. Original-command reachability, connected/closed topology and complete
native admission are still required before ordered editor publication. See
`docs/evidence/reference-sketch-open-topology-20261024.json`.

The draft now applies explicit attachment-stage return events through the
common candidate. Point status `1`, range status `1`/`5`, and curve status `1`
continue construction without declaring admission. Rejections retire the wire
and first edge but preserve the primary curve and original records. Malformed
events preserve resources; the draft rejects attachment events outside its
pending construction phase. Seven controlled-event kernel groups cover these
transitions and cleanup failures. This diagnostic is not an ordered complete
backend: `rebuild` still returns a snapshot and must not be treated as the
child backend's boolean success. Full admission and shared editor publication
remain required. See `docs/evidence/reference-sketch-attachment-disposition-20261024.json`.

Creation-to-attachment evidence now adds the native constructor's mode-two
allocation, post-creation bookkeeping and context-association path. Initializer
zeros are not sufficient attachment-time preconditions: association is gated by
a runtime class table and the post-creation route has additional downstream
calls. The complete backend must account for these state transitions before
publishing ordered children through the shared GUI/MCP operation. No public
authoring or settings contract changes at this static checkpoint. See
`docs/evidence/reference-sketch-line-creation-provenance-20261024.json`.

Actual line children now project their retained frame and source records through
the ordered collection's existing `preparation` contract. Previously their
snapshot exposed only `state`, so collection reads silently converted both
nonempty and explicitly empty line records into unavailable records. The shared
projection preserves exact retained values and distinct owner/child placements;
it does not substitute proposed endpoints after backend failure.

Unit integration covers actual line children, ordered source reads, the shared
construction-pick resolver, bit-preserving source codec and staged replacement.
Success transitions use controlled backend results, not a native oracle. The
real-kernel child smoke additionally checks collection replacement and 100
collection-owned retirement cycles while complete admission remains unavailable.
This internal correction does not publish the unfinished ordered editor or
complete its GUI/MCP acceptance. Evidence:
`docs/evidence/reference-sketch-line-collection-20261024.json`.

### Independent line draft staging

`SketchLineBackendDraft.fork(signal?)` now creates independently owned primary
and wire resources from their retained construction requests. It restores each
only when that resource exists in the source. A rejected wire stays absent even
when the primary curve survives; an error can retain a primary while kind/records
remain empty, and that distinction also survives copying. Retained diagnostics
are detached rather than rerun as fresh validation or native acceptance.

This is application staging policy, not recovered native cloning. Borrowed
kernel handles are read-only: callers must not mutate their topology behind the
draft. The current draft has immutable one-edge candidate geometry; future
geometry-changing repair operations must extend its retained copy contract.
Pre-cancellation allocates no kernel objects. Checks after primary and candidate
construction retire staged resources on cancellation or reentrant source
changes. They cannot interrupt synchronous WASM. Copy and cleanup failures retain
both causes and do not publish the staged object.

The new kernel smoke verifies independent shape identities, actual endpoint
values, pending/retained/rejected/error states, failures, cancellation boundaries,
source mutation and 100 retirement cycles. Complete native admission, a full
boolean line-child backend, ordered editor publication/history/persistence and
GUI/MCP acceptance remain unfinished. Evidence:
`docs/evidence/reference-sketch-line-draft-fork-20261024.json`.
