# Persistent Reference Construction Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Preserve the ledger across continuations.

**Goal:** Implement persistent point and line constructions with one GUI/MCP lifecycle and verified native semantics.

**Architecture:** Separate precise semantic values and construction recipes from derived display buffers. Resolve immutable source primitives, evaluate with recovered arithmetic, and publish the cached result through host-owned shared operations. Integrate project/history/dependencies before advertising commands.

**Tech Stack:** TypeScript, React, Three.js, existing application API/MCP catalog, Vitest, existing SHA-256 dependency.

**Spec:** [Approved design](../specs/2026-10-23-reference-construction-design.md).

## Global constraints

- Work in the user-selected current checkout; preserve unrelated changes.
- GUI and MCP must use identical operations, validation, history and results.
- Canonical geometry is finite Float64 in millimeters; display buffers are derived.
- Preserve arbitrary entity IDs, signed zero, record order and duplicate weighting.
- Unsupported or unresolved modes remain undiscoverable; foundations do not complete the feature.
- Serialize heavy checks in owned 4 GiB / 25% CPU Jobs with existing admission guards and finite leases.
- Allocate 3 GiB of that existing total budget to the compiler heap. The earlier inherited 2 GiB build-heap setting was a separate bottleneck; do not copy it into new compiler runners. Keep the total Job cap at 4 GiB and leave room for runtime overhead.
- Build before post-implementation focused acceptance. TDD red runs precede implementation.
- Browser/native restrictions persist. No commit until required rendered GUI/MCP acceptance; no push/release.

## Review focus

- Legacy IDs differing only in UTF-16 code units must receive deterministic distinct keys without project mutation (Task 1).
- A repeated line source may be one dependency but two weighted records (Tasks 2 and 5).
- Signed zero and recipe-only changes must survive project history and invalidate stale previews (Tasks 1, 3 and 5).
- Cancellation/expiry must retire only owned preview resources (Tasks 4 and 5).
- Dependent reference chains must not silently survive a missing source or change order after undo/reopen (Tasks 3 and 6).

## Task 1: Precise values and stable source identities

**Files:** Create `src/reference-construction-values.ts`, `src/reference-construction-identity.ts`, `tests/reference-construction-values.test.ts`, `tests/reference-construction-identity.test.ts`.

**Interfaces:** `ReferenceGeometry` is a point position or line start/direction/length with readonly triples. `copyReferenceGeometry(unknown): ReferenceGeometry` validates and detaches values. `referenceLineEnd(line): ReferenceVector` uses start + direction * length. `encodeReferenceGeometry(geometry)` / `decodeReferenceGeometry(unknown)` use a versioned JSON-safe Float64 bit representation. `resolveConstructionIdentities(scene, sourceIds)` returns detached `{ orderedSources, assignments }`; source rows are `{ id, constructionOrderKey? }`, assignments contain only absent keys. Keys are canonical 32 lowercase hex characters representing 16 raw bytes; sorting hex equals unsigned byte sorting.

- [x] Write failing tests for signed zero/subnormal/large finite geometry, invalid shape/nonfinite/negative length, immutable copies, JSON round trip, exact legacy hash vectors, Unicode distinctions, collisions across unselected objects, duplicate IDs, missing sources, deduplication and cancellation stability.
- [x] Run the two suites under the owned runner; observe missing-module failure.
- [x] Implement validation and lossless values. Derive legacy keys from the specified domain + NUL + UTF-16LE ID, using SHA-256. Resolve all scene identities before returning; never mutate input or assign keys during preview.
- [x] Build, then run both suites and existing numerical tests. Record receipts; format changed files.
- [x] Record reviewed uncommitted foundation; do not add EntityKind/catalog entries yet.

## Task 2: Native evaluator and precise source records

**Files:** Create `src/reference-construction.ts`, `src/reference-construction-resolver.ts`, `src/reference-point-evaluation.ts`, `src/reference-line-evaluation.ts`, `src/reference-line-pairs.ts`, `tests/reference-construction.test.ts`, `tests/reference-point-evaluation.test.ts`, `tests/reference-line-evaluation.test.ts`; extend `docs/NATIVE_REFERENCE_GEOMETRY.md` and digest-bound evidence.

**Interfaces:** Versioned `ReferenceConstructionDefinition` discriminates typed point/endpoints, picked point/endpoints, primitive center, primitive pair, three planes and average axes. `evaluateReferenceConstruction(definition, resolvedInputs, priorState)` returns `{ geometry, outcome, diagnostics, state }`; `resolveReferenceConstructionInputs(host, definition, context)` returns immutable primitives plus ordered source identities and records. State carries the native completion word internally; public diagnostics describe its meaning. No public setting controls it.

The internal point and line evaluators now implement the recovered arithmetic.
Line records additionally retain object-resolution status, direct-plane extent
fields or raw Float32 source bounds. Missing objects and unsuccessful geometric
extraction produce different finalization paths. The resolver must supply these
from exact source operations; it must not fabricate bounds from display buffers.
It also owns dependency refresh and native update-level propagation before the
pure geometry evaluator runs.

`reference-construction.ts` now provides the version-1 internal storage core:
point coordinates/center/pair/threePlanes and line endpoints/pair/average, with
canonical common identities kept separately from ordered Float32 pick records.
All point modes retain the common set, and all line modes retain both containers,
including when inactive. The codec preserves empty/extra collections and does not
enforce authoring admission. Coordinate snapshots use Float64 bits; retained picks
use Float32 bits and a storage tag without an inferred coordinate frame. This is
not a completed picked-mode recipe: acquisition provenance, exact subfeature
bindings, unresolved point fields and source-space interpretation still precede
their implementation. Geometry, evaluation outcome and completion state remain
separate from caller-editable definitions.

`reference-construction-evaluation.ts` connects this definition core to the
arithmetic helpers. Numeric controller writes are explicit and preserve the
completion word; evaluation is a separate operation. Stored modes retain prior
geometry, and disabled evaluation preserves geometry and state. Derived modes
require exact ordered source/record bindings. This internal boundary does not
replace scene resolution, dependency refresh, publication or shared GUI/MCP
operations. Its tests are in `tests/reference-construction-evaluation.test.ts`.

`reference-source-primitives.ts` extracts direct stored sphere/point, cylinder,
cone, line and plane snapshots, and adapts already resolved OpenCascade axis
parameters. It preserves raw direct-axis scale, cone offset arithmetic and the
CAD caller's reconstruction from positive extent. It does not identify objects,
pick subfeatures, convert coordinate frames or implement alternate-provider
extent. Tests live in `tests/reference-source-primitives.test.ts`.

