# ScanForge shared application API and MCP

## Intent and scope

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

## Visual workflow

Visual workflow tools use the same host adapter: `workflow-operations.ts` exposes structured application observation, semantic UI/camera control, geometric picking, retained history and project naming. `application-observation.ts` inspects bounded visible accessible controls without credentials. `visual-capture.ts` renders the current WebGL frame synchronously, freezes its serialization during bounded local DOM capture and restores it in `finally`. PNG/JPEG results are stored as transient artifacts; the stdio adapter emits native MCP image content and metadata without repeating image bytes in JSON. Capture limits, redaction and browser-rendering limitations are documented in the agent guide. `session_get` recovers bounded job/artifact metadata; `tools_search` provides compact discovery without repeating full schemas.

## Mutation correctness

All public mutations require `expectedRevision` and `requestId`. The revision includes geometry identity, metadata, authoring, selection, model history and relevant settings. A human action can advance it. Immediately before applying asynchronous work, the executor checks cancellation and whether the original revision is still current. Results that cannot be applied release newly owned native handles; previous model/history handles are preserved. Existing domain validation and lock checks run at commit.

Retry receipts are bounded to the latest256 requests and are transient. They prevent ordinary in-session duplicate writes, not crash replay. A changed request needs a new ID. Project imports restore exact bodies in a separate kernel before atomic replacement; failed imports dispose that kernel. A cancelled native operation retains the admission lane until cleanup settles.

## Connection and resource ownership

The bridge requires a >=32-character operator-supplied token, exact approved origins and loopback Host. OPTIONS is the sole unauthenticated preflight exception and grants no access. One browser owner, 60-second lease, queue64, poll batch16, body/command2MiB, 30-second response timeout and eight-hour service lifetime bound the bridge. Closing stdio closes HTTP service. Browser disconnect/page exit requests active-job cancellation; every worker retains its existing cleanup rules.

`/connect` additionally advertises `capabilities.pollWaitMs: 8000`. A browser opts in only when that capability is a valid integer from 1 through 8000, by adding `waitMs` to `/poll`; the server accepts integers from 0 through 8000. Without the parameter, polling remains immediate for older clients. Browsers paired with older servers retain the existing one-second polling cadence. Public MCP tool schemas, revision/retry handling and command results are unchanged.

An opted-in idle poll waits for queued work, its requested bound or the current session lease, whichever comes first. There is one pending poll per owning session; a duplicate returns 409 and cannot steal work. Dispatch wakes the owning poll immediately, and the browser reissues after completed commands without the one-second pause. Unexpectedly fast empty replies have a 100 ms minimum cadence to avoid busy polling; a normal server-held idle response adds no extra delay. The browser keeps its 10-second HTTP request timeout. Abort/socket close, disconnect, session expiry and server close clear the waiter, its timer and listeners; undelivered commands remain queued when an aborted response cannot receive them. Existing queue 64, batch 16, authentication/origin checks, command deadlines and active-job cancellation remain enforced.

The API keeps at most32 terminal/running job records, latest256 retry receipts, and64 transient artifacts totaling64MiB. Artifact access checks a15-minute inactivity lease. No token/customer payload is stored in resource ledgers. The browser's normal IndexedDB backups and user project data are separate persistent resources.

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
metadata follows the native reference adapter. The GUI properties panel invokes
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

Origin/reference scan alignment carries optional frame-basis XYZ translation in its shared preview/apply schema. The GUI submits the same offsets as MCP. The frame compiler applies the recovered native callback arithmetic before rigid inversion, and the output reports the offsets and matrix. Native replay checks 1,014 complete callback outputs; UI data exchange and window notifications use fixture adapters, while numerical instructions remain original.

Bound datum constraints resolve through the same `alignment_references` handler used by GUI inspection, rather than trusting copied UI coordinates. Within an alignment job, each unique source object/centering input is inspected once, with strict workspace revision and cancellation checks. The compiled manual and bound forms share the original constructor/inverse path. GUI selectors use bounded paged read jobs; source objects remain unchanged throughout preview and application.

