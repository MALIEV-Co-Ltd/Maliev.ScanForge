# ScanForge shared application API and MCP

Fine ICP uses `registerFineAlignment` in the processing worker for both GUI and
`mesh_process`. Fitting uses bounded source samples and every target point;
independent final evaluation measures all eligible source points and separates
requested-overlap accuracy from whole-cloud error. The shared adapter supplies
an internal output placement for clouds so diagnostics describe the same composed
Float32 geometry that the datum executor publishes. Agents cannot supply that
internal placement. Mesh masks exclude hidden triangles through the same
`alignmentTriangleMask` helper used by the GUI. Existing job cancellation,
revision/retry fencing, preview publication and history semantics remain in use.
This adds accuracy parameters and structured results to the existing operation,
not a separate GUI or agent implementation.

Fine alignment target binding shares `registrationTargetPoints` between GUI and
MCP. Raw indexed meshes use referenced canonical vertices, preserving the complete
target surface point set without allocating repeated triangle corners. Unused
vertices are excluded and cloud/exact-CAD carriers retain their existing route.
The exact nearest-point tree stores Float64 subtree bounds to prune unmatched
regions; conservative workspace admission includes those bounds. Its public
`distanceTests` result makes direct distance work observable.

Scan screen selection is shared by GUI gestures and MCP `scan_select_region`
through `Viewport.selectScanRegion` and the existing asynchronous screen-selection
index. The gateway fences publication by owner/revision/cancellation and routes
the resulting original-slot mask through `WorkspaceHost.setSelection` and its
existing `SelectionSession`. The React adapter captures active clipping for the
job even while busy presentation temporarily disables editor handles.
`scan_selection_control` shares the editor's configuration, visibility and
selection-history functions, with admission through the gateway's existing busy
and lock checks. Configuration is exposed in snapshot settings for revision
tracking. These tools create no geometry-history entries and preserve the
existing bounded selection workers and leases. Computed geometry normals remain
separate from file-authored normals in import/digest acceptance.

New internal numeric drafts use `beginNumericReferenceConstructionPreview` with
the corroborated constructor state word. Points take explicit Float64 input;
lines require the caller's six-value scene-bound snapshot, validate its finite
Float32 carriers, seed the command segment, then apply typed endpoint writes.
Rejected typed endpoints retain that seed. The same host ownership, lease,
binding, cached Apply and disposal paths remain in use. Existing-object editing
must retain its saved prior state. No public construction tool is enabled by
this initializer, and scene-bound provider admission is still a separate gate.

The internal cached reference Apply helper now publishes numeric point/endpoint
recipes through `context.mutate` and one host commit. It copies cached geometry
and completion state without evaluating again. Required common-source identity
assignments travel as trusted `ModelCommitPolicy` metadata through the stable
React host adapter. Both App commit guards validate each assignment against the
deterministic missing key, require every other source field/carrier to remain
identical, and retain global collision and locked-target checks. Normal commit
calls retain their original argument shape and lock behavior.

This policy is absent from transport input schemas. Construction tools remain
unpublished: source-specific derived acceptance, dependency rebuild and the
common editor are still required. Numeric edits with dependent references fail
before publication; a failed commit retains the preview for retry. Successful
publication with failed display retirement reports cleanup pending and cannot
commit again through an exact request retry.

Reference preview admission is reciprocal. `ApplicationApi.requireReferencePreviewIdle`
checks the host-scoped session and renderer ownership, including failed retirement.
The executor applies it before admitting preview work; GUI scan, surface, landmark,
section and datum producers use the same boundary. Display publication rechecks
datum/scan admission without blocking owner-scoped clearing. Expired or stale
sessions retire before a competing producer is admitted. This adds no reference
construction transport command and preserves existing revision/retry guards.

## Workspace owner lifetime

The React adapter retains a single owner lease on the shared `ApplicationApi`.
Effect cleanup immediately disconnects calls, cancels active work and releases
previews. A synchronous effect setup can retain the same gateway before microtask
finalization, preserving revisions, object identities, artifacts and retry receipts.
An owner epoch fences earlier asynchronous results and artifact callbacks. True
unmount and explicit disposal permanently close the gateway; explicit disposal
remains retryable for failed preview cleanup. Owner leases are internal lifecycle
controls and do not add transport commands or bypass revision and request guards.

## Intent and scope

The shared restore worker accepts optional immutable shared chunk candidates
from a shared bounded weak registry. Successful restore and encoding workers
seed the same registry; encoder candidates are published only after file storage
completes, with cancellation, page-generation and lease fencing. Encoding registers
only complete immutable SAB views with canonical matching binary type and
little-endian bytes, using the actual encoded chunk hash. Ordinary buffers,
subviews and converted values are excluded. An operation-local list of at most
128 original SAB wrappers travels in the same structured-clone graph as the
encoding snapshot/transport. The worker returns validated hashes and source
tokens only; successful storage rebinds these to the original live wrappers.
Thus weak-cache reachability follows editor ownership rather than temporary
worker-returned wrappers. Malformed or sparse token replies fail before storage
or cache publication. It reads and validates the entire
incoming file even on a cache hit: matching streamed bytes borrow the earlier
backing, mismatches allocate an independent chunk, and the final SHA-256 remains
mandatory. Worker transport preserves SharedArrayBuffer backing without transfer
or detachment. Successful operations publish backing into the shared
128-entry weak cache; page exit clears it. GUI opening, MCP `project_import` and
`backup_restore` share this implementation, including ordinary-buffer fallback,
leases, cancellation and atomic workspace replacement. Public contracts remain
unchanged. This avoids overlapping duplicate decoded project backing during
reimport while earlier consumers or garbage collection still own the old buffers.

Fresh ASC preparation sets explicit solid green mode so imported RGB cannot mask
the requested default display. Shared project validation migrates only legacy
neutral/white point-cloud colors lacking an explicit color mode, covering JSON,
binary projects and backup history. Authored RGB bytes are retained. Shared
project import publishes through the guarded mutation context, fits after the
editor has published geometry, and awaits presentation; backup restore delegates
to that same operation. Native ownership transfers before camera/presentation
work, so later display failures cannot dispose the active restored CAD client.

Adaptive point display adds `pointAutoDensity` (default true) and `pointDensity`
(10–100 percent, default 100) to the existing shared `object_update` contract.
The inspector invokes this handler directly. Codecs, validation, workspace
revision keys and display preservation during modeling undo include both fields.
`AdaptivePointDisplay` updates a shader uniform from projected bounds with bounded
per-cloud CPU work and no source-buffer copies or index rebuilding. A deterministic
vertex-ID hash selects a stable nested sample again; the uniform screen-grid
refinement was reverted. Retained points render at their original positions.
No authored XYZ, RGB or hidden-index buffers change. Sparse and near-plane views
retain full display, as does Auto density off. Main
`viewport_get.pointCloudDisplay` exposes eligible counts, estimated sample counts
and `samplingMethod` (`stable-sample` or `full`). Compatibility fields
`cellSizePx` and `maxScreenOffsetPx` remain null and zero. Editing/picking/export
retain original coordinates. Adaptive display is a projected-bounds sampling
heuristic, not a spatial LOD hierarchy or a reduction in submitted source vertices.

Point-cloud display controls call `object_update` from both GUI and MCP.
`pointSize` (1–10 screen pixels) and `pointColorMode` (`source` or `solid`)
are validated display metadata, tracked by workspace revisions, saved by the
project codecs and preserved across modeling undo. `object_get` reports the
effective defaults of 1 px and source mode. The viewport changes materials
without rebuilding XYZ buffers; solid mode preserves authored RGB data and
deviation-overlay restoration.

Project encoding checkpoints completed compressed/raw payload batches through
the existing temporary Blob store at each 64 MiB pending boundary, before
encoding further chunks. GUI Save, automatic backup and MCP `project_export`
share this codec. The final batch can exceed 64 MiB by one payload; individual
compression output and private-context storage remain memory costs. Failed
checkpoints reject publication and leave existing backups intact. Container
bytes, public schemas, revision/retry guards and cancellation remain unchanged.

Provide semantic control of supported ScanForge modeling features through a standardized MCP interface while preserving the browser-local geometry runtime, existing editing semantics and unrelated work. The UI and agents share native CAD creation/rebuild use cases, geometry workers, validation and the project/history commit boundary. Existing GUI interaction code is retained; this integration does not relocate the entire React state tree or introduce a headless/cloud engine.

## Boundaries

The internal global-alignment query pool prepares immutable mesh targets once
when cross-origin isolation permits shared buffers and two CPU workers are
admitted. The first worker publishes prepared target carriers; the second
validates them and attaches local query scratch without rebuilding normals,
adjacency or the mesh index. Raw point indexes and query scratch remain local.
The existing 512 MiB admission, cancellation, leases and native-workflow gate
remain unchanged. This private worker protocol changes no advertised GUI/MCP
operation or schema. See [shared target evidence](NATIVE_GLOBAL_SHARED_TARGETS.md).

Source records and raw target membership are separate in that private alignment
protocol. The registration driver routes ordinary mesh evaluator children with
an empty raw-target ID list while retaining their complete source samples and
normals. Explicit ordered raw IDs preserve mixed-child inputs; point-cloud raw
routing is unchanged. Workers validate IDs and retain source identity through
raw-index mapping. The existing shared GUI/MCP kernel and feature gates remain
in place. See [native routing evidence](NATIVE_GLOBAL_RAW_TARGET_ROUTING.md).

`landmark_preview` and `landmark_accept` call the dialog's shared asynchronous
preview and synchronous commit operations through the stable workspace proxy.
Preview has API job admission, progress, cancellation and a revision check before
publishing state; acceptance revalidates geometry references and locks before one
history commit. Preview metadata is discoverable through `landmark_get` without
rescanning the selection mask. Discarding landmarks cancels only a matching
`landmark_preview` job and leaves other job ownership unchanged.

Indexed point-pair previews and paired `mesh_process` with `refineSurface: true`
share target validation, coarse registration, original-vertex seed mapping,
region growth, combined indexed target preparation and the bounded CPU refinement
worker. Target preparation retains ordered, separate vertex records across
objects and regenerates normals before query-tree construction. Results publish coarse
registration separately from refinement; geometry retains Float32 storage after
each applied stage. See the agent guide for supported target types and the native
alignment evidence for the remaining full-workflow verification gate. CAD fixed
targets acquire indexed face records through the existing browser-owned kernel.
Their positions and normals come from analytic D1 evaluation at cached UV nodes,
matching the original conversion rather than retaining tessellation coordinates.
The shared asynchronous preparation validates cancellation/revision across that
boundary and leaves the fixed entity, BRep and history unchanged. Kernel-ID-owned
records have an eight-entry/64 MiB cache and are removed on handle release.
The picked-point session owns a snapshot of its eligible scene targets rather
than unrelated hidden/unsupported geometry. GUI and `landmark_edit` begin default
to `visibleScene`; CAD precedes raw indexed scans, with stable scene order within
each category and the moving scan excluded. `fixedId` remains the point-picking
anchor. `targetScope: "fixed"` preserves explicit single-target refinement.
Scope edits invalidate preview without losing picks. Preview publication and
acceptance compare current eligible membership/order, visibility and geometry
against that snapshot. `landmark_get` exposes the effective ordered target IDs.

`src/automation/catalog.json` is the wire-schema registry. The official SDK server reads it for MCP discovery. `ApplicationApi` validates the same schemas before dispatch, tracks workspace revisions/retry receipts and owns transient jobs/artifacts. `operations.ts` resolves explicit workspace objects and executes existing domain algorithms. `use-workspace-api.ts` adapts the current editor state to that gateway and publishes mutations synchronously before returning revision receipts. The editor uses shared CAD creation/rebuild helpers and routes modeling undo/redo through the gateway.

`scripts/mcp-server.mjs` implements MCP stdio using the official TypeScript SDK, plus the authenticated loopback HTTP queue. It never runs geometry or accesses arbitrary user files. `browser-bridge.ts` pairs explicitly, fetches command envelopes and posts structured results. `AgentConnection` owns connection controls with credentials held only in memory. The connection remains mounted while Settings closes.

Topology-dependent GUI and MCP mesh operations share the processing worker's
optional persistent topology cache. IndexedDB stores versioned full-index snapshots
keyed by ordered source coordinates and weld tolerance, separately from project
and recovery data. Content changes select a new entry; invalid, expired, oversized
or unavailable entries fall back to normal analysis. The shared job diagnostics
report cache status. See [the agent guide](AGENT_GUIDE.md) for retention limits
and recovery behavior.

The bridge's session identifier explicitly identifies the owning browser; it is independent of MCP transport/session versions. Geometry remains owned by the browser workers. There is one admission lane, not a duplicate agent worker pool. Heavy tools acknowledge a job immediately; agents read status separately. Native handles never appear in tool inspection output.

The internal sketch arc backend is authored in `src/cad/sketch-arc-backend.ts`
and imports the shared reference numerical helpers. `src/cad/sketch-backend.ts`
exports it together with the worker-local `SketchConicChild` owner. Kernel
preparation compiles that entry with Vite into `public/kernel/sketch-backend.js`, a local classic-
worker bundle. The CAD worker loads it lazily through an internal factory;
`predev` and `prebuild` prepare it alongside the unchanged OpenCascade assets.
The offline build includes the generated helper in its ordinary asset manifest.
This introduces no worker message, advertised MCP operation, scene registration
or independent agent implementation. Child-session ownership, cancellation,
source/backend outcome publication and GUI/MCP authoring remain integration
requirements. Borrowed kernel handles stay inside their owning worker and expire
on rebuild or disposal.

`SketchConicChild` keeps preparation records, the last builder outcome and current
backend validity distinct. It owns a fresh arc or circle backend and returns
detached structured snapshots. An early arc fit failure can leave a valid old
edge, while a later backend rejection retires it. Malformed input and cancellation
observed before work preserve the staged child; cancellation observed after
synchronous kernel work disposes that entire child. This is application staging
ownership, not a native outer-editor rollback claim or preemptive WASM cancellation.
The existing `CadClient.reset` still terminates the worker and invalidates its
generation. No child RPC, scene publication, persistent model or MCP resource is
introduced by this internal class. The eventual shared editor must supply
revision/retry/lock/lease policy and integrate constraints, history and persistence
before any of this is exposed to users or agents.