Source identities are now established by static query/thunk/vtable tracing and
fresh passive native metadata reads, recorded in
`docs/evidence/reference-source-identities-20261023.json`. The point helper's
fallback is a sketch object; the axis helper's fallback is a CAD model interface
shared by modeling operation subclasses. Do not substitute nearest scan vertices
for the sketch record path. Current projection multipliers were observed as 0.001
and 1000, but their initialization and provider dispatch still require tracing.
The sketch child record producer, pick acquisition/frame rules and CAD extent
semantics remain prerequisites for dependent implementation.

The active alternate provider's cylinder/cone origin and direction extraction is
now implemented as `extractAlternateReferenceAxis`, using supplied unit scale and
the shared native normalization helper. Cone origin uses the recovered
`tan(pi/2 - angle) * radius * scale` order, followed by a second direction
normalization. Its result explicitly reports `extentWritten:false` and cannot be
published as a line. Static caller analysis establishes a one-byte projection
flag write to the same caller-home slot later read as an eight-byte extent; the
active extraction path does not replace it. The remaining seven bytes and actual
native output still need observation. Do not substitute unit length or a bounds
diagonal, or activate `reference_construction_*` on this evidence alone.

The sketch fallback now has an internal `resolvePickedSketchReferencePoint`
adapter for already resolved ordered child point records and an explicit owner
frame. Constructor/virtual-slot tracing and passive code bindings establish the
ordered container walk; the adapter preserves transform arithmetic, Float32 pick
promotion, strict first-match ties and the finite initial squared-distance bound.
The child record producers and pick/frame acquisition are still unresolved.
Analytic coverage in `tests/reference-sketch-point.test.ts` is separate from
native replay and public construction acceptance. The helper does not change
agent discovery, import admission or any published application operation.

The backend audit now binds the active sketch factory and selected curve methods
to installed OpenCascade exports. Source records, a temporary adjacent-point
filter, knot-evaluation exports, control records and expanded display samples are
distinct paths. Do not collapse them into one sampled representation. See
`docs/evidence/reference-sketch-backend-20261023.json` for the instruction and
passive-binding scope. ScanForge's current Sketch v1 has no spline record carrier
or common segment/arc/spline child order; resolve these shared model, identity and
placement prerequisites before exposing scene-level reference construction.

The open-spline solver audit now establishes the larger-input natural cubic
branch: centripetal parameters, averaged clamped knots, endpoint second-derivative
rows, ordered dense partial-pivot elimination and Float32-rounded output poles.
The three-point branch instead uses OpenCascade interpolation with an identified
PointsToBSpline fallback. See `docs/evidence/reference-sketch-spline-20261024.json`
and the detailed contract in `docs/NATIVE_REFERENCE_GEOMETRY.md`. These are
code/import identities and recovered arithmetic, not native output fixtures.
Do not replace all spline branches with one generic interpolation call. The
shared sketch model/worker and GUI/MCP lifecycle must be extended coherently,
after remaining source records and owner/pick placement are established.

Selected conic source paths are now traced in
`docs/evidence/reference-sketch-conics-20261024.json`: three-point arcs/circles
retain three defining points plus center, while completed ellipses retain four
axis endpoints plus center in authoring-axis order. Backend record collections
are different. The current drawing model discards the middle three-point pick,
so it cannot supply those records from geometry alone. Preserve provenance in
the shared model rather than fabricating it from tessellation. The common
circumcenter arithmetic is implemented internally as
`nativeReferenceCircumcenter`, with separate failure status and centroid fallback;
it does not activate drawing or construction operations.

The native center/radius command helper now has a separate evidence checkpoint,
`docs/evidence/reference-sketch-circle-inputs-20261024.json`. Its ordered +X, +Y,
-X radius points feed the existing three-point builder; the inclusive input
radius threshold does not imply successful fitting. The internal helper
`nativeReferenceCircleInputPoints` preserves these operations and signed zero.
Radius editing instead rescales existing directions and has its own absolute
value/default behavior. Do not replace one path with the other. The command
helper does not yet establish every interactive creation path. Owner/pick
placement and outer-editor failure publication still need evidence before
scene-level source resolution. No public sketch/MCP contract is changed.

The owner-placement extension in
`docs/evidence/reference-sketch-owner-placement-20261024.json` establishes
explicit twelve-double frame copying, circle insertion validity checks and the
placed-record rebuild's transpose-based rigid inverse. It does not authorize
general affine frames or prove retained-pick acquisition. Preserve exact source
records and arithmetic order; distinguish child geometry validity from full
editor transaction/exception rollback.

The line-pick checkpoint in `docs/evidence/reference-line-picks-20261024.json`
now establishes the selected sketch-record acquisition branch: round local XYZ
to Float32, transform with the owner's double frame, then round world XYZ to
Float32. `acquireSketchReferencePick` implements that internal arithmetic;
nearest-record resolution continues to use the original double source records.
The handler's cached owner/child/index selection and generic viewport-hit
provenance remain upstream prerequisites. Acceptance has a separate important
transition: a pair containing either sketch becomes stored endpoint mode with
no common dependencies, while retaining its copied line geometry and ordered
pick vector. Implement this transition in the shared publication lifecycle;
do not publish a persistent sketch-pair recipe. Outer transaction failures and
original-native numerical/save-reopen/rendered acceptance remain unverified.

The selection extension in
`docs/evidence/reference-sketch-selection-20261024.json` traces the cached owner,
child and record-index path and distinguishes stored-record selection from
child-only and alternate/control-record paths. `reference-construction-resolver.ts`
now contains `resolveSketchConstructionPick`: bind an exact ordered snapshot by
stable application identities, acquire the retained world pick, and evaluate it
against all original records. It is an internal branch, not the complete
`resolveReferenceConstructionInputs` scene operation. The host still owns
revision/lock/eligibility/cancellation/resource checks and dependency refresh.
Highlighting transforms original doubles and must not reuse the acquisition
helper's additional local rounding. Nested-group selection and generic hit-test
provider behavior remain open. Next extend common ordered sketch source storage
and preserve defining three-point inputs before connecting scene snapshots,
shared publication and GUI/MCP discovery; do not reconstruct absent provenance
from existing arc display geometry.

- [ ] Complete evidence for CAD/curve/scan picks, point retained fields, remaining pair branches and edit controls before coding dependent behavior. Use static/read-only analysis with fresh identities; never execute the preserved analysis image.
- [ ] Write analytic red cases from established arithmetic and native execution fixtures when obtainable, covering thresholds, all source orders, failed extraction, degenerate lines, unchanged flags, repeated records and prior-state fallback.
- [ ] Implement only evidence-established branches, sharing existing numerical helpers. Keep unsupported branches explicitly rejected and undiscoverable.
- [ ] Build and run evaluator/numerical/datum regression. Pin source and fixture identities; separate analytic from native claims.