The viewport pick callback includes an optional original triangle slot, remapped through display triangle slots when present. Origin/reference face picking consumes that slot without changing the selected moving scan. The shared read-only `alignment_references` operation resolves it against exact kernel face tessellation ranges; MCP uses the same lookup after `viewport_pick`. The GUI retains cancellable, bounded inspection jobs and reports unsupported surfaces rather than fabricating a plane from tessellation.

Datum scan transformation now follows the original mesh vertex and triangle-normal worker arithmetic, including signed-zero preservation. The shared Apply no-op decision uses the recovered original source-frame identity predicate at zero tolerance. Native fixtures cover worker output independently of scheduling; CPU-pool integration for this transform remains separate from the existing refinement pool.

Spacebar and the MCP `command_run`/`command_repeat` launchers share an in-memory command identity registry. React refreshes the callbacks each render so repeats use the current selection/settings. `command_get` and application inspection expose the repeat target and availability. Launchers pass the normal revision, retry and busy admission checks, then delegate progress/busy ownership to the launched GUI/domain operation rather than installing an API job that would block it. Launch acknowledgement is explicitly separate from asynchronous modeling completion. File, deletion and history actions are excluded from tracking; active dialogs and previews reject repeat launches.

The shared datum operation owns one bounded transform executor per job and closes it in `finally`. It transfers copied chunks to two physical workers, restores outputs in input order, and reuses those workers for expanded coordinates, indexed vertices and normals. Native arithmetic lives in a dependency-free kernel shared by serial and worker execution. Every chunk yields control for cancellation, and the operation checks revision before its one model commit. The executor reports bounds while processing chunks, avoiding a second full main-thread bounds traversal. Source buffers are never transferred or detached. Temporary task memory is bounded by chunk size rather than scan size; destination model arrays still require storage proportional to geometry. Pool lease is three minutes, each task has a 30-second timeout, and idle workers expire after 30 seconds. GUI and MCP expose the same `parallel` option and execution diagnostics.

Identity frames bypass coordinate transformation and output allocation before the executor is created. Their unchanged source bounds are scanned in cancellable chunks to preserve the result contract. Large nonidentity Float32 model buffers retain Float32 during copied-chunk transport; authored number arrays use Float64 transport to preserve their existing precision. Bounds and finite/range validation are fused with the transform pass, while numerical expression order and Float32 output storage remain native-compatible.

The shared datum result includes `cadMatrix`, reconstructed from the original exact-shape Apply path. Native replay covers 338 original placement matrices and real transformed CAD-face evaluations. Mesh/point-cloud execution continues to use the original scan matrix; the new witness does not bypass the exact-CAD target gate. Kernel placement, copy policy, preview leases and Undo ownership remain required before enabling CAD targets.

Indexed scanner normals are optional topology data shared by GUI/MCP import,
project persistence and mesh processing. Worker input/output transfers own copies
of these buffers so scene and history arrays remain attached. Native refinement
source preparation preserves provided Float32 vectors and falls back to generated
normals only when absent. Transformed indexed normals are expanded through a
shared helper for display, keeping GUI and MCP alignment outcomes consistent.
`object_get` includes indexed normals in its bounded geometry artifact.

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

GUI project opening and public MCP `project_import` / `backup_restore` use the same decoder boundary. One disposable worker decodes and validates the file and prepares current mesh display caches before publishing a replacement. Cancellation, worker failure and its two-minute lease preserve the previous workspace. Decoded worker-owned buffers transfer back; authored buffers in the existing workspace never detach. Large ordinary numeric arrays use internal Float64 staging packets with cooperative main-thread reconstruction. The encoder uses the same transport for save/export/automatic backup to avoid a synchronous structured-clone pause. This internal protocol does not change on-disk formats or public tool schemas. See [loading evidence and regression limits](PROJECT_LOAD_PERFORMANCE.md).

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