The same internal owner supports local arc record replacement through the
shared preparation module. Its retained-geometry route skips fitting but still
rebuilds the backend and source records; snapshots keep fit status distinct from
the actual backend/build outcome. This changes no public request schema or
catalog entry. GUI and MCP integration must use the same explicit edit intent,
rather than translating all edits into a generic three-point rebuild. Cancelling
a future child session must retire that session's resources without resetting
unrelated scene CAD handles.

Placed arc replacement is a separate internal edit intent. It compares world
records using the supplied frame, then either translates from the fourth record
while retaining stored placement or refits the first three with the supplied
placement. The shared producer and child owner preserve these distinctions;
the public GUI/MCP editor must not collapse local and placed requests into one
generic fit. No new tool, resource or public frame policy is advertised yet.

Individual arc point edits also use an explicit shared intent: defining indices
0..2 refit while carrying closure, and index 3 translates local X/Y while
preserving existing Z and closure. The common worker owner applies the result
through its existing backend/cancellation path. The future GUI and MCP controls
must preserve that distinction from collection replacement; no public schema
or source-record inspection capability is introduced by this internal method.

Local arc point transformation and collection rebuild are also distinct internal
intents. Transformation applies a finite matrix to internal A/B/C, then refits
with stored placement and closure; collection rebuild always refits the first
three records and carries closure. Neither changes owner placement or uses a
fourth center target. Both reuse the worker child's backend and cancellation
ownership. Public GUI/MCP integration, schema, revision and session policy remain
required; these methods introduce no advertised operation.

Circle child point edits and local transforms likewise use shared internal
preparation. Defining-point edits refit; center edits translate XY, retain radius
and report no fit. Local matrix transforms refit with unchanged owner placement.
The child owner applies every circle backend request, including failed-fit
sentinels, using the existing cleanup/cancellation path. These are not public
operations; the ordered source model and GUI/MCP editor/session boundary remain
required before publication. Existing agent schemas and tools are unchanged.

Circle radius editing is another internal shared intent. It preserves center and
placement, changes defining directions using the native minimum-radius and
middle-point fallback rules, and issues a circle backend request without fitting.
`SketchConicChild.editCircleRadius` uses the existing staged ownership and
cancellation path. This does not add a public setting or tool; shared GUI/MCP
authoring, session policy and source persistence remain required for publication.

Local circle record replacement and collection rebuild remain separate internal
intents. Replacement with a fourth record and near-equal first three points
translates XYZ from the fourth center; otherwise it refits. Collection rebuild
always refits first three points. The shared child owner exposes both internally
through the same backend/cancellation lifecycle. Existing public GUI/MCP schemas
remain unchanged; placed-record and ordered-source integration are still required.

Placed-circle replacement now has a separate internal intent as well. It compares
records in the supplied frame, then either translates from the inverse-converted
fourth center while retaining stored placement or refits first three records with
the supplied placement. Translation reuses the local-circle XYZ state producer.
The child owner keeps backend outcomes and cancellation consistent. This does
not expose a public transform policy or tool; the coherent source/editor session
and GUI/MCP publication boundary remain incomplete.

Internal conic staging can now fork a child into a fresh independently owned
backend. It preserves a retained old edge separately from the latest failed-fit
preparation/outcome; empty backends remain empty. This supports future atomic
editing without global CAD resets, but introduces no public request or session.
The [ordered sketch integration audit](SKETCH_MODEL_INTEGRATION.md) maps the
remaining shared model, history and GUI/MCP boundaries and acceptance gates.

`SketchChildCollection` now provides ordered worker ownership and derives source
snapshots from live child preparation. Whole-child replacement validates before
ownership transfer, prevents cross-owner aliasing and returns retired children
alive. Staged copies own independent resources. Owner and child placements remain
separate in snapshots, which feed the shared construction-pick resolver. This
adds no worker RPC or advertised capability; shared editor/session, persistence
and GUI/MCP integration remain required.

`SketchChildCollection.stageSplice` now provides one pending worker-local
replacement with a detached preview, revision checks, boundary cancellation,
atomic ownership transfer and candidate cleanup. Its local revision is separate
from the public document revision. This adds no RPC, catalog entry or public
schema; `sketch_get`, `sketch_set` and `sketch_manage` remain unchanged. Common
editor retry/lock/lease/history and GUI/MCP acceptance are still required before
exposing this model. See the [staging contract](SKETCH_MODEL_INTEGRATION.md).

The ellipse child/backend now follows the same internal ownership boundary:
collection rebuilding preserves five authoring source records independently of
four backend records and the actual analytic ellipse edge. A staging copy can
retain the previous edge after incomplete/early-failed latest input. This is
internal worker support only; no ellipse command or new schema is advertised.
Point-handle edits and placed-record replacement now share that child lifecycle,
with structured no-change/backend outcomes and the existing staging checks.
Remaining edit routes, shared editor publication and GUI/MCP acceptance are open.

Line collection/local/placed rebuilding now has an internal preparation and
completion model that keeps proposed fields separate from retained source records.
Completion requires a real backend outcome and midpoint. The recovered line
backend also checks a converted body's first edge, so the concrete replacement
backend and owned line child remain open. This state-only helper changes no
public worker dispatcher, GUI action, MCP schema or agent workflow. Endpoint
edit preparation now retains the native failed-build recovery inputs and defers
the recovery build; affine transformation applies to internal XYZ endpoints
without changing stored placement. Admission and backend success remain distinct.
The future shared editor must execute the complete attempt sequence and expose
its diagnostics through the same GUI/MCP operation and history boundary.

`SketchLineCurve` is exported in the generated worker helper as an internal
owned primary curve stage. Its `rebuildCurve` boolean and parameter evaluation
do not constitute the native composite backend result, which also requires a
converted body and first edge. It adds no worker RPC or discovery entry. Shared
GUI/MCP publication remains gated on the complete body, child, transaction and
history/persistence lifecycle; agents retain the existing sketch contracts.
Static recovery of the provider's wire options does not change that gate.
Wire tolerance alone is not a proven line-acceptance rule; the shared backend
still needs verified topology/failure behavior before GUI or MCP publication.
The internal `prepareBodyConversion(scale)` query now derives analytic curve
parameters from evaluated primary-edge coordinates using the shared conversion
helper. It does not allocate a body, authorize midpoint publication or add an
RPC. Explicit scale validation and query-failure cleanup are shared prerequisites
for the eventual GUI/MCP operation; current agent contracts remain unchanged.
Further static attachment tracing changes no public contract. It narrows the
remaining body-admission investigation to later wire repair/check and publication
outcomes; successful fresh-curve attachment alone cannot authorize GUI/MCP
publication or child midpoint updates.
The internal vertex-separation helper now exposes the recovered inclusive
squared-tolerance comparison with explicit runtime resolution and structured
diagnostics. It is a shared backend prerequisite, not a public RPC or complete
body-admission operation. No GUI action, discovery/schema, shared executor or
agent usage changes until the full sketch workflow is integrated and validated.
The earlier distinct-edge endpoint comparison also remains an internal shared
prerequisite, with its separate explicit delta-zero threshold. It does not alter
the final wire check or expose a GUI-only action. Session-bound native setting
observations are evidence, not new agent settings or automatic defaults.

The shared analytic-line projection helper is also an internal prerequisite. It
requires explicit effective tolerance and residual threshold and returns a
detached projection or rejection. It is not imported into the worker or exposed
through a GUI action. Existing `sketch_get`, `sketch_set` and `sketch_manage`
contracts remain unchanged. Complete body admission and the approved shared
editor, history, persistence and dependency workflow must be integrated before
new reference-construction capability is advertised through GUI or MCP.

The same internal module now checks the ordinary nonperiodic line's oriented
parameter order with explicit parameters and orientation. Its structured result
does not authorize body or editor publication. No public schema, catalog,
executor, adapter or agent workflow changes at this prerequisite stage.

The fresh-line vertex-bounds calculation is a separate pure internal helper
with detached minimum/maximum coordinates and canonical XYZ validation. It is
also outside the worker and public operations. Final coordinate-envelope/body
checks, cache ownership and shared editor publication must be integrated before
this prerequisite changes GUI or MCP behavior.

The same bounds module now checks a canonical box against explicit coordinate
envelope and relative-tolerance settings. Its structured result includes the
half extent and first failing axis/side/value when outside. It remains outside
the worker and public contract until full body/cache/error handling and shared
GUI/MCP publication are implemented and validated.

The shared worker backend now prepares provider-coordinate line endpoints from
actual primary-edge evaluations through one TypeScript implementation. The
internal result contains conversion/start/end data, without a body or first-edge
success flag. Query failures preserve the owned primary geometry and retire
temporary kernel handles. The rebuilt helper is exercised by kernel tests, while
the public dispatcher, GUI actions and MCP contract remain unchanged. Converted
body admission and the approved shared editor are still required before agent
discovery advertises reference construction.

The shared worker entry now exports an internal converted-wire candidate owner.
It consumes prepared semantic endpoints and an explicit requested topology
tolerance, then owns an actual validated wire and first-edge handle. Borrowed
handles expire on disposal; snapshots are detached. Temporary and partial
construction handles retire before a result or error is returned, with cleanup
causes retained. The requested tolerance remains distinct from kernel-reported
tolerance. This is a resource primitive for the future shared operation, without
a GUI action, public worker RPC or MCP discovery entry. Native admission,
history/revision/cancellation integration and GUI/MCP acceptance remain gates.

The internal checked-candidate path now composes the recovered fresh-line scalar
checks through shared pure code and shared prepared-data validation. Explicit
settings and detached first-failure diagnostics precede any wire allocation.
The primary backend validates settings before geometry queries and transfers
ownership of a returned candidate to its caller. Results distinguish geometry
rejection from kernel construction rejection. These internal states do not add
public RPCs or discovery entries; native state/recovery and the shared document
operation still require GUI/MCP parity and acceptance before publication.

## Visual workflow

Visual workflow tools use the same host adapter: `workflow-operations.ts` exposes structured application observation, semantic UI/camera control, geometric picking, retained history and project naming. `application-observation.ts` inspects bounded visible accessible controls without credentials. `visual-capture.ts` renders the current WebGL frame synchronously, freezes its serialization during bounded local DOM capture and restores it in `finally`. PNG/JPEG results are stored as transient artifacts; the stdio adapter emits native MCP image content and metadata without repeating image bytes in JSON. Capture limits, redaction and browser-rendering limitations are documented in the agent guide. `session_get` recovers bounded job/artifact metadata; `tools_search` provides compact discovery without repeating full schemas.

## Mutation correctness

Automation transfer artifacts use the browser-owned Blob store with 64 handles,
1 GiB aggregate logical bytes, 1 MiB decoded upload chunks and a 900-second
inactivity lease. `capabilities_get` exposes all four limits. Appending replaces
the same handle's byte accounting; rejected appends preserve its previous Blob.
Expiry is swept before an append resolves its prior handle, so an expired upload
cannot revive retained content. GUI and MCP import the same File/Blob through the
shared importer; increasing transfer capacity does not bypass geometry admission.
The 1 GiB logical budget admits the full-history three-scan aligned project,
which exceeds the previous 512 MiB transfer limit. Existing Blob outputs are
retained without another byte-array copy. The separate 4 GiB validation-process
cap remains unchanged; logical transfer capacity is not a RAM guarantee.
Artifact reads convert bytes in bounded string blocks before base64 encoding,
avoiding a string node per byte across repeated full-project downloads. The
256 KiB read limit and byte-exact response format remain unchanged.

The shared background project encoder coalesces only concurrent requests with
the same immutable geometry/history identities and serialization metadata. GUI
Save, backup and MCP `project_export` consumers receive the same lossless Blob,
with independent cancellation. The underlying leased worker stops when its last
consumer cancels. In-flight keys use weak object identities and are removed on
completion. One weak reference remembers the last completed result for an
identical snapshot while another consumer still owns the Blob. It does not retain
geometry or file storage, and a collected result falls back to a fresh encode.

`prepareImportedScan` supplies the shared `placeAtOrigin:false` default for scan
preparation. GUI single/batch imports pass their Scan import checkbox; MCP
`project_import` and `project_import_batch` expose the same optional boolean.
The checkbox uses the shared `settings_set` operation and editor adapter;
`project_get.settings.importPlaceAtOrigin` exposes its current value. Omitted
import options capture that workspace preference once, initially false;
explicit booleans override it for the current import. Preference writes follow
revision/retry validation without creating geometry history.
File coordinates are preserved by default. Explicit placement translates XY bounds
to their center and the base to Z=0 after unit conversion, including indexed
companion vertices; normals and orientation remain unchanged. CAD/project inputs
retain their placement. Import publication, revision checks, jobs, cancellation,
retry receipts and per-file history still use the existing shared operations.

All public mutations require `expectedRevision` and `requestId`. The revision includes geometry identity, metadata, authoring, selection, model history and relevant settings. Computed `settings.scale` and `settings.effectiveGridSpacing` remain observable but do not advance the revision: camera/layout updates must not invalidate running geometry jobs. Authored grid and display settings still participate. A human action can advance it. Immediately before applying asynchronous work, the executor checks cancellation and whether the original revision is still current. Results that cannot be applied release newly owned native handles; previous model/history handles are preserved. Existing domain validation and lock checks run at commit.

Retry receipts are bounded to the latest256 requests and are transient. They prevent ordinary in-session duplicate writes, not crash replay. A changed request needs a new ID. Project imports restore exact bodies in a separate kernel before atomic replacement; failed imports dispose that kernel. A cancelled native operation retains the admission lane until cleanup settles.

## Connection and resource ownership

The bridge requires a >=32-character operator-supplied token, exact approved origins and loopback Host. OPTIONS is the sole unauthenticated preflight exception and grants no access. One browser owner, 60-second lease, queue64, poll batch16, body/command2MiB, 30-second response timeout and eight-hour service lifetime bound the bridge. Closing stdio closes HTTP service. Browser disconnect/page exit requests active-job cancellation; every worker retains its existing cleanup rules.

`/connect` additionally advertises `capabilities.pollWaitMs: 8000`. A browser opts in only when that capability is a valid integer from 1 through 8000, by adding `waitMs` to `/poll`; the server accepts integers from 0 through 8000. Without the parameter, polling remains immediate for older clients. Browsers paired with older servers retain the existing one-second polling cadence. Public MCP tool schemas, revision/retry handling and command results are unchanged.