Source-storage prerequisite checkpoint: `src/sketch-source-records.ts` adds an
internal ordered record store and exact Float64 codec. Whole-child replacement
preserves surrounding order and prior snapshots; unknown fields and unsupported
groups fail rather than being dropped. Tests feed decoded middle/center records
and ordering ties into `resolveSketchConstructionPick`. This is not the complete
editable sketch model: integrate authoritative curve rebuilding, constraints,
trim/mirror, project persistence and history coherently before adding source
state to GUI/MCP discovery. Existing v1 geometry cannot reconstruct missing
authoring records. Application admission budgets and raw-frame storage do not
establish native limits or authorize general affine authoring. See the ordered
source-record storage section in `docs/NATIVE_REFERENCE_GEOMETRY.md`.

Circle producer checkpoint: `prepareNativeSketchCircleRebuild` now prepares the
four source records and backend request together. Failed fits retain the middle
input as center and negative maximum finite radius; successful fitting measures
radius from the third input with a strict threshold. Backend reset/admission is
separately traced; the shared editor connection remains open. Build and 199
focused tests in nine files pass. This does not activate an authoring operation.
Arc fitting has different prior-state/record-write behavior and cannot share the
circle implementation indiscriminately. Complete curve/backend state transitions
and the common editing lifecycle before GUI/MCP publication. See the circle
rebuild section in `docs/NATIVE_REFERENCE_GEOMETRY.md`.

Kernel backend checkpoint: the internal `SketchCircleBackend` now constructs
real circle edges in the existing CAD worker and owns replacement/disposal.
Eighteen grouped real-kernel checks include 32 replacement cycles and two
controlled partial-construction failures. The existing CAD and curved-sketch
kernel smoke suites pass, alongside 208 focused tests in eleven files and the
build. No new worker message or GUI/MCP operation is exposed. Add child-session
ownership/cancellation and shared editor publication before treating this as a
user/agent capability; native numerical and rendered acceptance remain required.

Arc producer checkpoint: `prepareNativeSketchArcRebuild` now preserves the
separate prior radius, closed flag, retained source records, internal points
and optional backend request. Tests cover early failures, midpoint repair,
closure without source-A replacement, detached state and codec/resolver use.
Six more caller dossiers establish which rebuild paths carry the closed flag
and which clear it first. This is local preparation, not accepted arc geometry:
real backend lifecycle, outer failure/rollback semantics and coherent shared
editing/publication remain required. See the stateful arc rebuild section in
`docs/NATIVE_REFERENCE_GEOMETRY.md` and its evidence receipt for actual checks.

Arc backend checkpoint: the real bundled-kernel `SketchArcBackend` owns an edge
and three backend records, clears old geometry before native numeric admission,
and retires partial construction handles on rejection/exception. The observed
scale-dependent gate normalizes B-A twice while leaving C-A unnormalized.
The classic worker loads a generated bundle of the shared TypeScript class and
numeric helpers, prepared by the existing kernel build step. Real-kernel tests
cover direction/major arcs, admission boundaries, closed-endpoint failure,
replacement and cleanup. No new dispatcher or GUI/MCP operation is exposed;
shared child-session ownership and editor/publication remain the next step.

Conic child ownership checkpoint: the internal `SketchConicChild` now composes
shared arc/circle preparation with actual backends, preserving distinct retained
sources, backend records, builder outcomes and validity. It handles detached
inspection, failure state and staged cancellation/disposal. Constructor evidence
does not establish the first arc radius; an explicit unknown value survives until
a traced branch writes it. The generated worker bundle exports this owner through
`src/cad/sketch-backend.ts`. Public worker sessions, scene/edit transactions,
revision/retry/lock/lease policy and common persistence remain unimplemented;
do not advertise this internal owner as a completed GUI/MCP capability.

Local arc replacement checkpoint: native local replacement is not a generic
refit. More than three records whose first three are each strictly within
squared distance `1e-5` of the internal points retain geometry, clear closure,
regenerate source records and still rebuild the backend. Exactly three records
or a failed comparison refit with closure initially false. Shared preparation
and the worker child now preserve this branch, including signed zero and
failure-state transitions. Twelve analytic cases and real-kernel coverage pass.
Placed-record and individual point edits remain distinct evidence/integration
work. This adds no public operation; common solver/edit/history/persistence and
GUI/MCP publication must retain explicit edit intents and authoritative source
records rather than treating legacy display geometry as equivalent provenance.

Placed arc replacement checkpoint: world-record comparison now routes to either
fourth-record center translation or three-point refitting, with the recovered
transpose arithmetic and stored/supplied-frame distinction. Translation retains
radius and stored placement, applies a delta to existing points/center without
flattening local Z, and rebuilds the real backend. Refitting copies the supplied
frame and uses the builder's flattening/closure rules. Twelve analytic cases and
actual-kernel center/radius, exception and cancellation checks pass. Individual
point editing and the common editable/persistent source model remain required;
no public GUI/MCP schema or authoring capability is added at this checkpoint.

Individual arc point checkpoint: indices 0..2 now refit internal A/B/C using the
existing closure flag, while index 3 applies an XY center delta with positive-zero
Z additions and preserves radius/frame/closure. The shared translation producer
now receives closure explicitly so collection replacement and individual editing
do not silently share the wrong policy. Thirteen analytic cases and real-kernel
center/closure/failure/cleanup checks pass. Transform edits and coherent common
model/solver/trim/mirror/history/persistence remain required before shared GUI/MCP
publication; this worker-local edit method is not a completed public capability.

Task 2 continuation: the known-parameter nonperiodic analytic line branch now
has a recovered witness policy (parameter sum times one half, then analytic
evaluation), shared scalar comparison and read-only retained-candidate query.
This narrows the sampler gap only for that branch. Downstream connection
topology, complete native admission and ordered/shared editor publication
remain required; Task 2 is not complete. See
`docs/evidence/reference-sketch-line-witness-20261024.json`.

Task 2 continuation: recovered an earlier analytic line input-range check with
a distinct explicit runtime parameter threshold. The shared helper and
retained candidate diagnostic preserve strict span/order comparisons; they do
not replace post-projection order or complete admission. Runtime setting value
and downstream topology remain unbound. The native empty connection list skips
graph processing, but full no-connection topology is not yet proved. The current
[M4 tracker](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/4) still
requires closed-profile, save/reopen and real GUI/MCP scan workflows; no closure
is claimed. See `docs/evidence/reference-sketch-line-input-interval-20261024.json`.