An opted-in idle poll waits for queued work, its requested bound or the current session lease, whichever comes first. There is one pending poll per owning session; a duplicate returns 409 and cannot steal work. Dispatch wakes the owning poll immediately, and the browser reissues after completed commands without the one-second pause. Unexpectedly fast empty replies have a 100 ms minimum cadence to avoid busy polling; a normal server-held idle response adds no extra delay. The browser keeps its 10-second HTTP request timeout. Abort/socket close, disconnect, session expiry and server close clear the waiter, its timer and listeners; undelivered commands remain queued when an aborted response cannot receive them. Existing queue 64, batch 16, authentication/origin checks, command deadlines and active-job cancellation remain enforced.

The API keeps at most32 terminal/running job records, latest256 retry receipts, and64 transient artifacts totaling1GiB. Artifact access checks a15-minute inactivity lease. No token/customer payload is stored in resource ledgers. The browser's normal IndexedDB backups and user project data are separate persistent resources.

## Implementation and verification plan

1. Define a shared schema registry, error/results contract, revision receipts, admission and bounded jobs/artifacts.
2. Bind existing geometry, CAD, sketch, surface, history and import/export services; resolve explicit object/feature references.
3. Add official-SDK stdio discovery/calls/resources and secure single-owner loopback pairing.
4. Integrate editor connection controls and shared use cases without replacing unrelated GUI work.
5. Verify schema rejection, retries, cancellation/stale-state rollback, ownership/security/lifecycle and actual SDK-to-browser modeling/export. Run build first, focused suites, application suite, native CAD suite, formatting and browser workflow.
6. Commit only the integration's files/hunks after validation. Do not deploy or push.

## Adding features

Alignment reference inspection uses `alignment-operations.ts` through the same
operation registry as other application commands. `alignment_references` is a
read-only native job, with the existing admission, revision and cancellation
contract. Exact CAD inputs are transported by the owned kernel worker; fitted
metadata follows the native reference adapter. Semantic point/line entities pass
through `referenceDatumFeature` validation, then the same native datum adapter.
Line midpoint evaluation retains its original arithmetic order; nonfinite
derived values are rejected before publishing a reference. Stable semantic IDs
use the `/reference/point` or `/reference/direction` suffix and the
`referenceConstruction` source discriminator. GUI selectors use shared discovery
eligibility; both GUI and MCP bound alignment resolve these IDs again against the
current revision. Discovery does not enable reference movement or recipe
reevaluation. Public construction/import remains gated. The GUI properties panel invokes
this public operation and polls the job. No alternate GUI geometry calculation
is maintained. Fitted metadata participates in the revision identity, and CAD
face IDs/triangle ranges belong to the current body revision. Inspection is
paged and bounded; unsupported reference types remain explicit. Full alignment
preview and geometry application are still separate unfinished capabilities.

Manual scan-frame alignment now uses `datum-operations.ts` for both GUI and MCP.
It resolves ordered numerical constraints with the recovered constructors,
applies their rigid inverse to immutable scan copies, and preserves indexed
topology and selection identities. Preview is transient presentation through
the editor adapter; committed project reads remain unchanged. Apply presents
the prepared geometry, checks cancellation/revision, then commits once.
Exact CAD targets are explicitly rejected. The preview-discard target `datum`
shares the existing cancellation/reset contract, and viewport inspection reports
the transient scene. The complete native dialog and automatic bindings remain
separate unfinished work.

**Mandatory repository rule:** every application change must also be available through MCP for agentic work. GUI and MCP must use shared application operations with consistent inputs, validation, errors, state transitions and results. Missing MCP parity blocks completion and commit; it must be addressed in the same coherent change. Existing tools may satisfy the rule when they fully expose the changed behavior. See the authoritative [repository instructions](../AGENTS.md) for scope, documentation and validation requirements.

Add a complete input schema and accurate description to the registry, then an operation handler using existing/new domain services. Use explicit IDs and units. Place all asynchronous mutation checks immediately before the first state write; do not compare the start revision again after your own successful commit. Construct required artifacts before commit so resource-limit failures cannot report a failed command after changing the model.

New native outputs must be released on cancellation or rejected commit. Never release handles referenced by the current model or history. Add contract/rollback tests and a browser workflow where the feature changes native or rendered state. UI and agent call sites must share the use case. Keep unsupported features out of discovery until their implementation and tests exist. Document limitations before marketing full autonomous coverage.

Remote MCP, OAuth, persistent automation receipts, headless runtime, stable topology naming and workflow batching are future independent capabilities; none is implicitly enabled here.

Browser recovery uses the shared `backup_list`, `backup_restore`, and `backup_delete` operations. The GUI dispatches restore/delete through the same revision-guarded application API as MCP. Restore delegates to the existing validated project import path and carries the backup's stable project identity through atomic CAD/history replacement. The React backup adapter owns a 30-second interval writer and serializes deletion after active writes, suppressing future writes for deleted identities. IndexedDB holds one binary snapshot per project with an optional small WebP viewport image; the list operation exposes images as existing application artifacts. Project import/export carries the optional identity in the binary manifest without breaking older files.

The interval writer compares weak identity tokens rather than retaining saved
geometry and history. Document replacement updates its pending snapshot immediately
for both GUI and MCP operations; it does not wait for the next backup interval.
An active write retains its own snapshot until it settles. Stopping the writer
releases its pending snapshot and change-detection records.

The shared binary decoder decompresses directly into final readonly shared
backing under cross-origin isolation. Incremental SHA-256 verifies those bytes
without a private full-chunk copy; typed geometry views borrow that backing.
Nonisolated decoding keeps ordinary buffers. This removes the former simultaneous
private decoded chunks and shared publication copies without changing formats,
validation or the public GUI/MCP restoration contracts.

Large encoded containers and accumulated MCP uploads use the shared transient
IndexedDB Blob boundary (`transient-blob-storage.ts`). A committed write followed
by a read-and-delete transaction returns immutable browser-owned disk backing;
no persistent record owns a successfully staged file. Uploads checkpoint each
64 MiB growth boundary and recheck artifact identity, disposal, expiration and
quota before publication. Concurrent append/delete cannot overwrite a changed
upload. Failed transactions preserve the previous artifact. Interrupted records
have 15-minute expiry and are swept on later staging. Open/transaction deadlines
are 30 seconds; encoding cancellation also aborts storage work. GUI Save, backups
and MCP export share this encoding boundary; no public schema changes are needed.
Disk-backed validation uses the isolated persistent default browser context.
Playwright `browser.newPage()` creates a private context, which keeps Chromium
IndexedDB Blobs in memory and cannot establish the persistent-profile memory
bound. The private-context failure remains separate evidence rather than being
relabeled as a passing normal-profile run.

Origin/reference scan alignment carries optional frame-basis XYZ translation in its shared preview/apply schema. The GUI submits the same offsets as MCP. The frame compiler applies the recovered native callback arithmetic before rigid inversion, and the output reports the offsets and matrix. Native replay checks 1,014 complete callback outputs; UI data exchange and window notifications use fixture adapters, while numerical instructions remain original.

Bound datum constraints resolve through the same `alignment_references` handler used by GUI inspection, rather than trusting copied UI coordinates. Within an alignment job, each unique source object/centering input is inspected once, with strict workspace revision and cancellation checks. The compiled manual and bound forms share the original constructor/inverse path. GUI selectors use bounded paged read jobs; source objects remain unchanged throughout preview and application.

The viewport pick callback includes an optional original triangle slot, remapped through display triangle slots when present. Origin/reference face picking consumes that slot without changing the selected moving scan. The shared read-only `alignment_references` operation resolves it against exact kernel face tessellation ranges; MCP uses the same lookup after `viewport_pick`. The GUI retains cancellable, bounded inspection jobs and reports unsupported surfaces rather than fabricating a plane from tessellation.

Datum scan transformation now follows the original mesh vertex and triangle-normal worker arithmetic, including signed-zero preservation. The shared Apply no-op decision uses the recovered original source-frame identity predicate at zero tolerance. Native fixtures cover worker output independently of scheduling; CPU-pool integration for this transform remains separate from the existing refinement pool.

Spacebar and the MCP `command_run`/`command_repeat` launchers share an in-memory command identity registry. React refreshes the callbacks each render so repeats use the current selection/settings. `command_get` and application inspection expose the repeat target and availability. Launchers pass the normal revision, retry and busy admission checks, then delegate progress/busy ownership to the launched GUI/domain operation rather than installing an API job that would block it. Launch acknowledgement is explicitly separate from asynchronous modeling completion. File, deletion and history actions are excluded from tracking; active dialogs and previews reject repeat launches.

The shared datum operation owns one bounded transform executor per job and closes it in `finally`. It transfers copied chunks to two physical workers, restores outputs in input order, and reuses those workers for expanded coordinates, indexed vertices and normals. Native arithmetic lives in a dependency-free kernel shared by serial and worker execution. Every chunk yields control for cancellation, and the operation checks revision before its one model commit. The executor reports bounds while processing chunks, avoiding a second full main-thread bounds traversal. Source buffers are never transferred or detached. Temporary task memory is bounded by chunk size rather than scan size; destination model arrays still require storage proportional to geometry. Pool lease is three minutes, each task has a 30-second timeout, and idle workers expire after 30 seconds. GUI and MCP expose the same `parallel` option and execution diagnostics.

Identity frames bypass coordinate transformation and output allocation before the executor is created. Their unchanged source bounds are scanned in cancellable chunks to preserve the result contract. Large nonidentity Float32 model buffers retain Float32 during copied-chunk transport; authored number arrays use Float64 transport to preserve their existing precision. Bounds and finite/range validation are fused with the transform pass, while numerical expression order and Float32 output storage remain native-compatible.

The shared datum result includes `cadMatrix`, reconstructed from the original exact-shape Apply path. Native replay covers 338 original placement matrices and real transformed CAD-face evaluations. Mesh/point-cloud execution continues to use the original scan matrix; the new witness does not bypass the exact-CAD target gate. Kernel placement, copy policy, preview leases and Undo ownership remain required before enabling CAD targets.

Indexed scanner `normals` and computed `geometryNormals` are separate optional
topology fields shared by GUI/MCP import, persistence and mesh processing.
`meshGeometryNormals` reads stored computed state or initializes it from validated
original geometry with the native angle-weighted producer. Publication adds a new
mesh descriptor without mutating existing entities. Datum staging, registration,
surface refinement and mesh transforms rotate stored computed vectors independently
of scanner attributes. Native source refinement and interactive mesh mirror sources
consume computed vectors; authored scanner values remain available separately.
Disposable rendering data borrows the computed Float32 carrier in indexed vertex
order. Worker transfer lists deduplicate shared aliases and exclude shared buffers.
`object_get` includes both fields in its geometry artifact, and
`object_geometry_digest` hashes each under its own path. JSON, streamed JSON and
binary codecs retain the optional field in current/history/future records.
Shared history activation initializes absent legacy computed fields before GUI
Undo/Redo, timeline selection or MCP history operations publish the restored
entity. It borrows existing geometry and creates a new descriptor, leaving the
retained snapshot unchanged. Later history steps retain that computed carrier.

# Landmark session edit boundary

`landmark_get` and revision/retry-protected `landmark_edit` call the mounted
editor adapter. The dialog and agent adapter use `editLandmarks` and
`landmarkState` from the shared alignment module. Original picks and committed
entities stay unchanged during preview; Reset drops the preview result, which
provides the same restoration outcome without cloning the original twice.
The API's existing admission lane serializes edits, and `preview_discard`
retains cancellation ownership. Complete native point-pair solving/acceptance
remains a separate gate.

## Native seeded region preparation

GUI Fine align and `mesh_process/nativeRefine` pass optional seed vertex IDs
through `nativeSurfaceRefinementRequest` to the shared processing worker. The
processing client clones/transfers the seed buffer without detaching scene or
caller data. `prepareNativeLandmarkRegion` uses indexed vertex/face incidence and
two reusable typed frontiers to reproduce the original reset, one-ring snapshots,
face-count stopping and flag preservation. It performs no vertex welding and
visits each eligible incidence at most once. Prepared vertex flags enter the
existing native controller in selection-only mode, preserving indexed order,
logical lane partitioning and ordered reduction. The bounded CPU pool is reused;
region preparation itself is currently serial within the processing worker.

The shared controller uses a compact source constructor for selection-only
inputs. It retains selected visible records in original indexed order before
the existing logical-lane partition. No independent agent implementation or
operation parameter is introduced. Supplied scanner normals are validated and
read in place; inactive coordinates, normals and flags are still validated.
Without supplied normals, the previous whole-mesh normal algorithm is retained.

### Internal Interactive display-source provider

The shared Interactive operation factory owns one bounded source/bounds/mirror pool per session. Its optional `installInteractiveMirror` host hook lends a session-bound backend to a display consumer; the consumer must not create another pool or detach author buffers. Source readiness and selected/hidden/visible-face summaries are available in the internal session result. Preparation validates session identity and unchanged author state before and after asynchronous work. Release invalidates borrowed providers and closes workers before clearing the host display. This remains internal integration groundwork: no public catalog operation or enabled GUI command is advertised until the complete shared workflow is connected and verified.

### Selection and processing activity

Synchronous `object_select` retains API admission ownership and retry/revision checks but does not call the host's processing activity hook. The React host flushes that hook synchronously; toggling it around selection caused two additional full UI commits per click. Geometry operations retain their processing indicator and cancellation behavior. GUI object-tree clicks and MCP selection share this change.

### Selection latency measurement

The [owner-scan browser replay](evidence/viewport-selection-performance.json) loads PLY scans 1 and 2, selects the second scan, and performs 20 alternating left/middle orbit starts with wheel zoom. Both runs use isolated Chrome at 1183x944 CSS pixels, device scale 2, and the same RTX A4000 renderer. Removing the two processing-activity commits eliminated the observed 71 ms long task; maximum measured frame interval decreased from 49.97 to 16.86 ms. Median and p95 remained approximately 16.7/16.8 ms. No browser errors occurred. This short replay establishes the selection improvement on this renderer; it does not establish the embedded browser's GPU configuration or all-operation responsiveness.