Task 2 continuation: the earlier input threshold is session angular precision.
Selected numeric-profile initialization writes use1e-11; the setter has finite bounds and
couples coordinate envelope to endpoint tolerance divided by angular precision.
A context-field route can call the setter, so initialization does not establish
the active application value. Keep explicit inputs until that profile is bound;
continue wrapper/no-connection topology and full admission without inventing
independent defaults. Evidence:
`docs/evidence/reference-sketch-angular-precision-20261024.json`.

Task 2 continuation: the interval wrapper's selected direct stores preserve the
supplied curve/endpoints/parameters. Actual kernel testing exposed a further
normalization that changed direction and endpoint bits. The common candidate
now preserves prepared directions through a checked owned-object binding
adapter; 100 deterministic conversion fixtures and binding-failure cleanup
checks cover it. This removes that numerical mismatch, not the remaining
topology/admission/editor gates. See
`docs/evidence/reference-sketch-direction-fidelity-20261024.json` and
`docs/CAD_DIRECTION_FIDELITY.md` for the compatibility contract.

Task 2 continuation: selected ordinary/null-neighbor/no-existing-vertices
one-edge branch is corroborated against actual constructors and endpoint
attachment. The common candidate passes six real-kernel topology fixtures and
100 retirement cycles, including short spans and distinct underlying endpoints.
This is conditional topology evidence; full command reachability, transitive
effects, connected/closed cases and whole admission remain unproven. See
`docs/evidence/reference-sketch-open-topology-20261024.json`.

## Task 3: Project, history and inspection integration

**Files:** Modify `src/types.ts`, `src/io.ts`, `src/project-file-codec.ts`, `src/history.ts`, `src/geometry-digest.ts`, `src/object-operations.ts`, `src/scan-mesh-copy.ts`, `src/automation/api.ts`, `src/automation/operations.ts`, `src/automation/authoring-operations.ts`; create `src/reference-entity.ts`; extend project-file, history, geometry-digest and object-inspection tests.

**Interfaces:** Entity gains `constructionOrderKey?` and a semantic reference payload containing geometry/definition/evaluation. `isReferenceEntity`, `referenceEntityBounds` and shared eligibility helpers distinguish semantic objects from meshes. `positions` remains empty for reference kinds. Geometry digest includes precise semantic bits; revision/history compare definition and identity changes.

Structural persistence checkpoint: the semantic payload, JSON wire version 3,
binary manifest version 5, state-local identities, history/revision comparison,
geometry digests and shared keyed-object duplication are implemented. Original
inputs validate before topology cleanup or binary materialization. Shared GUI/MCP
import and backup restoration reject reference-bearing current/history/future
states until rendering and eligibility are integrated. The focused suite passes
255 tests; the full suite passes 48,127 with 64 skipped. Evidence is
`docs/evidence/reference-persistence-20261023.json`. This is the structural
baseline for the inspection and geometry-eligibility integration below.

Inspection continuation: `referenceEntityBounds`, detached semantic inspection and
the shared sampled-geometry admission check now exist. `object_get`/`project_get`
provide precise geometry/counts/bounds and saved identity/record status; geometry
artifacts preserve exact bits through `artifact_read`. The completion word does
not identify an evaluation outcome, so inspection reports stored state with
outcome:null. Read-only processing and secondary targets are guarded as well as
editing paths. The current focused suite passes 228 tests, including 44 new
inspection/eligibility regressions. Viewport and remaining GUI consumers still
need Task 4 integration before reference import can be enabled.
The unfiltered full suite passes 48,171 tests with 64 skipped; source-bound
evidence is `docs/evidence/reference-inspection-20261023.json`. Native and rendered
GUI/MCP acceptance remain open.

- [ ] Write red JSON/binary/live/undo/redo round trips with signed zero, source keys, retained picks, arbitrary IDs and recipe-only changes. Reject incompatible kinds, collisions and malformed metadata before mutation.
- [x] Exercise actual `serializeProject`, `serializeProjectBlob` and binary metadata bytes; structured clones alone do not prove JSON preservation. Give duplicated keyed sources fresh identities, including ordinary meshes, and test undo/reopen before any keys enter accepted entities.
- [ ] Add explicit validators/serializers and detached metadata. Preserve historical reference state and migration keys transactionally; do not use `fit` as authoritative recipe storage.
- [ ] Extend object inspection with semantic geometry/counts/bounds/status and dependency information; prevent triangle-only handlers from accepting references.
- [x] Apply shared eligibility to `editable`, `selectedPositions`, `mesh_copy`, `mesh_analyze`, `analysis_fit/section/deviation`, authoring `selection_modify/selection_saved` and `scanMeshCopy`; no empty mesh substitutes.
- [ ] Build; run project/history/digest/API suites. Keep semantic imports unavailable until Task 4 makes them renderable; no public intermediate release.

## Task 4: Rendering, picking and datum consumers

**Files:** Modify `src/viewport.ts`, `src/viewport-agent.ts`, `src/viewport-picking.ts`, `src/automation/alignment-operations.ts`, `src/ui/DatumReferencePicker.tsx`, `src/ui/App.tsx`; extend viewport-agent and cad-alignment-reference tests.

**Interfaces:** Semantic point/line render adapters derive Float32 buffers; shared pick results retain object/subfeature IDs. Alignment references expose semantic point/direction using existing native datum adapters and finite-line midpoint convention.

Viewport checkpoint: `src/reference-display.ts` now supplies separate Points/Line
objects, precise semantic bounds and world-space raycasts. The viewport integrates
them into camera framing, navigation, canvas/context-menu/MCP picking, clipping
and cleanup while excluding triangle brushes. Twelve new CPU integration tests
cover display kinds, exact points, metadata/resource lifetime, mesh/reference ID
transitions, scene-scaled tolerance, decorative CAD-edge exclusion and explicit
display-range failures. The focused suite passes 176 tests and the full suite
48,183 with 64 skipped; evidence is `docs/evidence/reference-viewport-20261023.json`.
This does not establish GPU/native visual parity. The project import gate stays
closed pending GUI statistics/controls, datum consumers and remaining acceptance.

Datum consumer checkpoint: semantic points and lines now use the existing native
datum adapter through `alignment_references`. GUI source selectors/properties
inspection and MCP share discovery; bound Preview/Apply reread the same source
at the current revision. Read-only source eligibility does not admit reference
movement. Fifty-five new tests cover historical midpoint bytes, precise values,
validation, source immutability, revision/retry behavior and server-rendered
source/target lists. Focused validation passes 719 tests; the full suite passes
48,238 with 64 skipped. Evidence is
`docs/evidence/reference-datum-20261023.json`. GUI semantic statistics and
triangle-only controls remain open; no rendered/native acceptance is claimed.