Validation for this slice: build completed with zero warnings/errors (`scanforge-2511c1d7efd74e46`); focused API/authoring/selection checks passed 97 tests in 11 files; the default suite passed 37,478 tests in 387 files, with 31 optional checks skipped across seven files. The focused checks cover unchanged revision/retry behavior and admission ownership without processing activity. Formatting, whitespace and the repository token audit passed. Temporary browser processes exited, and port 5173 continues serving the application.

### Interactive viewport display consumer

The viewport now consumes the session-owned mirror backend through one coalescing controller. It borrows immutable sources, serializes preparation requests, discards obsolete publications and retains source colors across ordinary culling-direction changes. Pose/reflection changes use GPU matrices. Clearing the display invalidates pending publication and disposes GPU state without taking ownership of the session pool. A failed request is reported once and is not resubmitted every frame. `viewport_get` forwards `interactiveMirror` readiness/failure diagnostics when installed; API contract tests cover pending and failed states. App/dialog/public-command integration is still gated and is not advertised as a finished workflow.

### Public Interactive session

The App now mounts the Interactive session store and viewport/mirror adapters, with one shared operation family for the dialog and MCP. The versioned operation receipts own admission and lifetime; the external store publishes constant-size pose/settings snapshots without root workbench processing toggles per edit. Begin creates the bounded source/bounds worker pool. Apply closes the session before the single authored-geometry commit; cancellation/editor disposal closes the same pool and GPU display. Launchers, imports, history, competing previews and selection cannot bypass active-session ownership. See [the public operation contract](AGENT_GUIDE.md#interactive-scan-alignment) and [native input/output evidence](NATIVE_INTERACTIVE_ALIGNMENT.md#public-editor-and-mcp-integration).

## Project restoration and numeric transport

GUI save/export, automatic backups and MCP project export use the same codec. Numeric encoding hashes canonical little-endian values incrementally in chunks of at most 1 MiB, then streams those values through gzip into Blob payloads. Content and identity deduplication, decoded bytes, project formats and restoration remain unchanged. The chunk limit bounds numeric staging only; retained output, browser compression storage and BRep text can still consume additional memory. Existing encoding cancellation, queue ownership and the two-minute worker lease remain in force.

In cross-origin-isolated browsers, the shared GUI/MCP scan importer allocates final indexed PLY/STL expanded positions and PLY corner normals in shared buffers before publication. Packed binary PLY also shares final indexed vertices, normals and triangle indices; the binary STL path shares its final indexed vertices and triangle indices. Computed geometry normals use the same immutable shared-storage policy and are borrowed by display data. Decoder scratch stays private, and the general PLY loader retains ordinary indexed coordinate buffers. Unit conversion and origin placement finish before publication. Published geometry is immutable. Speculative topology reports may borrow shared positions in their retained worker; before any later non-report operation, that worker copies its canonical source and rebinds cached source identities while retaining adjacency. Other processing requests receive private copies. Save/export/automatic-backup workers read shared storage without cloning those buffers. Nonisolated browsers retain ordinary buffers. Project format versions and tool inputs are unchanged; geometry artifacts expose the optional computed field.

Import and viewport-picking preparation share a counted priority lease. Queued and active picking jobs defer speculative topology; starting either priority task yields an unowned warmup, which can resume after all leases release. Optional warmup admits only sources whose 512-byte-per-facet reservation fits the existing 128 MiB scan budget; larger sources use explicit diagnostics or topology-dependent tools without starting speculative workers or retry timers. This reservation is a scheduling policy, not a process-memory bound. Foreground diagnostics and topology promised to queued processing retain ownership. Picking results, facet IDs and the shared GUI/MCP operation contract are unchanged.

Automatic backups borrow that lease during thumbnail capture and encoding. An incoming import or picking request cancels only the automatic attempt; it retains the previous backup and leaves the revision pending for a later interval using the latest session. Unmount and deletion cancel the automatic attempt too. Explicit GUI saves and MCP project exports retain their existing encoding and cancellation contracts. Actual storage/encoder failures still report errors; deferral is not recorded as a successful save.

GUI project opening and public MCP `project_import` / `backup_restore` use the same decoder boundary. One disposable worker decodes and validates the file and prepares current mesh display caches before publishing a replacement. Cancellation, worker failure and its two-minute lease preserve the previous workspace. Decoded worker-owned buffers transfer back; authored buffers in the existing workspace never detach. Large ordinary numeric arrays use internal Float64 staging packets with cooperative main-thread reconstruction. The encoder uses the same transport for save/export/automatic backup to avoid a synchronous structured-clone pause. This internal protocol does not change on-disk formats or public tool schemas. See [loading evidence and regression limits](PROJECT_LOAD_PERFORMANCE.md).

Reference construction persistence uses JSON wire version 3 and binary manifest
version 5 when any entity carries a construction identity or semantic reference
payload. Earlier formats remain readable. Exact Float64 geometry and Float32
retained records use explicit bit encodings; current, Undo and Redo states validate
their own construction-key uniqueness. Metadata validation precedes topology
normalization and binary materialization so forbidden fields cannot be silently
discarded. Ordinary keyed objects use the existing `object_get`, duplication,
history and file operations; duplication derives a fresh key through the shared
object operation. Revision tracking includes key and semantic-payload changes.

Semantic typed reference publication uses `createReferenceConstructionOperations`
from the shared executor. The GUI dialog sends the same `reference_construct`
Preview/Apply/Cancel commands as MCP; it stores only session identity/version
between requests. Existing cached preview ownership, exact model binding, atomic
mutation, one history commit, expiry and retryable display cleanup are reused.
The existing precise codec and viewport render the accepted semantic objects.
`decodeProjectFile` and its worker admit typed references with empty common source
sets plus a single-source stored-line midpoint in current/Undo/Redo states;
other source-derived definitions remain gated.
This is an application lifecycle result; source-provider/dependency integration
and native acceptance remain separate M4 gates.

`reference-midpoint.ts` is the narrow semantic source adapter and shared affected
reference planner. It admits one existing stored endpoints line with a saved key,
resolves its actual Float64 geometry and evaluates the existing native center
branch. Public `mode:"midpoint"` maps to an internal `center` recipe with one
active source; arbitrary CAD/scan/sketch source resolution is not implied.
New-point staging uses the recovered finite constructor seed only before a
successful evaluation; the sentinel is never a published fallback. Derived Apply
retains the source identity, marks staged state dirty and performs specialized
refresh, verifying its geometry still matches the cached preview. Numeric Apply
keeps its existing cached geometry, empty sources and retained line picks.

The planner discovers affected common-source dependents through
`datumEntityDependencies`, processes them in dependency order, checks finite
geometry, locks, cancellation, cycles and work admission, then returns detached
entities to the same one-commit mutation boundary. It never edits source objects
or assigns their already-required keys. Apply reports `refreshedEntityIds`.
An explicit semantic dependency guard rejects source deletion before ordinary
geometry-tool eligibility. Current transform and duplication admission is described
below; linked source deletion remains guarded. Workspace import validates supported
point/line recipes and their source/key bindings in each retained state; existing
codecs retain definitions, precise geometry and evaluation state. This application integration does not turn
the retained static native evidence into numerical/runtime acceptance.

`reference-transform.ts` supplies one eligibility rule and a small binary64 payload
transform for detached numeric points and empty-record endpoint lines. The GUI,
ribbon and `ui_set` share that eligibility; `mesh_transform` branches into the
same operation before sampled-geometry admission. A supplied row-major 3x4 matrix
transforms original point/start and raw direction components without normalization
or stored-length changes. The existing application XYZ-degree/positive-scale
conversion constructs that matrix; original-native toolbar conversion is not
claimed. The separate numeric definition is synchronized from the resulting
geometry, then the shared dependency planner refreshes descendants without
reevaluating the root. One guarded commit retains revision/retry, cancellation,
locks, history and persistence. Derived modes, retained inactive picks, frame
datums and semantic duplication remain gated pending their own policy and
acceptance. This introduces no separate agent implementation or CAD allocation.

`reference-entity.ts` supplies precise bounds, detached inspection and a shared
sampled-geometry admission check. Bounds reconstruct a line endpoint from its raw
stored direction and extent without normalization. `object_get` and `project_get`
use semantic counts and expose exact encoded values alongside readable geometry
and definitions. Geometry artifacts follow the same semantic branch. Inspection
reports saved source identities and record presence, without evaluating sources,
rewriting keys or inferring an outcome from the internal completion word.
Shared mesh-copy, sampling/editability, topology analysis and selection paths
reject reference sources and secondary targets before geometry work or publication.
Typed references and single stored-line midpoints use the shared import boundary;
unsupported source families and geometry operations remain gated.

`referenceEntitySummary` and `inspectReferenceEntity` share the same geometric
summary. `entityDisplayStats` projects those semantic counts and bounds for the
GUI without entering the mesh-statistics cache; semantic payload identity is a
memo dependency alongside kind and positions. `GeometryStatistics` and
`StatusMetrics` distinguish semantic reference counts from facets/scan points.
GUI selection sessions, brush activation and section calculation exclude these
objects using the shared sampled-geometry predicate. The existing interface
validator rejects sampled panels and brush/section modes before either GUI or
MCP `ui_set` changes state. API inspection remains the agent source for precise
values; no new tool or redundant statistics schema is needed.

`reference-display.ts` owns independent Points/Line objects in the viewport's
reference display collection. It has no triangle buffer, normals, BVH or element
selection index. Geometry changes replace and dispose only that display's GPU
resources; metadata changes retain buffers. Semantic Float64 bounds feed framing
and navigation, while local Float32 offsets are derived solely for rendering.
Canvas and MCP raycasts use authoritative world geometry and shared visibility,
protection and clipping rules. MCP hits identify semantic kind without invented
facet/cloud indices; decorative CAD edge children remain excluded. Visible locked
objects contribute to hit tolerance in both routes. The shared project import
gate admits typed references and the supported midpoint; broader native source
admission and original-native acceptance remain open.

### Connected Global Fine scan-set groundwork

The `refineGlobalScanSet` controller connects preparation, persistent native correspondence workers, sequential outer/local updates and two-stage complete scan-object assembly. It closes query resources before allocating application workers and returns staged results for the caller's later atomic publication. This controller dependency alone does not advertise a public operation; the bounded raw-mesh integration is described under [Public Global Fine Align preview boundary](#public-global-fine-align-preview-boundary). Existing shared datum/Interactive operations retain their compatible staged object setter. The admitted multi-scan controller explicitly requests background application for its smaller scans too, rather than inheriting the generic small-input serial threshold. Exact-CAD references and complete original-application parity remain separate gates.

Compact normal buffers are accepted by shared project validation and the existing point-normal consumer. Global scan-set application opts into Float32 normal storage; existing alignment callers keep their container defaults. Binary formats and public tool schemas are unchanged, and both JSON writers emit ordinary numeric arrays. The built-app regression imports an independent v2 Float32-normal fixture through GUI and MCP and checks identical exported normal bytes, including signed zero.

Private global evaluator targets pack ordered node memberships into one backing buffer. An explicit internal compact-bound policy can omit the retained per-face bound cache, but cached bounds remain the faster default. Prepared worker handoff preserves both representations without rebuilding topology. This changes no public GUI/MCP schema or command gate; conservative production memory admission remains unchanged. See [storage fidelity and the measured throughput tradeoff](NATIVE_GLOBAL_COMPACT_TARGETS.md).

Native alignment adjacency builders dispose their private directed-edge directory in `finally` after linking, including cancellation and failure. Authored and returned buffers remain intact. This internal lifetime fix changes no GUI/MCP operation schema or admission limit. See [native replay and resident-memory evidence](NATIVE_ALIGNMENT_SCRATCH_LIFETIME.md).

An explicit internal packed-node policy shares typed evaluator metadata and ordered memberships across query workers, with no cloned node graph in the prepared carrier. Workers validate that carrier and attach numeric traversal scratch. Graph storage remains the default; no public GUI/MCP parameter, command gate or admission threshold changes. See [packed-node fidelity and measurements](NATIVE_GLOBAL_PACKED_NODES.md).

Complete original vertex-normal captures now bind all three canonical owner STL source carriers to the same verified evaluator inputs. The existing alignment source-normal kernel matches those arrays without an implementation change. This adds verification evidence, not a public operation or full registration claim; GUI/MCP defaults and gating remain unchanged. See [source-normal provenance and the remaining controller boundary](NATIVE_GLOBAL_OWNER_SOURCE_NORMALS.md).

## ShrinkWrap shared operation

`scanTools/shrinkwrap` uses one geometry kernel for `mesh_process` and preview jobs. `bindShrinkwrap` resolves source/reference objects and visible selected or isolated triangle masks; public requests never supply internal geometry arrays. Re-polygonize retains its existing behavior. ShrinkWrap controls sampling, gap fill, organic continuation and additional offset independently, with source-fit and topology diagnostics.

The panel and MCP both invoke `scan_preview` create/compare/accept/cancel through `ApplicationApi`. One controller owns the disposable source/output pair; GUI cancellation, expiry, source/reference invalidation and API disposal release the same controller and the matching worker preview. Preview creation/comparison leave authored geometry and history intact; accept performs one guarded history write, optionally creating a new object. Comparison borrows source corners and indexes only the wrapped output, avoiding dense source adjacency. See [controls, lifecycle and validation](SHRINKWRAP.md).

ShrinkWrap self-intersection verification runs in the shared worker kernel before
a direct result or preview can be returned. Whole results audit all triangle
pairs; local results audit changed facets against the parent and expose that
restricted scope. Exact Float32 predicates, index-integrity checks, bounded
candidate work and cancellation apply identically through GUI and MCP. Audit
counts and scope travel through the existing processing diagnostics contract.

## Public Global Fine Align preview boundary

The earlier private scan-set groundwork now has a bounded public workflow for
2–32 visible, unlocked raw triangle meshes. The Global fine align panel and MCP
call `createGlobalAlignmentOperations` in
`src/automation/global-alignment-operations.ts`; they share the input factory in
`src/global-alignment-input.ts` and the existing scan-set controller. Point-cloud
and exact-CAD targets remain unsupported. Hidden objects are excluded from
implicit discovery; locks, hidden facets and incomplete raw meshes have explicit
failure reasons. This integration adds no automatic coarse placement and makes
no claim of complete original-application or browser parity.

`global_alignment_preview` owns preparation and publishes the complete staged
scan set through the host's preview display. `global_alignment_state` exposes its
settings, source IDs, preparation summary and structured convergence/coverage
diagnostics. A host-scoped cache retains the output for 60 seconds after solving.
`global_alignment_apply` validates identity, expiry and authored-source state,
then commits that exact output once through the existing history boundary;
acceptance does not rerun a time-dependent solve. Nonconverged output remains
inspectable and is explicitly presented as Apply anyway in the panel.

The factory applies finite Float32/absolute-value search-tolerance normalization
(zero permitted, omitted value 0.5 mm), preserves indexed inputs where valid and
prepares other carriers without detaching authored buffers. Its collective
512 MiB estimated preparation admission complements the unchanged downstream
query admission; it does not replace or lower it. Workers and temporary input
ownership retain cancellation and finite-lifetime cleanup.

The shared `prepareGlobalAlignmentInput` borrows validated stored computed normals
for both GUI and MCP. Its admission counts shared backing stores once and reserves
topology clones and a normal-derivation output only for indexed meshes missing the
field. A stored field needs no derivation worker. Missing computed fields are
derived in the existing leased worker and retained on new private acceptance
entities, so controller input release does not discard the original vector state
before staged transforms. Authored objects and scanner normal buffers stay intact.
Zeroed flag storage remains separately admitted per scan. The 512 MiB preparation
limit, downstream query admission and external 4 GiB validation-process cap remain
unchanged. Replacing a computed carrier invalidates the global preview guard.
The group command uses source mask zero and keeps boundary vertices eligible.
Its disposable input worker returns zeroed Uint32 flags through the existing
geometry contract, without building boundary adjacency. GUI and MCP use this
operation without a new tool or schema; `inputSummary.mask` reports zero.
Returned flags remain charged under the unchanged 512 MiB allocator scope.
Reservations keep existing authored carriers and prepared outputs, excluding
future derived outputs, with the existing 1 MiB runtime reserve. This is logical
buffer accounting, not a browser RSS or heap guarantee. The native command's
target-index stride of one is a separate field, previously misidentified as the
source mask. See `docs/GLOBAL_ALIGNMENT_SOURCE_FLAGS.md` for the correction.

The input-lifetime adapter checks the shared cleanup registry before input
preparation. `assertNoUnresolvedOwnedWorkers` retries exact retained handles and
rejects persistent unresolved ownership before deriving new normal buffers.
The registry remains internal: `global_alignment_state` does not expose its
pending handles, and `idle` is not a cleanup-completion receipt. GUI and MCP
receive the same failure through the shared preview operation.

Command-owned input descriptors are cleared in place after controller input
consumption, with an idempotent release-once fallback in `finally`. Authored and
otherwise retained geometry buffers are never detached by this release. This
reference-lifetime boundary does not certify garbage collection or decommit.

A fresh `global_alignment_preview` request is the public recovery attempt; no new
cleanup tool is introduced. `ApplicationApi` caches the original request promise
before job completion. While that request receipt is retained, an identical
`requestId` returns the same job receipt after failure instead of rerunning cleanup. A new attempt needs a new ID and
current revision; changed arguments under an old ID produce `REQUEST_CONFLICT`.
For an unresolved-stop error, `job_get` exposes `status: "failed"` and
`error.code: "OPERATION_FAILED"`. Cancellation and lease expiry request cleanup;
failed stop requests retain exact recovery ownership rather than proving exit.

Cancellation has an API busy-lane exception so `global_alignment_cancel` can
abort its owning preview job before releasing staged geometry and display.
An optional cancel `jobId` is matched against the active API job and the retained
preview's originating job before any abort, release or panel closure. This lookup
does not depend on the bounded job-receipt cache. GUI automatic cleanup uses that
scope and a component lifecycle generation; late responses and old panels cannot
cancel newer GUI/MCP work. Explicit unscoped cancellation retains shared-preview
semantics.
Failure, expiry, input invalidation, editor disposal and explicit cancellation
share release handling. Project geometry, settings and history changes invalidate
the cached preview; selection alone does not. GUI and MCP use the same revision
and retry guards and the same one-commit Apply behavior. See the
[public workflow](AGENT_GUIDE.md#global-fine-align-preview-apply-and-cancel).

Sketch Undo/Redo controls dispatch the existing `history_undo`/`history_redo` shared executor with explicit `scope:"sketch"`. The host's optional `stepSketchHistory(repeat)` adapter traverses only the current saved/legacy SketchUndo session inside the stable React proxy's synchronous flush. Its implementation does not reject API-owned busy state a second time; generic ApplicationApi admission enforces busy, expected revision, request retries and Interactive alignment exclusion before the write. Empty sketch history returns updated:false. Omitted scope retains the original model history handlers and response shape; history_get remains model history. Geometry/authoring ownership and source CAD remain unchanged.

### Analytic extrusion profile compatibility

`cad_create` and `cad_rebuild` accept the explicit `sketch-curves` profile discriminant. The shared parametric evaluator solves the inline sketch and emits an ordered exact line/arc descriptor to `CadClient.extrudeCurves`; the worker constructs analytic edges, checks the planar face and resulting prism, then registers the CAD body. The sketch GUI submits the same shared `cad_create` operation. Discovery schemas expose this variant. Existing `sketch` profiles continue through the sampled polygon evaluator, preserving historical geometry; no automatic migration changes saved recipes.

### Numeric reference editor initialization

`referenceNumericEditFields` prepares detached startup-mm/N6 editor values from
stored geometry. It separates point N7 pre-rounding from direct line endpoint
formatting, applies exact rational fixed-six ties-to-even formatting and then
the existing G15 exchange. Inspection exposes fields/encodings without changing
accepted geometry; preparation errors remain `editorInputsError` so finite saved
geometry beyond authoring bounds remains inspectable.

Numeric `initialize:true` is an explicit existing-edit Preview intent, exclusive
with replacement fields or source modes. It reads the accepted numeric object
server-side under the normal revision/owner checks; Apply still publishes only
the cached version. The GUI reads inspection fields, decodes their lossless
vectors and uses the same intent until a user changes a coordinate or picks a
replacement. No session is allocated merely by opening the editor.

### Located semantic line construction

Located semantic line construction uses the same preview/Apply boundary:
`buildReferenceLineDefinition` acquires ordered Float32 world picks from semantic
points or explicit fractions of finite semantic lines. It canonicalizes common
dependencies independently, preserving repeated records and their weighting.
`resolveReferenceLineSource` is shared by discovery, acquisition, admission and
refresh. The acquired fraction is not persisted or recalculated on source edits.
Inactive endpoint records remain data without active dependency links.

The default resolvers also consume validated current sphere/cylinder/cone primitive
recipes at output0. Sphere centers and the worker's finite cylinder axial segment
are application geometry authority; stale fit metadata and display classification
are not fallbacks. `cad_rebuild` marks every rebuilt CAD output as a refresh root
before staging reference descendants, including mixed point/line chains. Deep
locks, cancellation, admission and work limits are checked before the single
commit. Failure releases newly owned kernel handles while preserving handles
retained by current/history/future states. No imported/general CAD provider or finite plane extent is inferred by this adapter.
Cone endpoint order uses the explicit application mapping below; native controller
and whole-construction equivalence remain separate acceptance gates.

Cone recipes bridge the worker's midpoint to the canonical geometry converter
also used by native datum alignment. The converter accepts geometry fields only;
the adapter does not fabricate fit residuals. For unequal radii it chooses the
large-end base and a large-to-small input axis locally, then resolves the finite
small-to-large axis with the existing direct-source arithmetic. Inverted radii
change only that local normalization. Equal radii reuse the existing cylinder
path without an apex. The native helper's strict positive-taper contract and
original geometry oracles remain unchanged. Endpoint bounds and nonfinite
conversion failures reject before publication. This application recipe bridge
does not infer native class/owner or controller behavior.

Pair/average creation requires an existing line or an owned endpoint preview,
so the evaluator always receives real prior geometry. The operation retains
that prior for the exact successful preview version. Apply re-evaluates with
the same prior, avoiding an additional average projection of cached geometry
that could change binary64 bits. No caller-provided prior or default native
scene seed is introduced. Missing source keys on newly defined semantic
references remain invalid; the line slice does not weaken entity admission to
simulate a nonexistent legacy representation.

Public source intents admit at most 1,000 records per operation. Scene admission
and graph refresh use the existing atomic closure, cycle, lock, cancellation,
work and history checks. Omitted `sourcePicks` preserves accepted records;
explicit replacement resolves a complete acquisition list. Inspection exposes
lossless definition encoding alongside geometry encoding. Required retained CAD
and scan adapters and remaining primitive families are still release gates.
Current sphere/cylinder/cone recipes already provide analytic sources. Fit-only
sources without an admitted recipe/frame and internal sketch line providers
remain unsupported; internal sketch providers do not independently expand the
owner-approved input scope.

### Read-only coordinate acquisition

`reference_construction_pick` accepts only a cloud entity ID and original point
index. The shared operation checks visibility and `objectPickable`, resolves an
exactly identified point-cloud source through `resolveReferenceCoordinatePoint`,
then calls `bakeNativeMillimetreFloatPick` and applies
`roundTripNativePickedCoordinate` to each promoted coordinate. This second stage
models the native numeric-control exchange's 15-significant-digit decimal
format/parse, preserving signed zero. Native editor initialization's fixed-six
formatting is a distinct phase. The resolver validates source/index
structure and uses the authoritative `cloudPlacement` witness. Native placed
clouds transform only the selected triple through their stored pose without
reading lazy full world-position/normal getters. The API revision capture already
uses authoritative local cloud buffers and pose bits, so it preserves this
bounded single-point path.

GUI picking and direct MCP indexing use the same read-only operation and result:
world-mm position, lossless `positionEncoding`, acquisition family and explicit
numeric-only/no-dependency flags. The caller cannot supply acquired coordinates,
keys or provenance. This read creates no preview, history or source-key assignment.

Numeric Preview accepts `positionPick` or each endpoint's `startPick`/`endPick`
with only entity ID and point index, mutually exclusive with that typed field.
The same resolver/authorization/quantizer helper runs inside the existing shared
mutation revision guard. This avoids losing negative-zero bits through JSON
number arrays, without adding caller-written bits, opaque handles or TTL caches.
Read inspection returns `positionEncoding`; preview/get return `geometryEncoding`.
The GUI retains each intent and acquisition revision until that numeric field
is edited, and rejects stale acquisition rather than silently resolving a newer
source. Apply persists a detached numeric coordinate/endpoints definition with
no new source link or retained pick record; existing inactive line records remain.
The recovered
mm/N6 float-controller rounding is scoped separately from precise-double picks
and derived line records. Asynchronous CAD/original-mesh acquisition is separate
from this unchanged synchronous cloud path.

### Retained-job CAD and mesh coordinate acquisition

`reference_construction_features` and `reference_construction_acquire` are
read-only jobs in the existing serial API admission lane. Both are permitted
inside an owned reference preview and preserve its owner/version. Feature pages
default to 50 rows, allow at most 100, and return the captured `sourceRevision`.
Acquisition requires `expectedRevision` even though it is read-only, preventing
an old feature index from silently selecting a rebuilt source. Vertex,
edge-endpoint, edge-fraction and normalized-screen selection arms are strict;
caller XYZ, bits, handles, display-triangle indices and barycentric/provenance
fields are rejected by discovery and execution.

`reference-acquisition-operations.ts` owns source eligibility, worker queries,
camera witnesses and numeric preparation. `CadClient.referenceFeatures` and
`referenceCoordinate` return plain detached topology data and expose a read-only
worker generation witness. Exact CAD vertex/curve locations use direct fixed-six
preparation plus the existing G15 exchange, without point-editor N7. Screen
locations use `alignmentMesh` canonical geometry and server-resolved face ranges;
`resolveReferenceScreenCoordinate` consumes the captured camera, material side,
clipping state and hidden slots. Its declared arithmetic is world Float32 nodes,
double ray/triangle intersection and one Float32 XYZ before float/N6/G15 bake.
This is application canonical screen behavior, not a claim of native provider
intermediate arithmetic. Camera/clipping changes across awaits reject; later
camera-only changes do not invalidate an already completed world point. Raw
meshes use a matching original indexed carrier for vertex IDs and connectivity,
falling back to flat source records when no valid indexed witness remains.
Carrier choice is shared by feature pages, vertex acquisition and screen
topology; equal coordinates are never deduplicated by the gateway. The screen
work bound is checked before linear indexed-witness validation. Meshes expose
surface acquisition, not invented CAD
edge/face topology. Sampled-only sources reject. CAD hidden display slots cannot
be assumed to match canonical slots, so that screen case rejects with recovery.
The viewport adapter also rejects a mixed global-union/local-intersection clip
configuration rather than flattening those distinct predicates into one flag.

The generic `CommandContext` captures `startRevision`, provides an internal
`retainPrivateJobData` setter and an exact-command `getCompletedJobData` reader.
Private metadata lives inside the existing retained Job row, not another cache.
The acquisition handler stores a frozen three-number coordinate and immutable
source witnesses: Entity identity, geometry/carrier/recipe identities,
kernel/BREP values and CAD-client identity/generation. These are borrowed
references, never source-buffer copies. Checks run after every native await and
again when Preview consumes `{acquisitionJobId}`. Failed/cancelled work,
eviction, owner release/disposal and observed model revision changes clear the
private metadata so obsolete projects are not kept alive by job bindings.
Witness failure at reuse also clears its retained authority. The existing
32-job retention policy bounds successful-job lifetime; no new TTL is added.
The React host additionally observes committed entity/history/future array and
project identity publication after rendering. This internal boundary clears
private acquisition bindings even when replacement objects have the same wire
revision signature. Camera/UI-only renders do not trigger this effect or a scene
revision walk, and preserve already acquired world coordinates.

Only the small public acquisition result is cloned and recursively frozen.
`job_get`/`session_get` omit private fields; other job results and shared geometry
buffers retain their existing identity behavior. A public result alias cannot
alter the retained coordinate. Preview requires the exact successful acquisition
command, current owner/revision and source witness. The job identifier is never
stored in accepted geometry: numeric Apply remains source-detached and uses the
ordinary cached session/version, one history step and lossless geometry codec.

Local work budgets are 100,000 CAD topology visits/identity comparisons,
2,000,000 screen triangles and 32 clips, alongside the existing canonical mesh
cache/converter limits. The acquisition-only `alignmentMesh` option also checks
prospective canonical conversion against 2,000,000 triangles/6,000,000 nodes
before allocation and rejects oversized cached conversions. This whole-source
preparation guard is conservative even for a selected face; existing alignment
callers retain their original limits. These guards do not alter global
model/import admission.
Cancellation remains boundary-based: native queries settle and clean temporary
handles, then publication checks reject cancellation. Ordinary cancellation
never resets all source bodies. Browser GUI picking and MCP both submit these
shared operations; the host adapter contributes actual camera/clip capture,
not caller-authored geometry.

### Source-derived point adapter

`reference_construction_sources` is the read-only paged eligibility boundary for
both GUI selectors and agents, including the existing `midpoint` alias. It
returns revision-bound saved/provisional identity keys without assigning them;
edit-target self/dependency-cycle candidates are listed as ineligible. Preview
and discovery share one eligibility policy over `resolveReferencePointSource`.
The source-derived point resolver uses authoritative semantic points/lines,
validated current sphere/cylinder/cone recipe sources and explicit analytic
stored-plane-frame equations. Nonkernel, nonparametric planes with a valid frame
may retain fit diagnostics; those diagnostics are not the plane geometry
authority. A fit-only mesh without a frame is not a fallback. This adapter does
not infer direct native plane half sizes, general CAD extraction or retained
scan/sketch pick provenance.
Planes remain eligible for center selectors: the recovered plane-center origin
fallback preserves the entire accepted common set independently of evaluator
consumption and its fresh outcome diagnostics.

`reference_construct` builds source definitions server-side from
`sourceEntityIds`, through `buildReferencePointDefinition`. Selector requests,
canonical deduplicated common identities and evaluator consumption remain
distinct; no accepted-source count is borrowed from three-plane evaluation.
Caller-written keys, primitive snapshots, state words and raw records are absent
from the mutation schema. Existing numeric and midpoint request shapes remain
supported. The same cached-preview lifecycle owns versions, expiry, source/model
binding, exact Apply and retryable owner-scoped display cleanup.

The general staged lifecycle evaluates changed sources and descendants before a
single history publication. Accepted selected-source key migration uses the
existing trusted `constructionIdentityMigration` policy; only the missing key
can change on a locked source. Point finalization marks dirty state before the
specialized evaluator, preserving supported unchanged/fallback semantics rather
than forcing a clean word. Numeric-plane `datum_construct` edits and plane
`mesh_transform` now enter this boundary before publication, returning
`refreshedEntityIds` and fresh `evaluations` rows with entity ID, outcome and
diagnostics. Empty refresh arrays identify calls without affected descendants.
The source and complete admitted point closure share one model-history commit;
a locked descendant or failed staging preserves every prior entity and buffer.
Other future source writers must enter the same boundary rather than commit
independently. Fresh evaluation results remain separate from persisted
inspection, which cannot infer an outcome from a completion word alone.
History/project codecs validate supported definitions and identity links in each
saved state. Located semantic/recipe line records retain their integrated
acquisition/Apply lifecycle. Additional CAD/scan/sketch line-provider families
remain gated until their provenance and finalization contracts are integrated,
without placeholder Float32 coordinates or an unused authoring model.

### Shared STEP eligibility

GUI **Export STEP** and MCP `project_export` use `selectStepExportEntities` for the same exact-kernel eligibility and empty-result error. Geometry visibility defaults to visible objects; MCP `visible:false` includes hidden exact CAD. Scans and semantic/datum display objects without kernel handles are excluded rather than treated as CAD. Both paths pass the resulting kernel IDs to the same CAD exporter. Project and STL export policies remain separate; project export retains the full workspace and history.

### Shared sketch drawing submission

Canvas line, center/radius circle, three-point arc/circle and endpoint movement submit `sketch_draw` through `ApplicationApi`. The viewport retains snapped preview coordinates and raw input coordinates separately; only raw coordinates enter the shared operation. A gesture captures its revision at the first pointer/pick, including the first of three curve picks. Escape releases capture and drops pending input without publishing. App binds the callback to the public operation with that revision and a unique retry receipt; the viewport has no drawing publication path through the graph setter.

The executor reads the active draft and current grid settings, invokes pure `applySketchDrawIntent`, then publishes a changed result once through the existing `setSketch` adapter inside the shared mutation lane. The helper validates and detaches the input, grid-snaps raw UV picks, reuses the existing Sketch v1 drawing/solver helpers, and validates prospective local and world coordinates. Line automatic relations and tolerance are explicit request fields; circles/arcs preserve their existing construction semantics. Endpoint movement retains the existing temporary target constraint behavior. Admission bounds collections, reference/validation work and dense solver work before cloning or solving. `SketchDrawResourceLimit` maps narrowly to `RESOURCE_LIMIT`; all rejected attempts and no-op moves preserve draft/history. Cancellation/revision checks surround synchronous work; they cannot interrupt an in-flight solver.

The discoverable schema exposes each intent's meaningful parameters, revision and request ID. Results expose created identities, snapped inputs, grid settings and diagnostics; `sketch_get` exposes the resulting graph. GUI and MCP therefore share construction, defaults, failures and scoped history rather than exchanging a GUI-generated graph. Existing `sketch_set` remains the validated full-graph compatibility operation; panel intents use `sketch_edit`. Saved Sketch v1 and project codecs remain authoritative; this drawing slice adds no native clone or ordered-pick model.

### Shared semantic sketch panel editing

`sketch-edit-intent.ts` owns panel edit semantics in `applySketchEditIntent`;
`sketch-edit-operations.ts` reads the active draft and invokes it with the shared
cancellation/revision context. `sketch_edit` covers rectangle/circle presets,
plane/normal offset, point/segment/arc creation and field edits, construction
flags, geometry/relation removal, dimensions, relation addition and explicit
solving. Optional creation references use the same documented defaults as the
GUI; generated IDs belong to the operation. Numeric/topology edits preserve an
unsolved draft and do not invoke grid snapping or an implicit solve.

The helper validates immutable input/candidate graphs, UV/world bounds and
reference integrity. Geometry removal uses the existing dependent-reference
pruning policy; presets preserve placement and extracted scan references.
Results enumerate created/removed point, curve and relation IDs, `changed`, and
optional solution/profile data. No-ops preserve input identity and skip the
publisher. Changed results call `context.mutate`/`setSketch` once for one scoped
edit, preserving model history and CAD geometry. The GUI submits these intents
through its `onEdit` binding, holds a synchronous pending guard and disables
controls until the request settles; its standalone component fallback uses the
same pure helper. Public callers need not reproduce GUI graph constructors.
`sketch_set` remains available for explicit full-graph compatibility replacement.

Semantic edits have local 2,000,000-reference-coordinate and
2,000,000-validation-work budgets. These are operation admission limits, not new
project/import collection caps. Explicit solve paths also use the common solver
budget below. Invalid requests, stale revisions, cancellation and resource
failures occur before publication.

### Bounded solver and diagnostic work

`sketch-solver-budget.ts` supplies a typed `SketchSolverResourceLimit` and local
budgets of 262,144 estimated live numeric cells, 2,000,000 cumulative solve work
units and 2,000,000 validation work units. Preflight includes validation and final
Jacobian/rank work, including the quadratic per-column variable-vector copies
even when residuals are empty. Each actual dense iteration charges the same
cumulative budget before allocating its Jacobian/normal/augmented matrices,
reserving enough work for final diagnostics. An already-satisfied graph does not
pay hypothetical dense iteration work. The guard applies to `solveSketch`
callers, including drawing, relation edits, read-only `sketch_solve`, solved
`sketch_set` and parametric sketch evaluation. API error mapping recognizes the
typed class with `instanceof`; arbitrary backend `error.code` values are not
trusted.

`inspectSketchDiagnostics` is a nonthrowing read-only wrapper returning either
`{available:true,solution}` or
`{available:false,code:"RESOURCE_LIMIT"|"INVALID_SKETCH",message}`. The panel
displays that unavailable state instead of allocating an oversized solver.
Large admitted graphs remain readable/serializable and can be replaced without
solving; neither project admission nor `sketch_get` runs an automatic solve.
Synchronous solver work cannot be interrupted mid-iteration; existing checks
surround bounded computation and prevent rejected publication.

### Atomic sketch constraint application

The sketch panel's Add constraint action submits `sketch_edit` with
`kind:"constraintAdd"`. The server assigns its ID, captures current coordinates
for a fixed relation, validates and solves the candidate, and rejects conflicts
before the one `setSketch` publication. Revision checks, retry receipts and
per-sketch history remain shared with MCP. Explicit `kind:"solve"` preserves the
existing partial-solution behavior when not converged; its returned solution
reports that state. `forProfile:true` additionally requires convergence and a
closed analytic profile before publication, returning the profile for the
separate CAD operation. Full-graph `sketch_set` with `solve:true` retains atomic
solved replacement; omitted/false `solve` retains unsolved replacement. Symmetry
is persisted with its construction-axis reference and explicit endpoint
correspondence. No separate agent solver is introduced.

GUI extrusion requests `cad_create.selectCreated:true`; selection is published inside the shared operation before job completion. The GUI completion poll only reports errors and performs no later selection mutation. The optional flag preserves existing selection defaults for agents.

### Construction sketch display

The viewport separates ordinary and construction line/arc display batches.
Construction batches use dashed materials and per-primitive normalized line
distances; their source remains the same shared Sketch v1 returned by
`sketch_get` and edited by `sketch_edit` or full-graph `sketch_set`. Construction
flag changes use the semantic edit operation. Point-relation markers include
symmetry references; solver diagnostics remain authoritative for local DOF when
available.

`settings_set` additionally exposes Boolean `sketchControlPoints` and
`sketchMeshPoints`, both initially true. The panel checkboxes invoke that same
operation and the stable host setters; `project_get.settings` returns current
values. The viewport derives defining-point and extracted scan-reference point
visibility from those flags. These session view preferences add no geometry
mutation, source-buffer copy or model-history entry.

### Shared sketch corner edits

`sketch_corner_trim` reads the active draft, invokes the pure two-line intersection helper, checks cancellation/revision and publishes through the existing `setSketch` adapter only when changed. GUI endpoint selectors dispatch the same operation. Discovery exposes both segment references and endpoint choices; structured results identify the shared intersection point. Constraint and shared-endpoint dependency failures occur before publication, preserving the draft and both history scopes. No-op joins do not call the adapter. The helper preserves source geometry and metadata without invoking a second solver or mutating CAD bodies.

### Bounded read-only geometry verification

`object_geometry_digest` is a discoverable read-only asynchronous operation over the existing host snapshot. It reuses the project codec's 1 MiB canonical numeric byte generator with incremental SHA-256, validation and event-loop yields. The API job lane, cancellation signal and revision checks protect its lifetime; no geometry artifact, full-array JSON copy, new worker or editor mutation is required. Results enumerate numeric display/indexed/cloud carriers, canonical encoding and local backing aliases. This exposes full-resolution content verification to agents while keeping exact CAD/authoring metadata outside the stated digest scope.

### Global alignment controller receipts

The shared global preview inspector exposes copied outer state matrices, order and controller-issued application stages through the existing preview job, state and Apply contracts. It uses the existing `cloudPoseBits` encoder for exact little-endian Float64 receipts, including signed zero, with explicit row-major 3x4 format and millimetre translations. No separate MCP solver or geometry path is introduced. State matrices precede gauge inversion; applications retain controller order while the existing geometry executor groups two stages per object and preserves intermediate Float32 rounding. Apply returns the staged receipt and adopts its cached geometry through the existing guarded single history commit. A composed transform is not an exact replacement for staged setter execution.

### Shared paint-trim gestures and projection receipts

`sketch_trim_stroke` awaits the bounded analytic helper with the shared operation context's signal/check, checks again before publication and calls `setSketch` exactly once only for changed output. The GUI preview uses the same helper over the original immutable draft, with one active/latest-pending preview, abort/generation guards and no authored publication. Pointer release discards display preview and invokes the shared executor with the revision captured at pointer down; the generic UI helper that refreshes revisions is intentionally not used for this gesture. Existing retry, busy, ownership and sketch-history behavior remains shared. Discovery describes all stroke/radius fields and bounded failure states; no separate agent trimming implementation exists.

The shared viewport inspector synchronizes derived camera-world matrices and copies the actual projection/world matrices into `viewport_get`. Agents can project points for either camera kind without private editor access or a hard-coded FOV. The matrices are read-only derived view state; project geometry, history and revision semantics are unchanged.

### Fixed-radius sketch fillets and cylinder inspection

`sketch_corner_fillet` awaits one immutable analytic helper, passing the operation's cancellation signal and ownership/revision check. It checks again before the single draft publication. The GUI corner panel dispatches through that executor; its standalone controlled-component fallback uses the same helper. The existing sketch history adapter, retry protection, busy/lock checks and authoring transaction remain shared. No intermediate Corner Trim mutation or separate agent geometry implementation is introduced.

The kernel alignment-reference reader also retains a cylinder's physical radius. Shared CAD-reference conversion transports this value as optional `radiusMm` through the existing GUI/MCP reference operation without changing datum axis/plane mathematics, geometry, revision or history. This permits independent inspection of analytic fillet extrusion rather than inferring output radius from the input recipe. Mesh volume remains a separate approximate metric.

### Reconstruction job ownership

The GUI reconstruction adapter submits `mesh_process` through the same executor used by MCP and only displays its terminal diagnostics. The executor owns validation, revision checks, the disposable processing worker and the single model commit. This removes the former GUI-only reusable-worker successor copy. A shared UI job observer captures revision/request identity once, forwards progress and requests cancellation on abort, observation failure or its finite lease; it never republishes geometry. Known terminal success takes precedence over a later observer abort. ShrinkWrap retains its existing `scan_preview` lifecycle through that observer.

`mesh_process` resolves `scanTools/repolygonize.method` once through shared binding: all-mesh inputs default to `native`; cloud or mixed inputs use `voxel`; explicit native cloud input is rejected. Native omitted `targetIds` discovers eligible visible raw meshes in workspace order, an empty list means source only, and explicit native lists are normalized to workspace order. Voxel preserves the existing explicit target order and rejects an empty explicit list. Other operations keep their target cardinality requirements. The executor constructs private indexed source/target descriptors from workspace objects; discovery never advertises those buffers as public arguments.

Native runs the signed-field/extraction/repair/half-count pipeline and returns method/input-ID diagnostics with computed indexed vertex normals. Creating a result is the default: the requested source remains immutable, a new mesh becomes selected, and eligible inputs are hidden atomically. Explicit `createNew:false` replaces the requested owner even if computation order chooses a different first field source. Hiding inputs requires their lock checks. Visibility is part of the modeling transaction: trusted `restoreVisibilityFor` history metadata survives the shared session snapshot/transport/codec paths, Undo/Redo and GUI or public MCP restoration. It is not a caller-settable visibility bypass. Voxel retains its previous ownership behavior.

Reconstruction admission counts up to 500 million input coordinates and 256 MiB of logical private numeric transport payload before cloning or creating its worker. Ordinary Float32 views cost four bytes per coordinate and numeric arrays eight; repeated views are charged separately. Immutable Float32 shared-buffer views are borrowed without transfer only by the disposable read-only reconstruction worker, even when a caller requests reusable topology. Other mutating operations retain private copies. Global alignment allocates final streams directly in private shared buffers when cross-origin isolation supports them, preserving stage order and Float32 rounding; fallback output remains ordinary buffers. Voxel reconstruction counts output facets before allocating one exact contiguous Float32 output. Native signed-field nodes/corners/candidates and finalization/optimization estimates have independent bounded admissions; field storage is released before reduction allocates mutable records. Grid, sampling, output and frontier limits remain independent. These payload and allocation policies do not establish a whole-workflow heap or process memory bound.

## ASC attribute carriers

The shared importer forwards `ascAttributes` to its worker. GUI settings and
MCP `settings_set` share `importAscAttributes` (initially `xyz-rgb`);
single/batch imports capture that preference unless explicitly overridden.
`xyz-normal` preserves scanner-normal import as an explicit extension.
Both entry points publish the same opaque `Entity.pointColors` Uint8 RGBA
carrier and interpretation metadata. Colors do not transform with geometry.

Point-edit workers return exact source slots; the client retains authored color
buffers outside worker transport and reindexes those slots after validation.
Revision identity includes the immutable color carrier and interpretation.
Summaries exclude the carrier; geometry artifacts and canonical `u8` digests
provide explicit agent access. Binaryv4 stores byte chunks outside metadata,
deduplicates across history and rejects malformed references/opaque-alpha/count
mismatches before publication. JSONv2 prevents silent loss in old readers.
See [ASC attributes](ASC_ATTRIBUTES.md) for version and fidelity limitations.

## Analytic sketch mirror copies

`sketch_mirror` snapshots the active draft (falling back to authoring sketch),
awaits the shared immutable `mirrorSketch` helper with the operation's signal and
revision check, then checks again immediately before one `setSketch` publication.
The GUI dispatches the same operation. The existing adapter owns the saved-sketch
or legacy-sketch undo entry; no model commit or separate agent implementation is
introduced. Discovery exposes the construction axis, selected line/arc IDs,
revision/retry fields, coordinate units, output maps and bounded failure states.

Copies retain selected shared topology without sharing editable point IDs with
originals. Reflection reverses arc direction and preserves construction flags,
frame and scan references; constraints are retained only on original geometry.
Maps use own keys safely even for prototype-like source IDs. Input/output counts
and synchronous validation work are admitted before copying, with periodic
event-loop yields, cancellation/revision checks and a final publication check.
The operation returns IDs and maps rather than duplicating the whole sketch in
its response; `sketch_get` exposes the resulting graph. Native workflow evidence
and remaining numerical fidelity limits are in [mirror evidence](NATIVE_SKETCH_MIRROR.md).

Analytic and legacy sketch extrusion share exact-coordinate endpoint aliasing in
derived profile topology. This enables independently copied curves to form one
wire without mutating authored IDs, constraints or recipe data. GUI validation
and the MCP `cad_create` evaluator use the same profile assembly; real gaps and
ambiguous branches remain rejected. This is not tolerance-based sketch welding.

The `collinear` Sketch v1 relation uses the existing `sketch_set` executor,
`validateSketch` and `solveSketch`. The GUI submits the identical operation with
`solve:true`; no separate agent solver or new mutation route is introduced.
Its two residual rows and geometry-aware finite-difference steps preserve
conflict attribution, local DOF reporting and invalid-trial rejection. The
existing draft adapter owns sketch history and project persistence; model
history, revisions, retry protection and lock/busy admission retain their
existing contracts. See [collinear constraints](SKETCH_COLLINEAR.md).

## Bounded indexed alignment memory

The shared indexed normal expansion now preserves Float32 input storage,
including signed zero, across point-pair acceptance, mesh processing and indexed
transforms. Numeric-array inputs retain their existing precision. This supersedes
the earlier indexed-caller container default described above. GUI commits and
MCP `landmark_accept` use the same operation; existing digest resources expose
the `f32` carrier without a new wire format or public setting.

Alignment target construction opts into a 512 MiB tree estimate in the existing
ordered octree builder. It reserves 512 bytes per node and 24 per live membership,
including parent memberships until subdivision completes, and includes allowance
for packed query transport. Geometry buffers and other allocations are separate;
this is not an exact VM memory measurement. Other noise callers keep their legacy
count guard. Budget checks precede membership/node allocation, retain cancellation,
and fail through the existing public operation error contract with required and
allowed estimated bytes. The 4 GiB process validation cap, worker-pool admission,
revision checks, retry protection, locks and history behavior are unchanged.

Geometry digests and project encoding hashes borrow canonical little-endian typed
storage in bounded views rather than allocating a staging buffer per megabyte.
This applies to GUI saves, automatic backups and MCP project exports through the
shared encoder, and to `object_geometry_digest`. Signed zero and file/hash bytes
remain unchanged. Compression streams still receive owned staging bytes; legacy
numeric arrays and noncanonical storage retain the conversion path. Borrowed hash
views are consumed before advancing and never transferred or detached.

Completed Float32 indexed render normals use the existing immutable shared-buffer
allocation policy when cross-origin isolation permits it. Encoder workers then
share that backing rather than cloning another expanded normal buffer. Hosts
without shared storage retain private Float32 buffers; values, history and file
formats are unchanged. Application operations treat the published buffers as
immutable, as they already do imported shared geometry.

The same publication policy covers expanded positions from indexed landmark
refinement. Unchanged Uint32 connectivity retains the source backing instead of
being copied again. Worker result transfer lists include only private
ArrayBuffers; shared model/history storage remains attached. Legacy ordinary
index arrays are still converted to Uint32 storage without changing face order.

## Binary project geometry publication

The shared decoder keeps `u32` indexed topology typed, with a representation-aware
cache key so identical topology/selection chunks do not change selection array
semantics. The GUI/MCP decoder worker opts into the existing immutable publication
policy for final Float32 geometry and Uint32 topology, after raw container hash
validation. Current and history references reuse the published carriers. Encoding
workers can share them rather than cloning private restored geometry again.
Private fallback transfers worker-owned buffers; shared backing is excluded from
transfer lists. Legacy JSON/f64 decoding, file formats and public contracts remain
unchanged. Publication temporarily coexists with validated private chunk bytes;
its whole-workflow memory outcome is measured, not inferred from buffer size.
See [the restoration evidence](PROJECT_LOAD_PERFORMANCE.md#binary-topology-and-history-publication).

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

The self-connection comparison is internal shared geometry groundwork exported
through the common sketch worker entry. It adds no GUI-only behavior or
advertised agent operation. Existing `sketch_get`, `sketch_set` and
`sketch_manage` contracts are unchanged. The future shared editor must use the
same topology/admission implementation for GUI and MCP; this scalar candidate
test alone cannot authorize a published child. Public schemas, discovery and
agent usage documentation must be updated together when that operation is
ready. Current evidence is limited to scalar, worker/kernel and static checks:
`docs/evidence/reference-sketch-self-connection-20261024.json`.

The known-parameter analytic line witness is implemented in that same shared
worker layer, including a read-only diagnostic on retained line wire candidates.
This internal diagnostic is not an advertised authoring operation or body
acceptance result. It adds no separate GUI/agent implementation or public
schema change; full GUI/MCP integration remains gated by complete admission
and lifecycle semantics. Evidence:
`docs/evidence/reference-sketch-line-witness-20261024.json`.

The earlier known-line input interval check is another internal shared worker
diagnostic, with an explicit runtime threshold and conditional status mapping.
It does not introduce a public setting, authoring operation or separate GUI/MCP
implementation. Existing public sketch contracts and discovery remain
unchanged. Binding the missing threshold and complete topology/admission
remains required before the shared editor may advertise the capability.
Evidence: `docs/evidence/reference-sketch-line-input-interval-20261024.json`.

Static evidence now identifies that threshold as session angular precision and
binds its selected initial-value, setter and context-field paths. The
coordinate envelope is coupled to endpoint tolerance divided by angular
precision. A future public geometry/session contract must preserve those
relationships through the same shared operation for GUI and MCP. No setting
tool or native default is advertised from this evidence alone; active context
and complete admission remain required. Existing public contracts are unchanged.
See `docs/evidence/reference-sketch-angular-precision-20261024.json`.

Converted line direction preservation is implemented once in the common sketch
worker's candidate builder, with the same ownership/error behavior for future
GUI and MCP callers. No GUI-only correction, public schema change or unsupported
tool is advertised. Kernel replacements must preserve the checked direction
binding contract and pass its bit-exact/failure cleanup smoke; details are in
[CAD direction fidelity](CAD_DIRECTION_FIDELITY.md). Existing public sketch
contracts remain unchanged, and full authoring/native acceptance remains open.

The shared candidate's selected open-edge structure is additionally checked by
`tests/kernel-line-open-topology-smoke.mjs`, including underlying vertex identity,
orientation, short spans and repeated retirement. This adds verification, not a
new GUI or agent operation; public contracts and discovery are unchanged.
Connected/closed topology and full native admission remain publication gates.
Evidence: `docs/evidence/reference-sketch-open-topology-20261024.json`.

Attachment disposition is also implemented once in the common worker's line
candidate/draft. Controlled-event tests verify matching resource retirement and
retained diagnostic state; no separate GUI or agent implementation is added.
This internal draft is not advertised by the public catalog: complete admission,
the shared editor operation, structured results and GUI/MCP contract and rendered
acceptance remain mandatory before publication. Public schemas, executor,
adapter and dispatcher are unchanged by this checkpoint. Evidence:
`docs/evidence/reference-sketch-attachment-disposition-20261024.json`.

The common worker's line child now supplies the ordered collection's retained
source projection, preserving records for shared construction resolution and
staging. This fixes the common snapshot rather than adding separate agent/GUI
paths. Contract tests use real child and collection classes with the shared
resolver and source codec; kernel tests exercise ownership and retirement.
Public catalog/schema/executor/adapter/dispatcher remain unchanged. Full
admission, public shared editor integration, and rendered GUI/MCP parity still
block feature completion. Evidence:
`docs/evidence/reference-sketch-line-collection-20261024.json`.

Line draft copying is implemented in the common worker, with independent
resource ownership, detached diagnostics and cancellation/source-change checks.
It is an internal staging primitive, not a registered public tool. A future
shared GUI/MCP editor must still supply document revisions, retry/lock checks,
resource admission, worker leases and atomic history/publication around it.
The draft copy does not convert a candidate into complete native backend success.
Public discovery, schemas, executor, adapter and dispatcher are unchanged.
Evidence: `docs/evidence/reference-sketch-line-draft-fork-20261024.json`.

## Live N-point view and preview lifecycle

The mounted editor's `editLandmarkSession` is the GUI/MCP edit boundary. Every
valid edit aborts the previous preview and publishes immutable original-pose
picks. Three or more equally sized groups schedule `runLandmarkPreview` without
setting the global GUI busy flag, so both picking views remain interactive.
Reset cancels without restarting; removal/clear invalidate the result. A pending
result is accepted only if its AbortSignal is live, session identity is still
current, and captured geometry/locks are unchanged. Superseded errors/results
cannot overwrite the new session. Acceptance remains the existing single-history
operation; Cancel discards the session and aborts its computation.

`landmark_get` exposes pairCount, previewStatus, previewError and view object IDs
with original-pose markers. `LandmarkPickingViews` owns two disposable Viewport
instances using captured source/reference descriptors; the main view displays
only the preview pose. Existing viewport get/control/pick tools route optional
main/moving/fixed selectors through the same Viewport methods used by mouse
navigation. No extra renderer-specific modeling implementation exists. Closing
the session disposes both small renderers and rejects later view requests.
Explicit landmark_preview jobs retain their API lease, revision/retry handling,
cancellation and resource guards. Automatic computations use the same bounded
native processing and abort pipeline; they are observed through landmark_get
rather than an API job receipt and canceled through reset/edit/preview_discard.

The alignment divider routes mouse, keyboard and MCP `landmark_edit/view-layout`
through `editLandmarks`. A finite referenceWidthPercent is clamped to 20-50
(default 32) and published under `landmark_get.layout`, with responsive pixel
minima. This presentation-only edit retains picks/result identity and bypasses
preview cancellation/relaunch inside the editor, while normal API admission,
revision and retry guards remain. Solve publication merges into the latest
session layout after verifying the unchanged picks, live abort signal and scene;
all semantic edits still abort the previous solve. Viewport geometry effects
subscribe to geometry/pick/result identities rather than layout, leaving
ResizeObserver to update render dimensions without copying scan buffers.

Picking view order is fixed at reference/fixed above moving. No global pick-side
mode remains. `Viewport.setAlignmentMarkers` optionally renders keyboard-accessible
removal buttons; the result view keeps passive markers. The picking adapter maps
each marker's displayed-object index to shared `landmark_edit/remove-point` with
entityId and zero-based pointIndex. View-local Undo/Clear use the existing
remove-last/clear actions scoped by entityId, preserving their legacy unscoped
agent semantics. The same edit invalidation and preview pipeline handles all
removal paths; point lists removed from the dialog remain in landmark_get.

The internal reference average evaluator applies the empty common-source guard
before binding retained records. Definition validation and prior-endpoint
finalization remain shared; pair records still require binding. No tool or schema
is advertised. Reference host operations, editor and project-admission gates
remain unfinished. See `docs/evidence/reference-empty-average-20261024.json`.

Semantic reference dependency integration now uses `validateReferenceEntity` in
`datumEntityDependencies`: persisted common source IDs join the existing graph,
while ordered picks remain extraction records. The GUI dependency action and MCP
`alignment_targets` already share this operation and return structured links,
transitive dependents and blocked-target reasons without mutation. Catalog/schema
are unchanged; authoring/import/reevaluation gates remain closed. Evidence:
`docs/evidence/reference-dependencies-20261024.json`.

Projected reference selection is now a pure index selector, separate from
provider-specific geometry extraction. The previous unpublished projection-to-
OpenCascade composition was removed because source/provider correspondence was
unestablished. No public capability or schema changed. Exact provider projection,
source refresh and construction GUI/MCP lifecycle remain gated. Evidence:
`docs/evidence/reference-projection-selection-20261024.json`.

Rendered viewport verification now connects the actual production viewport to
ApplicationApi plus existing project/object/viewport handlers in an isolated
fixture host. GUI pointer and `viewport_pick` agree on semantic point/finite-line
geometry, and `viewport_control` Fit frames reference-only bounds. Visibility,
locking, clipping and display-resource cleanup are checked without enabling
reference creation/import. Full React-editor and construction lifecycle
acceptance remain open. See `docs/evidence/reference-rendered-viewport-20261024.json`.

`ReferenceConstructionSession` now provides the internal cached state core for
the approved shared editor. It separates numeric writes from evaluation, versions
successful edits, gates a renewable 60-second lease and applies the exact cached
proposal once. Inspection/publication copies preserve authoritative geometry;
rejected synchronous publication retains the cache. The caller must bind its
private token to actual model/source state and supply atomic publication. Host
registry, source/lock/resource checks, API revision/retry handling, competing
previews, timer/display disposal and GUI/MCP commands remain unwired. No tool or
schema is advertised. Evidence:
`docs/evidence/reference-construction-session-20261024.json`.

`bindReferenceConstructionWorkspace` now supplies a private model token from the
actual host snapshot. Selection-only API revisions and camera/settings changes
do not invalidate it; model/carrier replacement, precise reference recipe/state,
project/history and stored sketch changes do. Active named-sketch selection is
independent of its saved source data. Invalidation is sticky and drops its stamp
and bound snapshot reader. This relies on immutable geometry publication and does
not inspect scan-buffer contents. Existing API revisions, source/native-provider
admission, locks and atomic publication remain separate requirements. Registry,
timer/display ownership and GUI/MCP session handlers remain unfinished. Evidence:
`docs/evidence/reference-construction-binding-20261024.json`.

`reference-construction-preview.ts` now owns one internal lease per stable host.
It composes the session core/model binding, owner-scoped display callbacks and
renewable timer. Edit display publication happens before accepting the new cache,
version or deadline. Failed edits restore the old display or retire that owner;
failed cleanup remains inspectable and blocks replacement until an explicit
owner-scoped retry. If model Apply succeeded but display cleanup failed, its
result reports `cleanupPending` and cannot publish again. The eventual API must
retain that success in its retry receipt. Existing preview-family admission is
checked, but reciprocal admission, host proxy, actual viewport adapter, API
disposal/cancellation and public commands are not wired yet. Mock callback tests
do not establish GPU cleanup. Evidence:
`docs/evidence/reference-construction-preview-20261024.json`.

The production `ReferenceDisplay` now hides retiring objects, attempts every
disposal phase and retries only unfinished phases. The shared `Viewport` retains
failed active/staged display retirements, drains them before later scene updates
and continues viewport teardown after reference failures. A repeated disposal
retries the retained resources without repeating successful material work. Real
software-WebGL tests exercise replacement and teardown faults, plus GUI/API picks,
clipping and Fit. Renderer resource counts recover to their baseline or zero;
this does not measure total driver memory. This fixes the actual display boundary
needed by the new owner, but does not wire its adapter, host proxy or public
construction operations. Evidence:
`docs/evidence/reference-display-cleanup-20261024.json`.

`ReferencePreviewDisplay` now owns the production ephemeral point/line display.
It stages replacement, rejects foreign owners, inherits viewport clipping and
retains failed retirement phases. These objects never enter persistent entity or
history collections and cannot be picked as model objects. `Viewport` exposes
owner/state/cleanup count, millimeter geometry, lossless encoding and bounds in
its existing agent inspection. The stable host proxy forwards the imperative
preview callback to the latest React host without `flushSync`; App forwards it
to the viewport and reports its preview flag. `ApplicationApi.dispose` attempts
all synchronous preview cleanups, including this owner, before reporting aggregate
errors, so one failed family does not skip another. Real React/WebGL tests verify
latest-host edits, a real 60-second expiry, injected GPU cleanup failure/retry and
hook unmount. Public session handlers/editor, reciprocal admission and native
source/lifecycle acceptance remain open. Evidence:
`docs/evidence/reference-preview-adapter-20261024.json`.

## Fresh pointer/frame orbit pivots

Each mouse orbit resolves a new pointer surface, then center-of-frame surface,
then the middle camera ray intersected with a camera-facing plane through the visible model bounds center. The pivot is frozen only for that gesture;
misses never retain an old gesture's point. MCP viewport_control rotate with
normalized x/y uses the same ordered fallback rather than failing on empty
space. This applies to main, fixed and moving Viewport instances.

Large unindexed scenes query rendered depth without scanning point buffers.
Mesh/line proxies borrow geometry; point proxies use a temporary packed-depth
shader with matching point size/attenuation and clipping. The cropped depth tile
includes sprite centers near the queried pixel and reads its center pixel. It
uses cached geometry bounds to tighten private near/far planes, preserves source
world transforms and visibility, and restores renderer target/clear/clipping
state while disposing all temporary materials and targets. Authored geometry and
history remain unchanged. Existing viewport_get.orbitCenter exposes the actual
active world pivot and indicator state; no new camera tool is needed.

For pointer misses where the center pixel also has no rendered geometry, the
frame fallback uses model depth rather than controls.target depth. The plane is
normal to the current view direction and passes through cached visible bounds
center; intersection with the middle camera ray keeps the pivot at screen center
after pans and off-center surface rotations. Only an empty scene or unavailable
forward depth falls back to the look-at target. GUI and MCP coordinate-free or
missed-coordinate rotation share navigationFramePoint; no geometry scan is needed.

Dense point-cloud orbit hits use a bounded rendered-depth neighborhood (6 CSS
pixels, scaled to device pixels), prioritizing the exact pointer pixel and then
the closest valid sample. The sample's depth is unprojected on the original
pointer ray. All cloud sizes use this shared GPU path to bridge sparse pixel
gaps consistently without CPU scans. The readback is limited to the neighborhood
even when larger point sprites require a larger crop target. A local miss alone
enters navigationFramePoint. GUI and MCP share the same hit and fallback order.

Document-level capture cancels only the default contextmenu action at startup.
It does not stop propagation, so React/custom menu handlers and body portals
still receive the event. This closes the native-menu leak when right-pan capture
ends outside a canvas. application_inspect reports contextMenuPolicy as
application-only; existing semantic MCP menu actions remain unchanged.

Reconstruction binds explicit `points` or `triangles` records from current workspace entity kinds. GUI request binding and the shared executor use the same admission rules; external schemas reject internal geometry records. The processing client preserves those kinds while borrowing immutable shared views or cloning private inputs into a disposable worker. The mixed sampler unions point-distance occupancy into the existing triangle bitset with a combined candidate budget, then reuses filling, extraction and topology verification. Explicit voxel all-mesh calls retain the legacy sampler and output; omitted all-mesh method resolves to the native field pipeline. Publishing a cloud reconstruction creates a clean mesh through the shared commit path and never carries point-cloud metadata into the mesh.

An internal optional global alignment environment can supply retained sampler clock streams by prepared scan ID and the outer clock callback. It is absent from public schemas and ordinary editor construction. It supplies environmental clocks only; captured geometry, queries, matrices and results are never injected into the solve. Supplied-host controller tests remain distinct from production editor/stdio and native setter-entry observation.

Cloud placement caches retain a boolean describing the world-normal carrier alongside weak buffer references; reclaiming historical views does not erase this storage choice or add a strong geometry reference. Project encoding snapshots carry optional `typedNormalClouds` entity references through structured cloning, preserving existing deduplication identities. Binary cloud records use optional `cloudNormalsTyped` independently of local normal storage. Decoding strips that internal flag from entity metadata, validates its type/pose prerequisite and restores the world carrier. Omitted flags retain the legacy array fallback; file versions and public tool schemas remain unchanged. GUI history and public MCP export/restore use these same paths.

Computed scan facets use the shared optional `IndexedMesh.facetNormals` Float32 carrier (XYZ per triangle), distinct from scanner and computed vertex normals. Import/render preparation initializes it, shared rigid transforms rotate it stage by stage, and immutable history/project transport retain its bits and aliases. Global input and query admission count its backing storage; GUI and MCP invoke the same production evaluator path. Geometry inspection exposes the carrier through `object_get` and `object_geometry_digest`. Geometry JSON receives a UTF-8 size preflight against the existing 1 GiB artifact capacity before typed-array expansion; larger payloads use binary project export or bounded digest inspection. Derived triangle-soup topology is published only when it expands exactly to the source; the nonmatching legacy geometry fallback remains uncached.

## Inspection parity

`inspection.ts` owns measurement and analytic signed report calculations;
`inspection-reference.ts` reuses the existing comparison BVH/numerical leaf against
visible display triangles. `automation/inspection-operations.ts` owns the bounded
report lease, analysis jobs, guarded display, and saved definitions. GUI reference
comparison invokes the same analysis/display operations through ApplicationApi.
The editor host publishes source-bound heatmaps; API disposal clears their lease.
Unknown/unmatched samples preserve source order and render gray. Reports expose
sampling, search-radius, tessellation and local-normal limits explicitly.

`authoring.inspections` persists only validated small definitions (maximum 32),
using the existing project/session/backup metadata carrier. Inspection metadata
participates in API revision identity. Replays recompute against current geometry;
result JSON artifacts are independent snapshots. Analysis and display add no model
history. Save/delete retain authoring fields and mark the document dirty. Existing
revision/retry, job admission/cancellation, artifact quotas and owner-lifetime
checks remain active.

`inspection_display` also accepts `action: "measurement"` with an `analysis_measure`-shaped `measurement`, or `action: "section"` with selected `entityId`, `axis` and millimetre `offset`. These guarded actions display the shared validated measurement markers or visible triangle section in the GUI and return its numerical result without modeling history. `clear` removes all inspection overlays; API disposal releases them. Point clouds cannot supply triangle sections.

### Shared primitive fitting

`analyzePrimitiveFit` owns the common GUI/MCP sampler, source precision, region
filter and fit dispatch. `analysis_fit` remains read-only; `primitive_fit_create`
reuses that operation and the shared plane/CAD builders before one checked model
commit. Both use the same tri-state selection rule: omitted follows the active
nonempty source mask, false fits the whole source, true requires a current mask.
The GUI captures its fitting revision and rejects stale materialization before
submitting the public operation. Point-cloud display bounds, rather than triangle
statistics, size plane references. Newly created kernel handles are released on
publication failure/cancellation, while previous bodies stay owned by history.

`copyFitResult` validates and detaches accepted object fit parameters at project
boundaries. JSON and binary serializers now retain this optional metadata instead
of discarding it. The decoder applies the same finite vector, dimension and
residual validation to current and retained history states. Geometry buffers and
file chunk protocols keep their existing ownership and cancellation contracts.

`sketch_manage` also owns GUI/MCP plane-to-sketch creation. The shared
`resolveSketchPlaneSource` adapter preserves a reference plane's stored tangent
orientation, validates its detached rigid placement and applies the signed
normal offset. Legacy fitted planes without a stored frame use the existing
datum convention. Creation/activation publish saved authoring state and clear
object selection through the same host callbacks. Source placement is copied,
not retained as a live dependency; existing sketch project codecs persist it.

### Numeric reference datums

`datum_construct` is the shared create/edit transaction for numeric planes and
named coordinate systems. `numericDatumFrame` builds the rigid basis from the
world origin, normal and optional X direction. A plane owns its finite display
triangles and `planeFrame`; a coordinate system is one `referenceFrame` entity
with empty positions and authoritative
`coordinateFrame: { version: 1, frame, displaySize }`. Three rendered positive
axes belong to this one entity. Newly authored numeric/fitted planes additionally
retain optional `planeFrame.displaySize`, their explicit square side length in
millimetres. JSON copying, binary metadata, rigid datum placement and uniform
mesh transforms preserve this field (scale multiplies it). Legacy frames without
size remain readable; no extent is reverse-derived from their display buffers.
The shared plane basis projects/normalizes the tangent for both sketch placement
and located line-pair `planeUV` acquisition. Discovery returns local bounds;
the resolver uses saved size/2 as both direct-plane half sizes. Existing ordered
F32 records, identity migration, cached preview binding and atomic dependency
refresh handle this source family without a second writer or project format.
This is an application authored-frame bridge, not native provider/controller
equivalence. Frame validation rejects sampled geometry,
fitted/CAD metadata, nonrigid bases and out-of-bounds display endpoints.

`copyReferenceFrame` preserves accepted binary64 coordinates without
normalizing or converting them to Float32. JSON project version 3 and binary
manifest version 5 store twelve little-endian Float64 values as hexadecimal
`frameBits`, ordered origin, U, V, normal, plus positive `displaySize`. Existing
JSON versions and binary manifests 2–4 remain readable. Both project codecs
validate current, history and future entities. Frame-only changes participate
in model history, geometry digests, API revision identity and construction
preview bindings. Inspection returns detached structured frame data and its
exact encoding. Sampled processing, scan selection and CAD export cannot treat
the frame as geometry; display bounds and picking use its semantic axes.

`alignment_references` supplies the frame's named origin, XYZ directions and
XY/YZ/XZ planes through the existing point/direction/plane constraint schema.
Axes are anchored at the stored origin, independent of their display length.
Stored numeric planes supply their infinite center/normal plane; their saved
tangent is retained. The GUI picker and inspector consume these same paged read
jobs, including read-only locked sources. Bound alignment constraints reread
the source at the requested revision. `sketch_manage` consumes a frame's
XY/YZ/XZ placement as a detached copy; later datum edits do not move that sketch.
See [reference datum usage and limits](REFERENCE_DATUMS.md). Native acceptance
of additional relational construction modes remains a separate gate.