Inspector checkpoint: shared semantic summaries now drive GUI reference
counts/position/bounds and the status bar without mesh area/volume/facet claims.
Selected payload identity invalidates statistics, and sampled geometry admission
guards automatic selection sessions, brush/section calculations and scan tools.
GUI navigation and MCP `ui_set` share atomic reference-selection validation.
Nine new tests cover summaries, server-rendered output, ribbon admission and
API state/error parity. Build and 257 focused tests pass; the full suite passes
48,247 with 64 skipped. Evidence is
`docs/evidence/reference-inspector-20261023.json`. App effect wiring has source
inspection, not browser execution coverage. Rendered GUI/MCP/native acceptance,
construction preview ownership and later lifecycle work still precede public
reference admission. Task 2's unresolved native input/pick/publication behavior
must be recovered before implementing the dependent Task 5/6 paths.

- [ ] Write red tests for semantic bounds/counts, visible/hidden/locked selection, line/point picks, clipping, disposal and datum-reference geometry.
- [ ] Test reference-only and mixed scenes, fit-view, grid/clip extent and orbit centers. Update scene bounds/navigation admission and selected-object statistics; guard section and triangle selection paths. Include semantic payloads in memo dependencies.
- [ ] Implement point markers and finite lines without mesh normals/BVH. Retire preview display objects by owner; include semantic objects in GUI datum selectors and MCP references.
- [ ] Build; run focused tests. Obtain rendered GUI/MCP comparison only when authorized browser access is available; record the exact outstanding gate otherwise.

## Task 5: Shared construction sessions and editor

**Files:** Create `src/automation/reference-construction-operations.ts`, `src/automation/reference-construction-editor.ts`, `src/ui/ReferenceConstructionTools.tsx`, `tests/reference-construction-api.test.ts`; modify `src/automation/operations.ts`, `src/automation/api.ts`, `src/automation/use-workspace-api.ts`, `src/automation/interactive-host-adapter.ts`, `src/automation/global-alignment-operations.ts`, `src/automation/interactive-alignment-operations.ts`, `src/automation/workflow-operations.ts`, `src/automation/catalog.json`, `src/ui/App.tsx`, `src/ui/ribbon-model.ts`, `src/ui/ribbon-verification.ts`, `docs/AGENT_GUIDE.md`, `docs/MCP_ARCHITECTURE.md`.

**Interfaces:** Commands `reference_construction_sources/edit/get/apply` and owner-scoped `preview_discard`; session version, revision binding, definition, resolved order, cached geometry/diagnostics, expiry and staleness are inspectable. Successful edit renews a 60-second lease. Apply consumes the cached preview and identity assignments in one history mutation.

- [ ] Write public API red tests for begin/edit/apply/discard, lock/revision/version failures, exact retry receipts, cancellation/expiry/disposal, competing previews, repeated records, recipe-only invalidation and selection-only stability.
- [ ] Implement one host-scoped session family using context checks/mutation; join all competing-preview and API disposal paths. Add only supported modes to discovery.
- [ ] Forward callbacks through the stable React host proxy with `flushSync` where required. Extend exact discard dispatch before adding the target enum, so it cannot fall through to sketch cancellation. Reuse `application-job-command` for async observation and a construction-specific editor adapter.
- [ ] Establish a narrow validated identity-migration transaction policy for locked sources: only the deterministic absent key may be added, without altering geometry or other protected fields. Test locked source acceptance, locked edited-object rejection and arbitrary key-change rejection. Do not assign keys to unselected objects.
- [ ] Implement GUI controls through the shared editor/API, including numeric fields, source selectors and evidence-backed canvas/handle behavior. No separate React evaluator.
- [ ] Build; run contract/behavior/editor tests, then authorized rendered equivalence and resource-lifetime checks. Update agent schemas, limits and recovery documentation with actual behavior.

Preview ownership checkpoint: React effect replay now preserves the shared API
gateway and retry receipts while releasing resources immediately on owner loss.
The main App's page-exit disposal remains permanent. Reciprocal admission now
rejects competing GUI/MCP preview producers before work starts and retains BUSY
through failed renderer retirement. Real-App Align and shared `ui_set` agree;
release makes alignment available again without changing model history. These
lifetime/admission checks do not activate construction tools or complete the
source resolver, cached Apply transaction, public editor or dependency lifecycle.

Cached numeric Apply checkpoint: an internal shared operation now copies the
owned point/endpoint preview into one commit, with selected-source key migration
validated through both App lock guards and the stable host proxy. It preserves
locked source carriers and unchanged keys, rejects edited locked targets and
unsupported derived/dependency publication, retains failed-commit previews and
reports post-commit display cleanup separately. Real-App acceptance, exact retry,
GUI Undo and shared API Redo preserve the point's signed zero and migrate/restore
the source key together. This is a numeric transaction prerequisite, not completed
construction source admission, public tools/editor, save/reopen or native acceptance.

Numeric initialization checkpoint: fresh digest-bound analysis corroborates the
two base-constructor `0x100` stores and shared upper-byte validity getter without
assuming that getter gates typed Apply. The shared new-numeric preview path now
seeds lines from finite Float32 scene bounds before typed writes; zero X span
leaves the cleared inner line and does not select the 10 mm fallback. Explicit
point inputs use the constructor word without inventing an inner-coordinate
default. Existing edits retain their actual prior state. Public source-bound
provider admission, controls and native Apply acceptance remain required.

Scene-bound scope checkpoint: the controller descriptor/table trace now reaches
base and concrete-model query candidates. Nine procedures/1,817 listed starts
and 260 direct flows are independently checked. Empty-box sentinels, valid-source
union, a special-source early return and ordinary collection branches are known.
Ordinary enumeration, source predicates/type exclusions/placement and special
backend records remain source-adapter prerequisites. No application operation,
catalogue or scene-admission policy changed; original runtime and full public
construction acceptance remain open. See
`docs/evidence/reference-scene-bounds-scope-20261025.json`.

Arc edit-route checkpoint: local matrix transformation now refits internal A/B/C
with stored placement and closure; collection rebuild always fits first three
records without clearing closure or consuming a fourth center target. Static
verification covers both wrappers; 144 focused tests and 29 real-kernel child
checks pass. These are internal prerequisites, not completed GUI/MCP operations.
Remaining work includes other curve-child editing, the authoritative ordered
source model, solver/trim/mirror integration, host session policy and shared
GUI/MCP publication with history, persistence and native/rendered acceptance.

Circle edit checkpoint: defining-point edits refit with stored placement; center
editing translates XY while preserving radius and reports no fit. Local matrix
transformation refits and retires the old backend even when flattening produces
a failed circle fit. Both use shared preparation and the existing child owner.
Circle radius/collection edits and other curve-child routes remain required,
along with the ordered source model, solver/trim/mirror, shared GUI/MCP session
policy, history/persistence and native/rendered acceptance.

Circle radius checkpoint: native magnitude/minimum-radius and distinct
middle-point squared-distance fallback rules now feed shared internal preparation
and child ownership. Radius edits preserve center/placement, resize directions
without fitting and rebuild the backend. Circle collection edits and remaining
curve-child operations still precede coherent source/editor integration. This
checkpoint adds no public GUI/MCP capability and closes no acceptance gate.

Circle record checkpoint: local replacement now distinguishes strict near-point
XYZ center translation from first-three refit; collection rebuild always refits.
Both use shared internal preparation and child ownership, with canonical bounded
record admission. Placed-record editing and remaining curve children still
precede coherent source/editor integration. Existing public GUI/MCP contracts
remain unchanged and native/rendered acceptance is not closed by these checks.

Placed-circle checkpoint: supplied-frame world comparison now selects either
fourth-center inverse conversion and XYZ translation retaining stored placement,
or first-three refit adopting supplied placement. Static slot/body verification,
analytic arithmetic tests and real-kernel ownership checks cover the internal
operation. Remaining curve-child models and the ordered source/editor/session
integration still precede public GUI/MCP authoring and acceptance.

Staging integration checkpoint: the ordered-model audit in
`docs/SKETCH_MODEL_INTEGRATION.md` maps existing graph/source/worker/history and
GUI/MCP boundaries. Conic child copies now preserve latest preparation/outcome
separately from the actual retained backend, avoiding refitting failed source
records or resurrecting an empty backend. Independent ownership and failure/
cancellation cleanup support the future common editing transaction. This does
not complete persistence, worker sessions or public authoring.

Ordered ownership checkpoint: `SketchChildCollection` now derives source stores
from current ordered child state, retains owner/child placement separately and
feeds shared construction picks. Atomic ownership transfer, exact reorder,
retired-child handoff and independent partial-copy cleanup are covered by generic
and real-conic tests. Missing curve geometry, controlled shared editor/session
mutation, history/project persistence and public GUI/MCP acceptance remain open.

Staged ownership checkpoint: collection `stageSplice` now admits one independently
prepared pending replacement, exposes a detached preview and atomically accepts
only against the unchanged local revision. Stale/cancelled/discarded candidates
are retired; admission failure leaves caller ownership intact. Accepted prior
children remain alive for caller history/disposal. This is application policy,
not native acceptance evidence or a public session transaction. Shared document
revision/retry/lock/lease/history/persistence and GUI/MCP acceptance remain open.

Ellipse collection checkpoint: recovered collection fitting now retains complete,
incomplete and early-failed source states alongside a separate real ellipse
backend. Child records preserve authoring-axis order even when backend radii swap.
Independent copying and ordered staged replacement preserve older valid edges
after early failure. Other ellipse edit routes, remaining line/spline children,
authoritative model/solver/history/persistence and GUI/MCP activation remain open.
This checkpoint is not full ellipse authoring or native acceptance.

Ellipse edit checkpoint: point handles now preserve strict movement and inclusive
radius thresholds, direct component division, XYZ center/axis semantics and
no-change outcomes. Placed replacement separately retains incomplete inverse
records and only adopts supplied placement after successful fitting. Both use
the same child/backend/staging lifecycle. The observed transform slot delegates
regeneration only; outer transform, other settings/routes, native validity and
full public GUI/MCP editor acceptance remain open.

Line-state checkpoint: collection first-two XY and local/placed first-last XYZ
preparation now preserve proposed fields independently of retained child records.
Success finalization takes the backend midpoint and publishes two flattened
endpoint sources. Static tracing identifies a second-provider body/first-edge
success gate after kernel geometry construction. The concrete backend, midpoint
provider and owned line child remain open; edge existence alone must not
substitute for native success. Endpoint edit/recovery preparation now preserves
the native old-start/old-start fallback, and affine endpoint transformation keeps
stored placement separate. The concrete attempt sequence, cache lifecycle and
public acceptance remain open. Static imports plus passive metadata establish
analytic line/wire-body calls and observed 0.001/1000 scaling. Subsequent static
tracing resolves the caller's tolerance, disjoint/general/checking and returned
array options, plus the separate sequential-mode field. Cross-kernel failure
equivalence and single-line degenerate topology still need validation; the
wire tolerance is not a proven minimum admitted length.
No GUI/MCP capability is activated.

Primary line-curve checkpoint: `SketchLineCurve` constructs and owns the real
trimmed analytic edge, evaluates normalized parameters and retires temporary
handles on all checked exits. Its explicit curve-only result is not native
backend success. The remaining composite body/first-edge and owned child
integration are still required, along with shared GUI/MCP and native acceptance.

Line conversion-parameter checkpoint: the primary edge now supplies actual
evaluated endpoints to a shared helper that preserves the recovered two-step
normalization, inclusive 1e-8 source-length admission, explicit coordinate
scale, signed zeros and interval arithmetic. Parameter preparation is tested
through the actual bundled kernel, but does not substitute for provider body
allocation, topology/attachment/check outcomes or first-edge admission. Those
remain required before the concrete line child and shared GUI/MCP publication.

Line attachment checkpoint: verified six additional static procedures and the
complete direct-flow graph of the fresh-curve edge attachment helper. The latter
links geometry/owner records and normally succeeds without a length comparison;
this does not prove later body acceptance. Next resolve the wire constructor's
post-construction repair/check status and cleanup paths, then implement the
equivalent body/first-edge stage and owned child. No application behavior or
public GUI/MCP operation changed. Evidence is recorded in
`docs/evidence/reference-sketch-line-attachment-20261024.json`.

Wire-check checkpoint: implemented the recovered inclusive vertex-overlap
calculation with explicit resolution and per-vertex tolerances, including the
half-resolution fallback and squared-distance underflow. It reports only this
check, not body success. Static caller/status/cleanup tracing also distinguishes
coordinate-bound validation and separately owned shared-checker tail calls.
Remaining edge checks and runtime settings must be resolved before actual
body/first-edge admission, owned line child and public GUI/MCP integration.
Evidence: `docs/evidence/reference-sketch-wire-vertex-separation-20261024.json`.

Distinct-edge endpoint checkpoint: implemented strict per-coordinate zeroing
before the earlier endpoint separation check while preserving the separate
unclamped final wire check. Passive code/import/settings capture now establishes
the resolution, delta-zero threshold and coordinate-bound settings for one
verified native process instance; no universal defaults are inferred. Remaining
curve/endpoint validity, shared-vertex topology and full body/first-edge outcomes
still gate owned line-child and GUI/MCP integration. Evidence:
`docs/evidence/reference-sketch-edge-vertex-separation-20261024.json`.

Line endpoint checkpoint: fresh edge/vertex initialization and distinct open-line
topology are statically corroborated. Implemented the recovered analytic-line
point projection with explicit effective tolerance, strict residual zeroing,
inclusive squared comparison and detached results. Its direction is already
prepared and is not normalized again. Native unset tolerance selects a separate
per-thread setting; no value is guessed. Interval validation, coordinate bounds,
actual body/first-edge results and owned child integration remain open. Tests
are analytic, not native numerical or rendered acceptance. Evidence:
`docs/evidence/reference-sketch-line-projection-20261024.json`.

Parameter-order checkpoint: verified straight-line classification and forward
initialization, then implemented the strict oriented parameter-difference check.
Tests cover equality, signed zero, reversed order/orientation, subnormal spans,
adjacent large parameters, malformed values and canonical overflow. The native
protected-call wrapper and reentrancy/unset-parameter recovery remain distinct
from this pure result. Coordinate-bound dispatcher tracing now reaches its
edge-specific calculator; bounds/body/first-edge outcomes still gate owned
line-child and shared GUI/MCP integration. Evidence:
`docs/evidence/reference-sketch-line-parameter-order-20261024.json`.

Fresh-line bounds checkpoint: verified the cache wrapper's separately owned
calculator and its line/default-tolerance vertex branch, then implemented that
isolated box calculation. Strict extrema preserve first-coordinate signed zero
on ties; the initial X-maximum unset sentinel resets every bound to the second
point. Tests cover that asymmetry, ordinary/reversed/coincident vertices,
extreme finite coordinates, canonical validation and detached ownership.
Coordinate-envelope comparison, cache lifecycle, complete body/first-edge
outcomes and owned line-child integration remain required. Evidence:
`docs/evidence/reference-sketch-line-vertex-bounds-20261024.json`.

Envelope checkpoint: recovered and implemented the scalar box comparison with
explicit half-envelope/relative settings and native interleaved bound order.
Boundary and relative-tolerance equality pass; outside coordinates retain
`abs(1 - boundary/value)` division order. Detached diagnostics identify the first
failure. Tests cover all sides, equality/next residual, signed zero, underflow,
extreme finite values, historical-setting analytic fixtures and validation.
Complete body traversal, unavailable bounds, cache/metadata errors, body/first-
edge outcomes and shared publication remain open. Evidence:
`docs/evidence/reference-sketch-line-envelope-20261024.json`.

Endpoint-preparation checkpoint: corroborated the provider's line dispatch and
separate multiply/add evaluator, then connected that arithmetic to the real
primary-edge backend's internal prepareBodyEndpoints method. It returns detached
conversion/start/end data from actual edge queries and preserves the primary
edge across failed queries/overflow. Analytic binary64 fixtures distinguish
evaluation from scaled source coordinates. Actual kernel tests cover controlled
evaluations, cleanup, repeated retirement and disposal. The native end-first box
order remains explicit for future composition. No body/first-edge permission or
public GUI/MCP feature is inferred. Evidence:
`docs/evidence/reference-sketch-line-endpoints-20261024.json`.

Converted-wire candidate checkpoint: added an actual analytic wire/first-edge
owner with explicit semantic endpoint data and requested topology tolerance.
Low-level construction preserves a short interval rejected by the high-level
maker; actual kernel analysis and topology exploration verify the result.
Tests cover stored vertex coordinates, 3D/reversal/signed zero, short intervals,
canonical validation, detached ownership, all partial failures, cleanup causes
and repeated retirement. Kernel-reported tolerance floors do not replace native
semantic settings. Full native admission, owned line-child attempts and shared
GUI/MCP publication remain unfinished. Evidence:
`docs/evidence/reference-sketch-line-wire-candidate-20261024.json`.

Checked-candidate checkpoint: composed the recovered fresh-line scalar checks in
verified call order with five explicit settings and detached stage diagnostics.
Shared prepared-data validation is used by both raw and checked construction.
The actual primary-edge backend now prepares checked candidates, preserving the
curve on rejected queries/settings. Geometry rejection allocates no wire;
kernel rejection remains distinguishable after passed checks. Short intervals
continue to construct without substituting the kernel's reported tolerance
floor. Native global/recovery/status behavior, complete body/child acceptance
and shared GUI/MCP publication remain unfinished. Evidence:
`docs/evidence/reference-sketch-line-geometry-gate-20261024.json`.

Normal-return status/ownership checkpoint:

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

Owned line-child attempt checkpoint:

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

Composite line-resource draft checkpoint:

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

Fresh-line failure propagation checkpoint:

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

Fresh body initialization checkpoint:

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

Creation hook/notification checkpoint:

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

## Task 6: Dependency lifecycle and downstream use

**Files:** Modify `src/datum-dependencies.ts`, `src/object-operations.ts`, `src/ui/App.tsx`, `src/ui/DatumAlignmentTools.tsx`, `src/automation/datum-operations.ts`, `src/automation/workflow-operations.ts`, shared transform/delete/duplicate/export operations, sketch/pattern source adapters; extend object-delete, transform, dependency, export and sketch/pattern tests.

**Interfaces:** Construction recipes contribute explicit dependencies; graph-ordered reevaluation calls Task 2's resolver/evaluator. Accepted source mutations publish dependent geometry and history atomically. Transform/bake/duplicate/delete semantics must follow recovered native behavior.

- [ ] Recover specialized native propagation, transform, duplicate/delete, missing-link and export behavior before implementing each dependent path.
- [ ] Write red chain/cycle/source-edit/duplicate/delete/undo/reopen tests and format-specific export eligibility tests. Assert no dangling links or accidental STL/solid conversion.
- [ ] Implement shared operations and GUI/MCP downstream references for alignment and applicable sketch/pattern consumers.
- [ ] Route GUI `commit`/`updateSelected` and automation source mutations through the same graph-reevaluation transaction boundary. Change semantic movement target filters in GUI and MCP together; reference discovery in Task 4 alone does not authorize movement.
- [ ] Build; run affected integration tests and authorized rendered/native comparison with real scans.

## Task 7: Acceptance and final review

**Files:** Update `docs/NATIVE_REFERENCE_GEOMETRY.md`, `docs/AGENT_GUIDE.md`, `docs/MCP_ARCHITECTURE.md`, sanitized evidence and this plan's ledger.

- [ ] Verify every required mode against original-code outputs and native save/reopen, including prior-state and degenerate branches; retain precise evidence gaps if execution is unavailable.
- [ ] Verify GUI/MCP preview/apply/cancel/undo/reopen/downstream picks on the same real scan, and repeated resource retirement under approved caps.
- [ ] Run build, affected suites and required broader checks sequentially; report failures without conflating analytic/static/native/rendered evidence.
- [ ] Request one fresh-context review of the coherent patch, resolve actionable findings, and verify MCP coverage and documentation against discovery.
- [ ] Commit only intentionally owned changes after all required gates pass. Keep the overall reconstruction goal active for remaining milestones.

## Plan self-review

All design sections map to Tasks 1â€“7. Persistent values precede entity publication; source evidence precedes dependent evaluator/control behavior. Shared operations own GUI/MCP changes. Unresolved native semantics and rendered restrictions are explicit acceptance gates, not removed scope. The owner approved implementation; execution continues inline without another approval round.

2026-10-24 checkpoint: average wrapper guard verified by a passing build and
exact seven-file / 198-test run. Source adapters, host operations, native/runtime
and rendered integration remain unfinished. Task 2 is not complete. Evidence:
`docs/evidence/reference-empty-average-20261024.json`.

2026-10-24 Task 6 dependency-discovery checkpoint: validated common-source links
now enter the existing shared datum/landmark graph. Six new tests and 192 related
tests pass; ApplicationApi proves structured MCP discovery, blocked movement and
unchanged revision. GUI invokes the same operation. This is discovery only;
atomic source reevaluation and the remainder of Task 6 remain open. Evidence:
`docs/evidence/reference-dependencies-20261024.json`.

2026-10-24 Task 2 CAD pick checkpoint: the projected-snapshot axis adapter now
selects the nearest face before eligibility, with no retry; Float32 pick/sentinel
and finite initial distance rules are preserved. Twelve new cases and 166 related
tests pass after build. Actual provider projection/owner traversal, source refresh
and shared host publication remain open. Task 2 is unfinished. Evidence:
`docs/evidence/reference-cad-pick-20261024.json`.

2026-10-24 correction supersedes the CAD pick checkpoint above: keep projected
selection and provider-specific extraction separate. The earlier composition
assumed unverified provider correspondence and is removed. Pure selection plus
existing conversion/provider regressions pass191 tests in5 exact files after
build. No extent/provider completion is inferred. Task2 remains unfinished.
Evidence: `docs/evidence/reference-projection-selection-20261024.json`.

2026-10-24 Task 4 rendered checkpoint: actual WebGL plus ApplicationApi passes
seven checks in an isolated point/line fixture, including GUI/API picking, finite
extent, hidden/locked/clipped exclusion, semantic Fit and disposal. All current
build inputs match the successful pinned build. This closes the renderer-only
foundation evidence gap; mixed scenes, full React/editor wiring, native visual
comparison and complete construction lifecycle still precede Task 4/feature
completion. Evidence: `docs/evidence/reference-rendered-viewport-20261024.json`.

2026-10-24 Task 5 cache checkpoint: `reference-construction-session.ts` now reuses
the established evaluator with explicit numeric intent, detached cached Apply,
versions, 60-second renewal and stale/expired/consumed states. Fifteen new tests
and 181 related tests pass after build. This core owns neither host registration
nor display/timer resources. Authoritative token/source binding, API contracts,
preview ownership, lock/identity/history publication and the editor remain open;
Task 5 is not complete. Evidence:
`docs/evidence/reference-construction-session-20261024.json`.

2026-10-24 Task 5 model-binding checkpoint: the actual host snapshot now provides
a private token that survives selection-only API revisions and detects model,
precise reference recipe/state, project/history and saved-sketch changes.
Sixteen new tests and 97 related tests pass after build; cached Apply is blocked
before publication after a real source-carrier replacement. Buffer contents are
not copied/hashed; immutable publication remains required. Host registry, owned
preview/timer disposal, shared command/editor wiring and exact source/provider
resolution still precede public sessions. Evidence:
`docs/evidence/reference-construction-binding-20261024.json`.

2026-10-24 Task 5 owner checkpoint: staged edit publication and host-scoped
preview leases now compose the cache and model binding. Twenty-five owner cases
and four publication cases pass with 64 related tests after build; every owner
test finishes with zero timers. Failed cleanup remains owner-bound/inspectable;
committed Apply returns cleanup-pending diagnostics without duplicate publication.
Actual viewport callbacks, API lifetime/reciprocal admission, shared public
handlers/editor, source checks and complete native/rendered acceptance remain
open. Task 5 is not complete. Evidence:
`docs/evidence/reference-construction-preview-20261024.json`.

2026-10-24 Task 4/5 production cleanup checkpoint: reference displays now attempt
all retirement phases and preserve failed work for retry. Viewport replacement
retains staged failures and recreates retired displays; teardown continues and
retries pending reference resources. Seven new tests and 48 related tests pass
after build. Nine actual software-WebGL/API checks pass, including injected
replacement/disposal faults and renderer-count recovery. Full preview-owner
adapter/host/API/editor and native lifecycle gates remain open. Evidence:
`docs/evidence/reference-display-cleanup-20261024.json`.

2026-10-24 Task 5 production adapter checkpoint: owned semantic preview display,
global clipping, precise viewport inspection, stable App/React host callback and
API lifetime cleanup are now wired. Seven new display and three new lifetime
tests pass with 80 related tests after build. Eleven real React/WebGL checks pass,
including a real renewed 60-second timer and injected GPU cleanup retry. Public
session commands/editor, reciprocal preview admission, exact source/provider and
atomic model publication gates remain unfinished. Task 5 is not complete.
Evidence: `docs/evidence/reference-preview-adapter-20261024.json`.

2026-10-25 scene geometry bounds checkpoint: retained static analysis resolves
the point padding constant as promoted Float32 0.001 and confirms coordinate
rounding before padding. Line bounds use Float64 endpoint arithmetic, Float32
carriers and strict comparisons that retain the start value on ties. The new
internal `referenceGeometrySceneBounds` keeps these delegate bounds separate
from exact semantic bounds. Thirteen new cases and 148 related tests pass;
the production build and isolated real-App/shared gateway fixture pass. The
fixture verifies padded point-to-line seeding, cached Apply, GUI Undo/API Redo,
exact point bounds and disposal. Three unrelated navigation inputs changed
after the build; the browser input snapshot was stable throughout its run.
Whole-scene category filtering, placement and special-source bindings remain
unresolved, so this does not activate construction tools or complete Task 2/5.
Evidence: `docs/evidence/reference-scene-geometry-bounds-20261025.json`.
