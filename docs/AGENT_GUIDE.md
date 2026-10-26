# ScanForge MCP agent guide

Scan selection uses original point/triangle slots throughout. `selection_modify`
and `selection_saved` support point clouds as well as meshes and exclude hidden
slots when selecting. `selection_set` also excludes hidden slots.

Open Edit scan with `command_run` (`ribbon:editScan`) after `object_select`.
`scan_selection_get` reports the editor tool, through mode, world-mm clip box,
selected/hidden counts and selection Undo/Redo availability.
`scan_selection_control` configures `tool`, `through` or `clip` (`null` disables),
or performs `hide`, `isolate`, `reveal`, `undo` or `redo`. Configure options cannot
be combined with other actions. These change selection/display state, not model
geometry history; clip/tool/through state is also readable under
`project_get.settings.scanSelection` and participates in revision checks.
`revealSelected` matches **Show last hidden**: reveal and reselect only the most
recently hidden batch, retaining earlier hidden elements.
Configuration also accepts `angleDegrees` (0–90), `brushRadiusPx` (2–500 CSS
pixels), and `allConnected`. These use the editor's sensitivity and brush limits.
Boundary highlighting does not replace the facet selection: read
`scan_selection_get.boundaryPathCount` and `boundaryCoordinateCount`, and obtain
the exact source boundary paths through `mesh_process` with
`operation:{kind:"scanEdit",action:"inventory",tolerance:0.001}`.

Mesh `selection_edit` copy/cut/delete and the corresponding GUI actions share
`partitionMeshSelection`. They retain exact expanded corner-normal slots and
invalidate derived topology, fitting and display caches. Undo restores the
complete original indexed mesh and scanner-normal carriers.
Copy/cut selects the returned `entityId` with an empty element selection and
clears the retained source selection, consistently through GUI and MCP.

`scan_select_region` is a cancellable job using the same viewport worker as GUI
gestures. Pass rectangle/circle `start` and `end`, or brush/lasso `points` and
`radius`, in CSS pixels relative to the viewport top-left (`viewport_get` supplies
dimensions and camera matrices). Lasso is filled freehand; brush is an open stroke,
with two points representing a straight stroke. `through` defaults to false;
`operation` defaults to `replace`, with `add` and `subtract` also supported.
Hidden slots and active clipping remain excluded. The target must be the selected,
visible, unlocked scan and Edit scan must remain open. Poll `job_get`, cancel with
`job_cancel`, and read exact source slots through `selection_get`'s artifact.
Failed, cancelled or stale-revision jobs publish no selection. One successful
selection change records one selection-history step. Obtain a fresh revision
after camera/editor changes and use a new request ID after correcting a rejected
request; exact retries retain the original receipt.

The internal new-draft initializer now distinguishes constructor/scene seeding
from typed input writes, including the native zero-span line behavior. It does
not enable public construction commands or an agent-selectable completion word.
The common GUI/MCP editor and source-bound scene admission remain unfinished.

The internal reference geometry bounds adapter preserves native Float32 point
padding and line endpoint tie rules separately from precise semantic bounds.
It is not a whole-scene bounds provider and does not enable construction tools.
Scene filtering, placement and special-source admission remain required before
the common editor can use it for public GUI/MCP construction.

Reference construction acceptance remains internal; no public construction tool
has been added. Its numeric Apply helper uses the shared revision/mutation and
retry machinery, including one commit for cached geometry and selected legacy
source keys. The trusted identity-migration commit policy is not an MCP input
parameter. Derived acceptance and edits requiring dependency rebuild remain
unavailable until their shared source/editor lifecycle is implemented.

Preview-producing commands return `BUSY` while a reference construction preview
or its pending display cleanup owns the workspace. The GUI producers use the
same admission check. Reads, selection and cancellation remain available. After
the owning preview is released, use a fresh request ID for a previously rejected
command: retrying the same ID and arguments returns the retained `BUSY` receipt.
Reference construction itself remains internal and is not listed in discovery.

React effect cleanup temporarily disconnects the workspace gateway and cancels
active work. Synchronous effect replay preserves the same gateway, revision and
request retry receipts. True workspace unmount permanently disconnects it. After
`DISCONNECTED`, inspect the connected workspace before retrying; keep the same
request ID and arguments when recovering an uncertain request. A new workspace
requires a fresh inspection and revision. In-flight work from an earlier owner
cannot publish a late result through the gateway.

Settings uses a height-bounded dialog with Appearance, SpaceMouse, Scan import and
AI agents tabs. `ui_set` accepts `settingsOpen: true` and `settingsSection`
(`appearance`, `spacemouse`, `import` or `agents`); `application_inspect` reports the
selected section. Switching tabs preserves input and agent connections. SpaceMouse
controls still use `spacemouse_get` and `spacemouse_control`.

## SpaceMouse navigation

`spacemouse_get` reports the active source, connection status and preferences.
`spacemouse_control` uses the same controller as Settings, with actions
`automatic`, `connectDriver`, `disconnect` and `preferences`. Mutations require
the current `expectedRevision` and a unique `requestId`. Preferences are accepted
only with the `preferences` action. These settings do not add model-history steps.
Automatic Gamepad detection is the default. The optional official driver connection
requires installed 3DxWare and manages its own sensitivity; fallback preferences
apply to Gamepad and explicit browser HID input. See [input devices](INPUT_DEVICES.md).

## Noise reduction input and comparison

Reduce noise accepts meshes without a fixed triangle-count input cap through
both the GUI and `mesh_process` with
`operation: {kind: "scanTools", operation: {kind: "reduceNoise"}}`.
Memory use still scales with geometry; cancellation and topology validation remain
active. Enable **Measure deviation from original** before Preview to calculate
comparison with that preview, or enable it after Preview to compare the existing
result without smoothing again. MCP callers use `measureDeviation: true` and
`deviation` (millimetres) on the inner operation. Large surfaces use the shared
BVH comparison index instead of failing at the native octree's node budget;
small surfaces retain the recovered comparison behavior. Comparison never limits
smoothing.

## Background mesh preparation

GUI and MCP imports stream the packed little-endian PLY scanner schema (XYZ and
normal Float32 values, triangular faces) through reads of at most 1 MiB, retaining
the full geometry and authored normals. Other PLY layouts use the existing loader.
Cancellation, units, placement, source counts and history semantics are unchanged.
This bounds raw input reads; final geometry and preparation still scale with scan
size, and the three-scan 2 GiB diagnostic gate remains unresolved.
Packed PLY per-file progress now advances during face preflight, vertex/face
decoding and position/normal expansion through the existing import progress
responses. Cancellation and callback failures do not report completion.

Topology preparation uses compact numeric weld, edge and face indexes while preserving tolerance, facet identity, ordered boundaries and diagnostics. GUI and MCP share this kernel and unchanged tool parameters. The derived cache now uses compact format 2; older records are disposable misses and existing storage limits remain unchanged. See [Scan preparation performance](MESH_READINESS.md) and [cache format](TOPOLOGY_CACHE.md).

Scale, mirror, flip normals and unroll may yield speculative preparation for the same source, then use the normal worker queue. Visible diagnostics and queued topology consumers remain protected. Stateful previews retain their owning worker. See [staged readiness](SCAN_READINESS.md).

GUI and MCP scan imports share an import lease that yields speculative topology
preparation before creating an import worker. Preparation requested by a foreground
diagnostics observer or queued topology consumer keeps its owner. Other scheduled
preparation waits until every active scan import finishes. After failure or
cancellation, the same selected source can resume within its existing preparation
lease; disposal or replacement cancels that retry. Exceptions from import completion
callbacks reject the import and release its lease. Tool parameters and schemas are
unchanged. The original three-scan import and navigation replay passes under the
historical 2 GiB diagnostic Job limit with bounded speculative admission. That
longer replay exceeded its cap when automatic backup encoding started; it does
not describe the current validation limit. The later full-history 736 MB GUI/MCP
project round trip passes under 4 GiB in a persistent browser profile; see
[large-project transfer evidence](LARGE_PROJECT_MCP_TRANSFER.md). Full native
alignment remains unverified. See [import scheduling evidence](VIEWPORT_PERFORMANCE.md#imports-and-speculative-topology-preparation).

Loading or selecting a raw triangle scan schedules topology preparation after
rendering/idle when it fits the speculative admission budget. Warmup reserves
512 bytes per facet against the existing 128 MiB scan budget, admitting at most
262,144 facets. This is a conservative scheduling policy, not a process-memory
bound. Larger scans keep uncached counts uncalculated until **Calculate mesh information**,
`mesh_analyze`, or a topology-dependent tool requests the full-resolution index.
Navigation and facet selection remain available; this read-only
work does not mark the project dirty or add history. One selected source is
prepared at a time, after existing foreground geometry jobs. Switching source,
editing geometry, or closing the page cancels obsolete preparation. A topology-dependent mesh tool
started before preparation finishes queues behind the same worker and reuses its
index; it can still wait for the unfinished prerequisites, but does not restart
them. Point clouds and exact CAD bodies are excluded.

**Edit Scan** observes background progress and completed counts.
**Calculate mesh information** remains a manual/retry action; topology tools
also request any missing prerequisites. Pending counts are never shown as zero.
Compact cached counts do not suppress admitted full-index preparation after a
source is selected again. Preparation never starts a competing foreground geometry job.

Agents use `mesh_analyze` for diagnostics or `mesh_process` with
`operation: {kind: "scanEdit", action: "inventory", tolerance: 0.001}` for
the GUI's inventory. Use `tolerance: 0.001` with `mesh_analyze` to share the GUI's
millimetre weld tolerance; the existing API default remains `0.000001`.
Reusable operations on the same immutable geometry queue behind one another,
sharing the prepared topology. Shared diagnostics stop only when their last
observer leaves; cancellation of queued work starts no worker. Geometry edits,
replacement, or a different tolerance invalidate reuse. Compact cached counts
may be reused on Undo; the worker index belongs to the selected geometry.
Prepared topology is also cached in the browser's local IndexedDB storage. The
key includes all ordered mesh coordinates, weld tolerance, and topology/cache
algorithm version. Reopening an unchanged STL or project in the same browser
profile and application origin restores the full index without welding or
building topology again. Changed mesh content or tolerance gets a new key;
renaming a file does not. Live edit topology remains in memory; persistent
snapshots use the canonical source-coordinate analysis.

`mesh_analyze` and `mesh_process` share this cache. Their diagnostics include
`topologyCache` (`persistent-hit`, `memory-hit`, `stored`, `unavailable`, or
`oversize`) and `topologyCacheBytes` when a snapshot was stored/restored. Poll
`job_get` for the result and progress such as "Restoring saved mesh topology".
Edit Scan observes this preparation without starting duplicate work.
`object_get.meshPreparation` exposes `scheduled`, `pending` (with progress),
`ready` (with counts), `error`, or `inactive` for raw meshes. Use GUI tolerance
`0.001` for MCP selected-facet edits to reuse the prepared index.

The derived cache is separate from project/recovery data and project files.
It retains at most eight entries, 256 MiB total, 128 MiB per snapshot, with
30-day expiry and least-recently-used eviction. Storage denial, quota failures,
expired/incompatible/corrupt entries, or snapshots above the size cap fall back
to ordinary analysis. Clearing browser storage removes this cache; project files
remain independently usable. Source geometry, normal history and revision,
lock and cancellation checks are unchanged by cache hits.

## Drag bridges and automatic continuity

In **Fill holes → Bridge**, hover any exposed edge of the selected scan for a
green edge highlight and crosshair, then drag to another exposed edge. No hole
selection is required: the two edges can lie on one closed loop, on separate
loops, or on independent open boundary chains of the same scan. A provisional
surface follows every pointer movement, including across empty space, and snaps
to the destination edge. Pointer movement starts no geometry worker. Release
validates and constructs the chosen flat/tangent/curvature surface and adds one
history step. Escape, a release away from the
rim, changing tools, or replacing the source cancels the preview. Undo/Redo uses
the normal model history. Repeat a drag on a remaining opening to add a bridge.
Automatic continuity uses the adjacent attachment facets: coplanar facets select
flat; curved attachment tangents select a shaped tangent strip. Flat, tangent,
and curvature remain explicit overrides. Existing attachment edges stay intact.
Invalid adjacent edges, crossing rails, overlapping patches and nonmanifold
attachment edges are rejected. Unrelated defects elsewhere on a fragmented
scan do not disable valid attachments. Camera navigation remains available away
from boundary edges. If display picking is still preparing, the canvas reports
that state instead of scanning every facet during hover.

The GUI and MCP use the same `scanEdit` hole-fill geometry. First call
`mesh_process` with `operation: {kind: "scanEdit", action: "inventory"}` and
read its report artifact. Closed loops followed by open chains provide ordered world-mm `points`;
`start` and `end` identify **edges** beginning at those zero-based point indices,
including the last-to-first edge only for closed loops. An open chain has
`pointCount - 1` edges. Put the start boundary index in `indices: [startBoundary]`
and set `endBoundary` to the destination boundary index. Omit `endBoundary` for
the legacy same-boundary operation. Local start/end edge indices may be equal
when the boundaries differ. Bridges stay within one selected scan object.

Preview with `mesh_process {entityId, previewOnly: true, operation: {kind:
"scanEdit", action: "fillHoles", mode: "bridge", indices: [startBoundary],
endBoundary: destinationBoundary, start: 0, end: 0, algorithm: "automatic",
tolerance: 0.001}, expectedRevision, requestId}`.
Use actual indices from the current inventory. Poll `job_get`; its result returns
`preview: true`, `sourceTriangleCount`, continuity `diagnostics` (`method`,
`addedTriangles`, `filledHoles`) and a JSON artifact containing only the added
triangle `positions` in world millimetres, with the same diagnostics. Preview
does not edit geometry or add history and does not display an agent overlay.
Omit `selectionOnly`, `createNew` and target fields for previews. Read-only MCP
previews reuse prepared topology without adopting their output as source geometry.
Committed bridges retain their successor index so the next inventory/edit does
not repeat welding and topology construction. Patch append shares untouched edge
records and copies affected edge uses; output-precision changes force a full
refresh instead of retaining stale adjacency.

To commit, repeat the operation with `previewOnly` omitted, a fresh revision and
request ID. The normal processing response reports the chosen method; one model
history step is added. `history_undo` / `history_redo` restore/reapply the bridge.
Reinspect boundaries after each edit, Undo or Redo; their indices may change.
Geometry locks, cancellation, revision checks and retry receipts remain active.
In Entire/Semi hole mode, hovering inside a visible closed boundary highlights
its full rim; clicking selects that hole in the list. Picking respects clipping
and occlusion and requires no cycling through the inventory. The hole list sorts by descending boundary length (the size shown in mm),
with stable ordering for equal sizes. The shared inventory report exposes
`holeOrder`, an ordered array of original closed-boundary indices; the
`boundaries` array and fill/picking references retain their original order.
Agents select the
same inventory indices through `mesh_process`; `viewport_get.bridge.mode` is
`holes` during this picker and `bridge` during a bridge gesture. Hole refinement
grades interior size around long fixed rim edges (including bridge rails) while
preserving those constraints and validating the resulting disk.
Refinement activates rim-size grading whenever a fixed boundary edge can raise
the local target size, including moderately uneven sampling. This avoids repeated
bisection failing to converge beside a valid unsplit rim; boundary vertices,
patch-size limits and disk validation remain enforced in the shared GUI/MCP path.
Batch hole filling (`action: "fillHoles"`, entire mode, multiple distinct
boundary indices or omitted `indices`) retains successful patches when another
hole exceeds refinement limits or does not converge. Failed holes remain unchanged
and count toward `diagnostics.skippedHoles`; `filledHoles` counts accepted patches.
This behavior is shared by the GUI and MCP. Cancellation, invalid requests and
unexpected errors still stop the operation. A single selected hole retains its
refinement error. Reinspect inventory after a batch to find remaining holes.
In the GUI hole picker, double-click a visible highlighted hole to attempt an
entire-hole fill with the current algorithm, independent of the selected list
row. Agents use the same operation through `mesh_process` with
`operation: {kind: "scanEdit", action: "fillHoles", mode: "entire", indices:
[boundaryIndex], algorithm: "automatic"}` (or the desired algorithm). Use the
original inventory boundary index. Busy or locked scans disable the picker;
clipped, occluded and open boundaries cannot be filled with this gesture.
While the GUI hole/bridge tool is open, `viewport_get.bridge` reports the hovered
`{boundary, edge}`, active drag source, picking readiness and preview triangle
count. Hovering does not run mesh generation. Picking uses the existing display
index for large scans; source clipping and occluding surfaces still apply.

Use `landmark_edit` to begin a picked-point session and add corresponding world
XYZ picks in the same order on each object. There is no fixed pair-count cap.
Three complete pairs automatically start a preview, and each subsequent complete
pair recomputes it through the same GUI/MCP operation. Edits cancel superseded
work and invalidate acceptance until a new result is ready. Poll `landmark_get`
for `previewStatus` (`idle`, `pending`, `ready`, `error`), `previewError` and
`pairCount`. Picks and removal remain available after preview. Unequal point
groups do not solve and cannot be accepted. Preview changes no committed geometry
or model history. For explicit recalculation or worker options, call
`landmark_preview` with a fresh revision/request ID and poll its job using `job_get`.
Reset drops the result and cancels computation, retaining picks without
immediately restarting; Preview or another complete-pair edit restarts it.

The GUI shows a large result view and two independent Fixed (top-right) and Moving (bottom-right) picking
views. Picking views preserve original poses, numbered landmarks and their own
rotate/pan/zoom cameras. GUI entry selects the first eligible reference; use
**Reference object** to choose another. `landmark_get.views` reports picking-view
`entityIds` and original-pose `markers`. `viewport_get`, `viewport_control` and
`viewport_pick` accept optional `view: "main" | "moving" | "fixed"` (default
`main`). The small views exist only during an active session; unavailable views
return an operation error. `viewport_pick` is read-only: pass its world-mm hit
coordinates to `landmark_edit` with `action: "pick"` and `entityId` to add a point.
For a reproducible isolated reference view, supply `fixedId` when beginning.
Unbound sessions still permit agent picks from any eligible captured reference;
the small reference view displays only the first eligible reference.
`landmark_get` exposes preview markers, coarse registration, surface refinement,
execution diagnostics and selected-triangle count. Indexed meshes default to two
logical lanes and bounded CPU parallelism; `workerCount` and `parallel` are
configurable on the preview tool. Selection counts use cached diagnostics.

Moving point clouds use the same paired solver followed by native double-pose
composition over retained local buffers. `landmark_get` reports `pointCloudPose`
for a cloud preview; `object_get` reports the committed pose. Normals, point type,
saved/active point selection and local point identities are preserved through
accept and undo. Preview does not change the source. A paired cloud solve sends
only picked coordinates to its processing worker; it does not transfer the full
cloud just to solve three point pairs. World views at or above 1,048,576 points
use the existing bounded transform pool when admitted, with at most two physical
workers. `parallel: false` or one logical lane uses the serial path.
Diagnostics expose `localBuffersRetained`, `pointCloudPose`, `points`,
`physicalWorkers`, `transformWorkers` (zero for the host serial path), and serial
fallback reasons. The same shared operation serves the legacy GUI processing
panel and `mesh_process` paired/ICP/global registration. Omit `selectionOnly` for
point-cloud registration; the whole cloud moves. ICP correspondence policy and
the original installed point-cloud dialog admission are separate verification
questions; retained-pose parity does not certify those workflows.

Call `landmark_accept` with a fresh revision/request ID after preview succeeds.
It uses the dialog's commit operation, rechecks source/target geometry and locks,
adds one history step and closes the session. Retrying an identical request ID
does not accept twice. `landmark_edit` reset removes a preview but retains picks;
`preview_discard` targeting `landmarks` closes the session and cancels its owning
preview job. `job_cancel` cancels computation without accepting geometry. Neither
path cancels unrelated API jobs. The GUI uses these same preview and commit
implementations.

For indexed point-pair scan alignment, `mesh_process` accepts
`operation: { kind: "paired", sourceLandmarks: [...], targetLandmarks: [...],
refineSurface: true, workerCount: 2, parallel: true }` with a fixed `targetId`.
Coordinates are world XYZ millimetres, with at least three corresponding points
per side in matching order. The moving object must be a raw indexed scan. The
fixed target may be another indexed scan or an exact CAD body with a live kernel
handle and cached face triangulations. Reveal hidden triangles and omit
`selectionOnly`. The shared worker
solves native coarse registration, maps moving landmarks to original vertex IDs,
grows a region to 3000 faces or stability, and refines using a 3 mm initial radius.
Before refinement, fixed target records are copied into one indexed mesh in
target order without welding coincident vertices. Facet indices receive each
target's vertex offset and target normals are regenerated on that combined mesh.
The GUI preview and both MCP entry points use this same preparation. CAD target
conversion reads existing kernel triangulations and evaluates analytic D1 surface
positions and normals at their UV nodes, with world placement and orientation,
without remeshing or changing the exact BRep. Missing
triangulations or expired handles report an error; recreate/reimport that body.
Prepared CAD records are cached by immutable kernel ID, bounded to eight entries
and 64 MiB; releasing a kernel handle removes its records. CAD retessellation
invalidates prepared records because kernel bodies can share face data. Cancellation and
revision checks run before and after asynchronous kernel acquisition.
Logical lanes default to two; the existing bounded CPU pool admits at most two
physical workers. `parallel: false` keeps the same logical lane reduction serial.

The shared picked-point session (`landmark_edit` with `action: "begin"`) defaults
to `targetScope: "visibleScene"`. `fixedId` still identifies the object used for
matching point picks. Refinement collects visible evaluated exact CAD roots first,
then visible raw indexed scans in scene order, excluding the moving scan. A CAD
input consumed by a later evaluated authoring result is omitted even if that
consumer is hidden. Construction planes, cylinders, cones and spheres alone do
not supersede the input. Priority follows authoring dependency order, independently
of the browser's display order. Original imported CAD without dependencies remains
eligible. Raw scan collection remains a separate pass. Cyclic authoring metadata
is rejected rather than assigning invented native update levels. Point clouds,
unindexed scans and construction displays are not surface-refinement targets.
At most 32 distinct published targets are admitted; reveal hidden triangles on
contributing meshes or hide the entire object before refinement. Additional
targets are read-only and may be locked; the moving and picked fixed objects
must remain unlocked. The dialog's **Refine against** selector exposes the same
choice as MCP. Set `targetScope: "fixed"` to retain single-target refinement.

If no eligible refinement surface remains (for example, a picked fixed point
cloud with `targetScope: "fixed"`), an indexed moving scan still runs native
seeded-region preparation after coarse registration. The refinement result is
accepted with an identity correction and the native maximum-float error sentinel;
that sentinel is not a measured fit quality. Grown selected faces are retained.
Diagnostics report one physical worker; requested logical lanes are preserved
without starting a pool. Parallel requests with multiple logical lanes report
`fallbackReason: "no refinement surfaces"`; explicitly serial requests retain
the usual `single-core requested` reason.
This behavior is shared by GUI preview and `landmark_preview`. Standalone fine
alignment still requires distinct usable fixed surfaces.

`landmark_get` reports `targetScope` and ordered `refinementTargetIds`. In internal
semantic workspaces, dependent reference points and lines preserve their CAD
source's target eligibility under the native primitive exemption policy, just
as planes, cylinders, cones and spheres do. The references themselves are not
refinement surfaces. Public reference creation/import remains gated. Change scope
with `landmark_edit { action: "target-scope", targetScope: "fixed" | "visibleScene" }`;
this clears the preview and retains the picks. Scene target geometry, visibility,
membership or order changes invalidate a visible-scene preview. Appearance-only
changes do not. Preview/accept preserve every target and commit only the moving
scan. Direct paired `mesh_process` with `targetId` continues to use that explicit
fixed target; use the session tools for visible-scene refinement. Point-cloud
surface refinement and complete native all-scene controller parity remain under
verification; this does not change the broader ribbon verification gate.

The output retains the coarse `registration` and its landmark residual for
marker placement, and reports the separate surface `refinement` matrix, objective
values, acceptance and iterations. Replacement indexed vertices and normals have
both transforms applied with Float32 storage between stages; replaying a composed
matrix does not reproduce these bytes. Diagnostics expose seeded region work and
physical/logical workers. An identity delta retains the grown face selection;
an applied delta clears it. Omitting `refineSurface` retains coarse-only compatibility.
This pipeline does not certify point-cloud surface refinement, fresh-face CAD
retessellation or full native scene collection. The ribbon point-pair command remains
gated pending complete scene-target and CAD/point-cloud workflow integration.

ScanForge exposes its browser-owned workspace through an official-SDK MCP stdio server. Agents and the editor use shared application operations, CAD evaluation, model validation and history. No hosted account, model provider or cloud geometry service is required.

Read this guide through the MCP resource `scanforge://agent-guide`. Discover exact input schemas through `tools/list` or `capabilities_get`. Read live state through `project_get` or `scanforge://project`. The application API version is **1.0**; the saved project version and MCP protocol version are separate contracts.

For agents changing ScanForge itself, [AGENTS.md](../AGENTS.md) requires every application change to retain or add equivalent MCP access through shared application operations. GUI-only changes are incomplete. Include MCP coverage, contract tests and updated agent documentation in the same change; missing parity blocks completion and commit.

## Setup for the human/operator

Requires Node.js 22.12+, installed repository dependencies, and ScanForge open in a modern browser. From the repository:

```sh
npm ci --ignore-scripts
npm run dev
```

Open `http://127.0.0.1:5173`. Alternatively build with `npm run build` and serve `dist/` on an allowed origin. The geometry runtime remains in the browser: closing it ends access; unattended headless modeling is not supplied by this integration.

Configure your MCP client to launch Node directly, using absolute paths. Do not use `npm run` as the stdio command: npm's startup text can corrupt MCP stdout.

```json
{
  "mcpServers": {
    "scanforge": {
      "command": "node",
      "args": [
        "B:/maliev-legacy/reverse-engineering-online/scripts/mcp-server.mjs"
      ],
      "env": {
        "SCANFORGE_MCP_TOKEN": "REPLACE_WITH_A_RANDOM_TOKEN_OF_AT_LEAST_32_CHARACTERS",
        "SCANFORGE_BRIDGE_PORT": "5184",
        "SCANFORGE_ORIGINS": "http://127.0.0.1:5173,http://localhost:5173"
      }
    }
  }
}
```

The path above is an example; substitute your checkout path. Client configuration syntax varies, but any client supporting MCP stdio can use the same executable and arguments. Generate a random token locally, for example with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Keep it in the client's secret/environment configuration, not source control. A client can also launch this server through its own MCP server settings.

In ScanForge, open **Settings → AI agent access**, enter `http://127.0.0.1:5184` and the same token, then **Connect agent**. The token is kept in browser memory only; it is cleared from the input after pairing. Closing Settings keeps the connection active. **Disconnect agent** revokes access and requests cancellation of current agent work. **Cancel agent operation** cancels work while keeping the connection.

The bridge binds only to `127.0.0.1`. Browser requests require the exact allowed origin, loopback Host and Bearer token. CORS preflight grants no workspace access. One paired browser owns a bridge at a time; a second browser receives HTTP 409. Polling renews a 60-second ownership lease. The server exits its HTTP service on client shutdown and after its eight-hour maximum lifetime; restart and pair again when needed. Different simultaneous workspaces require distinct ports/tokens/client configurations.

An idle long poll checks its actual wait and ownership deadlines after every timer
wake. Each replaced timer is explicitly cleared. An early timer is rearmed;
expired ownership ends the pending response with
HTTP 409 and releases it before a new browser pairs. The 8000 ms maximum poll
wait and existing command/session limits remain unchanged.

A hosted HTTPS page may be subject to browser local-network permission or connection restrictions. Grant the browser's local-network permission where supported; if blocked, serve the application locally on an allowed origin. Remote/hosted MCP transport and OAuth are not provided by this local integration.

## Agent operating procedure

### Browser project backups

Project backup and `.scanforge` export encoding share one serial background worker lane in supported browsers, keeping validation, geometry packing and compression off the viewport thread. GUI Save and MCP `project_export` use the same lossless encoder. Each encoder has a two-minute lease, releases on success/failure/MCP job cancellation/page exit, and does not transfer authored or history buffers. Encoder errors reject the operation; an existing successful backup remains intact.

`backup_list` reports the browser-origin backups, project identities, save times, file sizes, and the 30-second changed-project-only interval. Set `includeThumbnails:true` to receive WebP thumbnail artifacts; retrieve them using the artifact tools. Old backups can lack thumbnails. `project_get` includes the current `projectId`, and project exports retain it when reopened.

Use `backup_restore` with `backupId`, `replace:true`, `expectedRevision`, and a fresh `requestId`. It returns a job: poll until completion, then verify the current project and full undo/redo history. Restoration continues the same backup entry, including when selecting an old `:previous` snapshot. GUI Restore invokes this same operation. GUI file opening and MCP project import also retain a file's identity.

Use `backup_delete` with the selected `backupId`, `expectedRevision`, and a fresh `requestId` only when the user authorizes deletion. It removes that project's latest and legacy previous snapshots. The open model is unchanged; deleting its backup pauses automatic backups for the rest of this page session, preventing an interval write from recreating it. Its structured result reports `deletedProjectId` and `automaticBackupsPaused`. GUI Delete uses this same operation after confirmation. Storage errors surface as failed operations.

Backups are local to the paired browser origin and save changed data at 30-second intervals. Refresh or shutdown may lose work since the last completed interval. Stable project identities are shared across file copies; two tabs working on the same identity share its backup, with the last completed write taking precedence. New documents have separate identities. See [project files and recovery](PROJECT_FILES.md).

GUI and MCP document replacement release the previous pending automatic-backup
snapshot immediately. Saved-state change detection does not retain old geometry
or undo history. An already active backup can retain its snapshot until completion
or cancellation; the 30-second save interval and recovery contracts are unchanged.

Binary restoration decompresses directly into final readonly shared buffers when
cross-origin isolation is available, avoiding a second complete decompressed
geometry copy. GUI opening, MCP `project_import`, and `backup_restore` retain
the same chunk hash checks, buffer aliases, history, cancellation and fallback.

Browser binary project saves/exports of at least 64 MiB use temporary IndexedDB backing before
publication. MCP uploads checkpoint their accumulated bytes to the same disk
backing at each 64 MiB boundary. Successful staging deletes the temporary database
record; live immutable Blobs retain the bytes through browser-managed ownership.
Storage failures preserve the previous upload and report an operation failure;
retry from its reported size. Interrupted staging records expire after 15 minutes
and are swept on subsequent staging. Each open/transaction has a 30-second timeout.
Environments without IndexedDB retain ordinary Blob storage. Logical artifact
quotas, read/upload chunk limits and the process validation cap are unchanged.
Use a normal persistent browser profile for disk-backed large transfers. Chromium
private/incognito contexts keep IndexedDB Blobs in memory; they do not provide
the same memory reduction, even when IndexedDB APIs are available.

Save/export and automatic backups encode numeric geometry in canonical chunks of at most 1 MiB and stream compressed payloads into Blobs. Completed payloads are checkpointed through temporary Blob storage when the pending batch reaches 64 MiB, before encoding further payloads. A batch can exceed that threshold by its last payload; this is not a total-memory cap. MCP `project_export` uses the same codec, with unchanged project formats, geometry hashes, history and cancellation. A checkpoint failure rejects the save/export; automatic backups retain the previous successful file. Persistent profiles provide disk backing; private contexts and hosts without IndexedDB retain memory backing. Browser storage, individual compressed payloads and BRep text remain additional allocations. No new parameter is needed.

1. Read `scanforge://agent-guide`, then discover tool schemas.
2. Call `project_get`. Retain object IDs, feature IDs, units and the response's top-level `revision`.
3. For a mutation, supply that `expectedRevision` and a new `requestId` alongside command parameters.
4. If the tool returns a `jobId`, poll `job_get` approximately once per second until its status is `succeeded`, `failed` or `cancelled`. An accepted job is not a successful model edit.
5. Inspect returned diagnostics and affected objects. Use `project_get` again before the next mutation, particularly after a job, UI action, selection change or import.
6. Export requested outputs and retrieve their artifacts. Disconnect or delete unneeded artifacts when finished.

Never infer that an operation succeeded from a status message or transport success. Check `ok`, the job's terminal status and its result. Read the model state after modeling changes.

Project and backup restoration decode, validate and prepare current mesh display buffers in one leased background worker before replacing the workspace. GUI opening and MCP `project_import`/`backup_restore` share cancellation, failure handling and the two-minute lease. Failed or cancelled restoration preserves the open project. Large ordinary numeric arrays travel in lossless Float64 staging buffers with cooperative reconstruction, avoiding blocking structured-clone work during restore and automatic backup. Only newly created staging buffers or decoded worker-owned buffers transfer; existing authored and history buffers stay attached. Source geometry, scanner normals, selections and undo/redo history remain intact. Indexed display buffers borrow stored computed normals; older active indexed meshes initialize absent computed normals from their topology. See `docs/PROJECT_LOAD_PERFORMANCE.md` for earlier measurements and limits.

Exact CAD restoration refreshes kernel handles from saved BREP while retaining
the saved positions, normals, edge buffers and BREP in current, undo and redo
states. Reopening does not replace those buffers with a fresh tessellation or
reserialization. Identical BREP seeds reuse one restored handle; the restore
cache retains handles only. GUI opening, `project_import` and `backup_restore`
preserve the same saved values.

GUI Save, automatic backup and MCP `project_export` share concurrent encoding of
the same immutable snapshot. Each caller retains its own cancellation: cancelling
one export leaves another caller's backup running; the last cancellation retires
the worker. Different geometry, history, metadata or authoring state remains
serialized separately. The last completed file has only a weak cache reference;
existing consumers own its lifetime, and a collected result is encoded afresh.

GUI opening, MCP `project_import` and `backup_restore` can reuse matching immutable
shared chunk backing from an earlier restore. The decoder still reads every
incoming payload, compares its bytes and verifies its SHA-256 before publication.
A differing cached chunk receives independent backing without modifying its old
consumer. The browser keeps at most 128 weak backing references; this cache does
not retain a closed project, and page exit clears it. Hosts without cross-origin
isolation/shared buffers retain ordinary independent decoding. Public schemas,
geometry, history, revision checks, cancellation and failure recovery are unchanged.

Normal buffers may use compact Float32 storage internally. GUI opening and MCP `project_import` / `project_export` share validation and retain exact binary normal values, including signed zero; JSON exports continue to use numeric arrays. No format version changes. The connected Global Fine Align controller now has the bounded raw-mesh [preview workflow](#global-fine-align-preview-apply-and-cancel); exact-CAD support and complete original-application parity remain gated. It is distinct from the supported `mesh_process` coarse-registration kind `global`. See `docs/NATIVE_GLOBAL_FINE_ALIGNMENT.md`.

Undo/Redo and timeline selection initialize missing computed normals when an older
indexed history entity becomes active. GUI and MCP history operations share this
path; retained snapshots and authored scanner values stay unchanged. Existing
computed fields are reused, and `object_get` exposes the activated state.

Indexed meshes may contain `geometryNormals`, separate from scanner-authored
`normals`. It stores three finite Float32 computed components per original vertex,
including unused vertices. Import initializes this field with native angle-weighted
normals. Alignment and rigid transforms rotate the stored vectors through each
Float32 stage without regenerating or normalizing them. JSON exports represent the
field as a numeric array; binary project/backup codecs retain its exact Float32
values in current, undo and redo records without a format-version change.
`object_get(includeGeometry:true)` includes the field in its geometry artifact;
`object_geometry_digest` exposes `indexedMesh.geometryNormals` independently from
`indexedMesh.normals`, with the existing count, encoding, storage and SHA-256 data.

Global Fine Align borrows validated stored computed normals during shared GUI/MCP
preparation. Legacy indexed meshes without the field derive it in a disposable
worker and retain it on private acceptance entities; preview/cancel never changes
the original objects. The preparation summary reports actual derivation workers,
which can be zero for already prepared meshes. Malformed computed fields reject
preparation. Scanner-provided PLY normals remain separate and preserved.
The same preparation uses source mask `0`, retaining boundary vertices in source
sampling. `global_alignment_state` and the preview result expose this value in
`inputSummary.mask`. The earlier mask-1 boundary exclusion confused the native
target-index stride with its separate source mask. GUI and
`global_alignment_preview` share the correction; original topology, positions
and scanner normals remain unchanged. Preparation returns zeroed flags
at four bytes per indexed vertex without building boundary adjacency. Existing
512 MiB preparation admission and failure handling remain enforced; a storage
failure settles the preview job without applying geometry. See
`docs/GLOBAL_ALIGNMENT_SOURCE_FLAGS.md` for evidence and validation limits.

### Response contract

Successful tools return MCP `structuredContent` and equivalent JSON text. `screenshot_capture` additionally returns native MCP image content; its structured metadata omits the base64 image to avoid duplicating it:

```json
{
  "ok": true,
  "revision": 7,
  "result": { "entityIds": ["object-id"], "featureId": "feature-id" }
}
```

Failures return `isError: true` and:

```json
{
  "ok": false,
  "revision": 8,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Workspace changed; inspect project_get..."
  }
}
```

Bridge failures have code `BRIDGE_UNAVAILABLE` and may have no revision. An MCP connection alone does not establish a paired browser.

Mutation receipts retain the latest 256 request IDs in the current application instance. Retry a lost response with the **same requestId and identical arguments**, including its original expected revision: this returns the prior receipt, without executing twice. Reusing an ID with different arguments returns `REQUEST_CONFLICT`. Do not retry an ID after leaving that retention window or reopening the application; inspect state to reconcile it first. Receipts and jobs are transient, not crash-durable guarantees.

### See and navigate the application

Use `application_inspect` to read the current panel, ribbon tab, interaction mode, visible dialogs, bounded accessible controls, status/errors, progress and GUI preview presence. Password/token and file-input values are omitted. Request `maxControls` up to 300 when a larger control inventory is useful. Use structured inspection before spending image tokens.

`application_inspect.dirty` reports unsaved project changes independently of the
GUI reminder. The Save button pulses while dirty (unless reduced motion is
preferred); its elapsed-time message appears only on hover or keyboard focus.

Call `screenshot_capture` with:

```json
{
  "scope": "application",
  "format": "png",
  "maxWidth": 1440,
  "maxHeight": 1000
}
```

The tool returns an MCP `{ "type": "image", "data": "...", "mimeType": "image/png" }` content block that a vision-capable agent can view directly. Structured metadata includes dimensions, scope, timestamp, redaction policy and an image artifact ID. `scope: "viewport"` focuses on geometry; `format: "jpeg"` and `quality: 0.85` reduce transfer size. Read the artifact through `artifact_read` when saving or comparing image bytes, then delete it when no longer needed.

Captures render the current WebGL frame and the application DOM, including visible panels and dialogs. They exclude password/token controls, browser chrome, OS dialogs and other applications. DOM-to-image rendering can differ from browser-native screenshots, especially for nonembedded fonts. Limits are 2048 pixels per output dimension, 1 MiB per encoded image, 16 megapixels of source DOM area, 8 MiB for the frozen source viewport PNG and a ten-second deadline. `CAPTURE_TOO_LARGE` requires smaller dimensions or JPEG; `CAPTURE_BUSY` means retry after the current capture; `CAPTURE_UNSUPPORTED_ASSET` rejects remote assets; `CAPTURE_FAILED`/`CAPTURE_UNAVAILABLE` require inspecting browser readiness. There is no saved-thumbnail fallback.

The world-origin axes and plane-picking guides scale with camera zoom and viewport
height in both projections. Each axis uses a 60 CSS pixel length at origin depth
(its projected length varies with orientation); the origin dot stays six pixels
across. GUI navigation and `viewport_control` share this rendering, observable via
`screenshot_capture`. `settings_set.patch.originVisible` controls visibility; these
guides do not change world coordinates, sketch planes, or modeling history.

`viewport_get` reports projection, camera position/target/up/zoom, scene bounds and viewport dimensions. Use `viewport_control` with a fresh revision and request ID:

```json
{
  "expectedRevision": 7,
  "requestId": "frame-fixture-001",
  "action": "fit",
  "entityId": "actual-object-id"
}
```

Other actions are `rotate` (`direction`, `degrees`, optional paired `x`/`y`), `projection` (`orthographic`/`perspective`), `camera` (`position`, `target`, optional `up`, `zoom`, `projection`) and `sketchNormal` (requires the sketch editor open). Coordinates are world millimetres; rotation is in degrees. For selection framing, provide `entityId` and `selection: true` with a nonempty active triangle selection. `viewport_pick` takes normalized top-left `x`/`y` in `[0,1]` and returns ordered rendered-object hits and world points. Mesh triangle indices address rendered tessellation; point-cloud hits expose `pointIndex` instead. Neither is a native CAD face/edge reference. Picking does not change selection; use `object_select` or selection tools afterwards.

`ui_set` changes the ribbon tab, tool workspace, mode, tool-panel visibility or Settings visibility, and can dismiss the displayed error. It does not click arbitrary controls or accept GUI preview results. Changing workspace rejects an active GUI preview; inspect it, then explicitly use `preview_discard` with `target: "scan"`, `"surface"`, `"landmarks"` or `"sketchSection"` to discard the corresponding GUI preview. This uses the existing Cancel handlers, preserves committed geometry and remains available during GUI worker cleanup. It does not cancel API jobs; use `job_cancel` for those. Read visible control/status state to check the result. `settings_set` also exposes `normalsDisplay`; grid spacing uses the same supported bounds as the viewport. `settings_set.patch.automaticGrid` defaults to true and chooses readable floor intervals from visible model dimensions (10, 25, 50, 100 mm and other engineering steps). Set it false for a manual floor. `gridSpacing` always controls sketch snapping independently of automatic display spacing. State settings include `effectiveGridSpacing` and `scale` (`distanceMm`, `widthPx`, `reference: "view-center"`; null for an unavailable scale). The bottom-right scale bar updates with zoom and resize; in perspective it measures in the camera-facing plane through the orbit target.

Scan selection gestures are active only while the Edit Scan panel is open in the `mesh` workspace. Closing it or switching workspaces through the GUI or `ui_set` releases the brush, so double-clicking a visible scan can reopen Edit Scan. Agents can open the same editor with `command_run` and `name: "ribbon:editScan"`.

### Discover and recover efficiently

- `tools_search`: match query terms against tool names, descriptions, supported parameters and nested modeling subcommands, bounded to 20 results. Include `includeSchemas: true` only when needed; `tools/list` remains authoritative for all schemas.
- `session_get`: recover active and retained job IDs, progress/errors, artifact IDs/sizes and expiry. It omits binary contents and job results. A GUI-owned operation may make the application busy without an MCP job; `job_cancel` only targets API-owned jobs.
- `history_get`: inspect retained transition labels and the current cursor before `history_seek`. Redo entries retain their chronological order.
- `project_update`: rename the project while preserving objects, authoring, history and backup identity.

An efficient visual loop is: inspect application/project state → frame the relevant object → capture the viewport → perform a semantic modeling command → await its terminal job → inspect diagnostics and fresh state → capture again to verify the visible result. Camera and panel actions preserve modeling history. Refresh the workspace revision before model changes; do not infer success from pixels alone.

### Create a solid

Read `project_get`, then call `cad_create` with its actual revision:

```json
{
  "expectedRevision": 0,
  "requestId": "create-box-001",
  "name": "Fixture blank",
  "recipe": {
    "kind": "primitive",
    "input": { "kind": "box", "center": [0, 0, 0], "size": [40, 20, 10] }
  }
}
```

Result:

```json
{
  "ok": true,
  "revision": 0,
  "result": { "jobId": "job-id", "status": "running" }
}
```

Call `job_get` with `{"jobId":"job-id"}`. After success, the job result includes created object IDs and a feature ID. Refresh state before creating a dependent feature. References use `{ "featureId": "feature-id", "output": 0 }`; they are not browser worker handles. Use `cad_bind` on an imported exact object to obtain an imported seed feature, then reference that feature.

For example, a boolean recipe is:

```json
{
  "kind": "boolean",
  "operation": "subtract",
  "first": { "featureId": "blank-feature-id", "output": 0 },
  "second": { "featureId": "cutter-feature-id", "output": 0 }
}
```

Supply it to `cad_create` with `name`, the current `expectedRevision`, a fresh `requestId`, and optionally `hideInputs:true`. Inputs remain in the project for dependency rebuild and history. `cad_rebuild` takes an existing `entityId` and its replacement recipe, rebuilding affected dependents atomically.

### Import a scan and reduce it

Upload bytes through `artifact_put` with the original filename, base64 content and `offset:0`. For files larger than a chunk, append subsequent chunks with the returned `artifactId`, the same filename and the exact current byte offset. Each chunk is at most 1 MiB decoded; do not send the entire large scan as one MCP message. An empty first chunk can create the upload handle.

`capabilities_get.limits` reports `artifactBytes` (1 GiB aggregate),
`artifactCount` (64 handles), `artifactChunkBytes` (1 MiB) and
`artifactLeaseSeconds` (900 seconds of inactivity). Delete transfer artifacts
when finished to release capacity. An expired upload cannot be resumed; start
a new handle and upload from offset zero. Rejected appends preserve the retained
artifact. These are logical transfer-byte limits, not process-memory guarantees;
the shared importer's geometry and worker admissions still apply. The larger
transfer budget admits full-history aligned projects above 512 MiB without
changing the 4 GiB validation-process cap. Download and delete an exported
artifact before uploading another large copy to avoid charging both copies.

Call `project_import` with the completed `artifactId`, `unit:"mm"`, current revision and request ID. Units may be `mm`, `cm`, `m`, `in`, or `ft`; all workspace coordinates are millimetres. Importing a project requires `replace:true`, which replaces the workspace and its authoring/history. Export unsaved work before replacement. STEP/IGES/BREP units follow the existing CAD importer.

For several scans/CAD files, use `project_import_batch` with `artifactIds` in import order, a common `unit`, current `expectedRevision`, and a fresh `requestId`. GUI drop and file-picker imports use the same sequential queue. Workers prepare smooth normals, bounds and statistics before transfer; import completion waits for a viewport draw and paint opportunity. Full resolution is retained unless sampled preview was explicitly chosen. Each completed file is an independent model undo step. A batch returns `completed` import results plus `failed` entries containing the original zero-based file `index` and `error`. A failed file does not discard successful imports; cancellation stops the remaining queue and retains committed objects. Inspect `project_get` after cancelling. Project files must be opened separately; they cannot be mixed into a batch.

GUI scan imports and MCP `project_import` / `project_import_batch` preserve file
coordinates by default. Set `placeAtOrigin:true` to center each scan's XY bounds
and place its base on Z=0 after unit conversion. The matching GUI option is
**Settings → Scan import → Place each scan on origin**; its initial value is off.
Read the current preference at `project_get.settings.importPlaceAtOrigin` and
change it with `settings_set` and `patch:{importPlaceAtOrigin:true|false}`.
Omitting `placeAtOrigin` uses that preference, captured once for the import or
batch; an explicit boolean overrides it without changing the preference.
Changing the preference advances the workspace revision but does not move
existing objects or create a model-history entry.
This replaces the GUI's former unconditional centering so scans retain their
shared source frame. The option translates positions and indexed vertices;
orientation and imported normals stay unchanged. CAD and saved-project placement
are retained. Each accepted import still creates its own undo step.

PLY mesh import retains supplied finite vertex normals and expands them in original triangle order, alongside the indexed topology. GUI import and `project_import` share the same parser/worker transfer. `object_get` with `includeGeometry:true` exposes these normals in its geometry artifact; project save/reopen retains them. Files without normals keep the existing generated display normals. This does not enable the still-unverified main Align controller.

`object_select` accepts `toggle:true` (Ctrl/Command-click) and `range:true` (Shift-click); combining them adds a range. Range order follows the Objects list and skips locked/unselectable objects. The range anchor is the last ordinary/toggle selection; repeated Shift-clicks retain it. `project_get` reports `selectedIds`, `selectedId` (active object for single-object tools), and `selectionAnchorId`. Omitting `entityId` clears the object set. GUI and MCP share these semantics; selecting several objects does not make single-object modeling commands operate on every object.

Ctrl+Z/Ctrl+Y use model history in the main workspace. Mesh selection uses its local undo/redo while a local step exists, then falls back to model history. Text fields and modal dialogs keep their native keyboard behavior. MCP retains explicit `history_undo`, `history_redo`, and triangle-selection operations.

Press **V** to toggle each selected object's visibility, retaining the object selection. The entire set changes atomically, using the existing display behavior outside modeling history. Agents use `object_visibility_toggle` with optional `entityIds`; omitting IDs uses the current object selection. Explicit IDs support hidden and locked objects because visibility is a display setting. Empty/stale targets fail before mutation. Geometry and triangle selections remain unchanged. Typing, visible dialogs and busy operations keep V inactive.

**Scan Data → Colors → Auto colorize** assigns a different solid `#RRGGBB` sRGB object color to every object in scene order, including hidden and locked objects. It starts with a restrained CAD-style palette and extends it deterministically, checking uniqueness after RGB quantization. Repeating on an unchanged scene keeps the same assignments; adding, removing or reordering objects can change subsequent assignments on the next click. Up to 10,000 objects are supported, with no partial changes for empty or oversized scenes. Object colors persist in projects. Auto colorize disables the grey/red Normals view to reveal the assigned colors immediately. Selection, opacity, geometry and captured per-point RGB buffers remain intact; captured RGB and analysis overlays retain their existing rendering precedence. This follows existing display-metadata history semantics: modeling Undo/Redo does not revert colors. Agents call `scene_auto_color` with `expectedRevision` and `requestId`, receiving `changed`, `normalsDisplay: false` and `objects: [{entityId, color}]`; `object_get` and `project_get` expose the same assigned colors. The ribbon uses that same executor and its revision, retry and busy guards. No selection is required.

Press **Delete** in the main workspace to delete all selected objects in one Undo step. Text fields, dialogs, busy operations and mesh/sketch editing modes retain their own keyboard handling; holding Delete does not repeat deletion. Keyboard, ribbon and context-menu deletion use the shared `object_delete` operation. Agents can supply `entityId` for one object, `entityIds` (1–10,000 unique IDs) for a batch, or omit both to use the current object selection. Supplying both is invalid. The operation validates every target before committing: locked/missing objects, retained dependent features and split-output restrictions prevent the entire deletion. It returns deleted `entityIds`, plus the compatible `entityId` for a single target. Revision checks, retry receipts and modeling Undo/Redo remain in effect.

PLY mesh imports retain original vertex order and triangle indices. Full-resolution
binary STL imports retain connectivity reconstructed by the verified native reader
mapping, including quantized coordinate identities and collapsed-facet rejection.
Render coordinates use those mapped vertices, so they agree with indexed geometry.
STL previews and text STL imports do not provide indexed topology. `project_get`
reports `scanSource` counts; optional `acceptedTriangles` distinguishes full
native facet rejection from preview sampling while retaining input `triangles`.
Legacy projects without accepted counts retain their existing preview semantics.
`project_get`
and `object_get` report `indexedTopology:{vertices,triangles}` when that data is
available. `object_get` with `includeGeometry:true` includes `indexedMesh` arrays
in its geometry artifact. JSON and binary project exports preserve this topology,
including undo/redo snapshots. Whole-object transforms through the GUI or
`mesh_transform` retain vertex IDs and triangle connectivity while transforming
all indexed coordinates, including unused vertices. Whole-object `mesh_process`
alignment (`paired`, `icp`, `global`) also retains indexed topology through the
shared GUI/MCP worker, so the aligned scan can subsequently use surface refinement.
Selection-driven ICP still moves and preserves the entire source mesh. A partial
geometry extraction does not inherit whole-object topology. Other geometry edits
invalidate it; metadata edits retain it. A malformed or stale indexed topology in an imported project is
rejected. Older projects and other mesh formats can lack this optional metadata.

For recovered surface refinement, call `mesh_process` with moving `entityId`,
fixed `targetId`, and `operation:{kind:"nativeRefine",sampleBudget:500,initialRadius:10}`.
The equivalent GUI entry is Scan Data → Fine align, also available in the Main
Align options menu. Its ribbon gate covers this indexed surface-refinement
workflow; the separate origin/reference alignment commands remain unverified.
For multiple fixed surfaces, use `targetIds:["first","second"]` instead of
`targetId`. The ordered list accepts one to 32 distinct fixed mesh objects;
the moving object cannot appear in it. Distance ties retain the first fixed
target. Every fixed mesh remains unchanged. This parameter is exclusive to
`nativeRefine`. The GUI offers additional fixed surface checkboxes after the
primary registration target; additional targets follow checkbox selection order.
Both objects must be indexed meshes with no hidden triangles. Coordinates
and radius are millimetres; sampling accepts 1 to 100,000 vertices. Optional
`selectionOnly:true` marks vertices incident to selected moving triangles and
skips sampling, matching the recovered selection-only preparation path.
The GUI's **Refine indexed mesh surfaces** action uses the same request builder.
Full-resolution owner STL captures additionally verify source normals/sampling
and refinement results with two logical lanes; the shared operation is validated
with two actual browser CPU workers. See `NATIVE_ALIGNMENT_STL.md` for coverage,
limits and measured latency.
Refinement reuses worker-local triangle-query scratch without changing native
arithmetic or the GUI/MCP operation contract; full-resolution STL comparisons
still require exact native parameters, objective values, matrices and lane flags.
Origin/reference alignment is still disabled. `NATIVE_DATUM_ALIGNMENT.md`
records its recovered dialog routing, verified primary orientation and complete
plane-reference numerical sequences, point projection and direction construction,
including mixed-reference replay, picked-plane conversion math and Apply frame
inversion, fitted-feature axis/point payload conversion, and origin-reference
dispatch with stage-preserving flips and fitted scene-class reference resolution.
The authored fit-anchor adapter covers planes, cylinders, spheres and cones;
cones use the native apex/outward-axis convention verified by original endpoint
and surface-distance routines. CAD-plane reference math is verified on actual
trimmed faces using the original OpenCascade DLLs and controller, including
reversed-face behavior. Cylinder, cone and torus axis references are also verified
on 72 actual trimmed faces against the original CAD controller, with exact
point/direction/length output bytes. `alignment_references` exposes read-only
reference inspection through the same operation as the GUI's **Alignment
references** panel in Object properties. Pass `entityId`, optionally `centerAt`
(a world point in mm projected onto planar references), `offset` and `limit`
(1–100, default 50). This native job returns a `jobId`; use `job_get` to await
completion and `job_cancel` to cancel. It returns `units`, `total`, `nextOffset`
and reference records with stable object-local IDs, kind, source, point,
direction and optional length. Semantic reference points and lines, when present
in an internal workspace, return `source: "referenceConstruction"` with IDs
`<entityId>/reference/point` and `<entityId>/reference/direction`. Points copy
stored XYZ; lines expose the existing datum adapter's finite-segment midpoint,
raw direction and nonnegative stored extent as `length` (retaining signed zero).
A line does not also expose
a point constraint. `centerAt` has no effect on these stored point/line sources.
Invalid semantic payloads and nonfinite derived midpoints fail the job without
changing the source. These IDs can bind `alignment_preview` and `alignment_apply`
for supported moving scans/CAD; reference constructions remain read-only sources,
including when locked. The GUI source selector and properties inspection use the
same discovery path. Creation and project import remain gated pending the rest
of construction integration and rendered/native acceptance. Historical numerical
fixtures cover the adapter; this is not a new native GUI capture.
CAD records include face index and the matching
display triangle range. Fitted primitives expose only supported reference types;
unsupported CAD surfaces remain explicit unsupported records. When an exact
body also retains fitted primitive metadata, both sources are listed with
distinct IDs; an unsupported face does not suppress its fitted references. Bodies with no
exact CAD or fit metadata have zero references. Reads do not change geometry,
selection or history and may inspect locked bodies. Results are rejected if
the model changes during inspection, including fitted reference metadata.
Refresh after every model edit; face IDs are scoped to the current body/revision.
Inspection is bounded to 10,000 CAD faces and the existing 90-second kernel
timeout. API contract tests replay all 104 native reference captures, and the
browser/MCP integration test compares all six box-face coordinates with the GUI.
The supported manual frame workflow is described below. Automatic reference
bindings and the complete native dialog still require integration; the general
origin/reference ribbon command remains disabled.

The supported manual scan-frame workflow is now available through
`alignment_preview` and `alignment_apply`. Both are native-geometry jobs requiring
`expectedRevision`, `requestId`, `entityIds` (1–32 distinct unlocked mesh/point-cloud/exact-CAD
targets) and `constraints` (1–3 ordered references). Each reference has `kind`
(`plane`, `direction`, `point`), `point` (XYZ mm), `axis` (0=X, 1=Y, 2=Z; ignored
for points), optional `flip`, and a `direction` XYZ vector for planes/directions.
Use physical unit normals/directions from `alignment_references` when available.
Constructors are replayed in primary/secondary/tertiary order; incompatible
constraints fail without a model commit. Exact CAD targets retain their BRep geometry.
Preview returns the native frame, rigid inverse matrix and proposed scan bounds;
it preserves the model and history. `preview_discard` with `target:"datum"`
restores the committed scene. Apply records one history step and preserves
facet/point identities and saved selection slots. Identity transforms are no-ops.
Use `job_get`/`job_cancel`; cancellation or revision conflict before commit
discards the result. GUI Object properties invokes these same operations for
manual coordinates, axis/flip controls, canvas point picking and center-to-origin.
Feature bindings and frame-relative translation are available through the shared
operations described below; the general ribbon command remains disabled.
The **Use multiple CPU cores** option selects two logical native lanes. MCP
accepts `operation.workerCount` (1–16, default 1) and `operation.parallel`
(default true). Two bounded CPU workers execute admitted multi-lane searches;
memory or worker admission falls back to serial execution of those same lanes.
Use `parallel:false` with the same `workerCount` for numerical comparisons.
Changing the logical lane count can change native pruning and therefore output.
Diagnostics include `physicalWorkers`, `logicalLanes`, and `fallbackReason`.
Fixed query geometry is initialized once per worker, lane flags persist across
evaluations, and results are reduced in lane order. Workers are released on
completion, failure or cancellation and have finite idle and absolute leases.
The search uses its recovered fixed 1,000-evaluation budget and Float32 step;
the separate ICP maximum-iterations control does not apply to this action.
Results expose `refinement` with acceptance, matrix, parameters, initial/best
squared error and iterations, plus algorithm diagnostics. These objectives are
not RMS distances. Rejected searches preserve geometry and history; accepted
searches preserve indexed topology and use normal undo/createNew semantics.
Point clouds, unindexed meshes, CAD targets and hidden geometry are currently
rejected rather than silently routed to another algorithm. These remain gaps
in full native alignment parity. Cancellation terminates the worker under the
existing processing leases; native multicore execution is not enabled here.

After the import job succeeds, obtain its `entityId` and call `mesh_analyze`. To reduce a copy:

```json
{
  "entityId": "scan-object-id",
  "operation": {
    "kind": "scanTools",
    "operation": {
      "kind": "reducePolygons",
      "mode": "percentage",
      "percentage": 50
    }
  },
  "createNew": true,
  "expectedRevision": 3,
  "requestId": "reduce-scan-001"
}
```

The command is `mesh_process`. Inspect the terminal job result and new object's diagnostics. To edit exact CAD as triangles, first use `mesh_copy`; the exact source remains intact.

### Export and retrieve files

Call `project_export` with `{"format":"step"}` (or `project`/`stl`). Poll its job. The result contains `{artifactId,name,mime,bytes}`. `visible` defaults to true for geometry exports; project exports retain the whole project and its saved timeline.

For STEP, every included object must be exact CAD by default. Hide scan/reference
objects before exporting, or pass `cadOnly:true` to export only exact CAD within
the visibility scope. This explicit option returns `excludedEntityIds` alongside
the artifact fields; it rejects if no exact object remains. `visible:false`
includes hidden objects before applying that filter. `cadOnly` is STEP-only;
supplying it for project or STL export rejects. The GUI's Export STEP button
submits this same exact-only job, downloads its artifact and releases it. Both
paths use the shared artifact quota (1 GiB aggregate), owner/revision fences and
native/job leases. GUI cancellation remains reachable while busy; agents use
`job_cancel`. A cancelled late export publishes no artifact or history edit.

Call `artifact_read` with the artifact ID, byte `offset` and optional `length` (maximum 262,144). Decode each returned `base64` chunk, append in offset order, and stop at `eof:true`. Use the agent's own authorized file tools to save bytes at the requested location. ScanForge does not grant arbitrary filesystem read/write privileges. Delete disposable artifacts through `artifact_delete`; exporting does not mark the browser project as saved.

## Point clouds and landmark registration

See [point-cloud editing](POINT_CLOUD_EDITING.md) for selection, deletion, simplification, noise reduction and connected-selection MCP contracts.

`project_import` accepts `.asc` scans as point-cloud objects without artificial triangle faces. The default `xyz-rgb` interpretation reads integer colors with XYZ fallback; choose `ascAttributes: "xyz-normal"` explicitly for XYZ and optional NX/NY/NZ scanner columns. Choose the import unit as for other scans. Imported colors and explicit normals survive project round trips and rigid alignment. Results and summaries report `points`, rather than `triangles`. See [ASC attributes](ASC_ATTRIBUTES.md) for parsing limits and the shared preference. Triangle topology and mesh-editing operations reject point clouds.

GUI N-point alignment and `mesh_process` with `operation.kind: "paired"` use the same recovered landmark-registration wrapper. Supply matching `sourceLandmarks` and `targetLandmarks` XYZ arrays in world-space millimeters, with at least three points on each side. The returned transform maps the moving/source object into the fixed/target frame. It applies to the whole moving mesh or point cloud and leaves the fixed object unchanged. Scanner normals rotate with their object.

The recovered geometric gate rejects landmarks lying on a line or clustered too closely: when line fitting succeeds, the source landmarks must have at least 1 mm RMS distance from the fitted line. Choose widely spread landmarks. Failure leaves geometry unchanged; there is no fallback to a different fitting algorithm. Successful diagnostics identify `algorithm: "native-landmark-registration"`; RMS follows the recovered Float32 landmark conversion and fit, while maximum error is measured on those converted landmarks. `iterations: 1` counts the registration invocation, not internal simplex evaluations. ICP/global registration remains a separate implementation and is not covered by this landmark parity claim.

## Feature coverage

| Area                     | Tools / contracts                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and inspection | `capabilities_get`, `project_get`, `object_get`; schemas distinguish implemented commands                                                                                                                                                                       |
| Objects                  | Update display/name/locks, select, duplicate, delete, bind imported CAD, triangle copy; `project_new` creates an empty workspace with explicit discard                                                                                                          |
| Triangle selection       | Set/read/copy/cut/delete, all/clear/invert, persistent named selection save/load/delete; slots target a specific current triangulation                                                                                                                          |
| Scan processing          | `mesh_process`: polygon/noise reduction, scale, winding flip, repolygonize, average, mirror, unroll; repair, smoothing, decimation, segmentation; paired/ICP/global registration; scan components, eligible hole fill, boundary processing, defeature and split |
| Region operations        | Connected selection, morphology and scan section extraction through `mesh_process`; `selectionOnly` uses the selection on the specified selected object                                                                                                         |
| Analysis                 | Mesh topology, primitive fitting, sections, signed primitive deviations, distance/angle/radius/diameter measurements                                                                                                                                            |
| Exact CAD                | `cad_create` recipes: primitives, BREP, extrude, revolve, loft, sweep, NURBS face, compatible closed patches, patterns, mirror, transform, booleans, split, fillet/chamfer, offset, sewing, shell and thicken                                                   |
| Parametric edits         | `cad_rebuild`, persistent feature/output references, dependency validation and rollback                                                                                                                                                                         |
| Sketches                 | Read/write active Sketch v1, solve constraints, create/activate/rename/delete saved sketches; sketch recipes permit extrusion of solved profiles                                                                                                                |
| NURBS                    | Control grids, weights/degrees/knots, projected scan fit; grid creation, quad OBJ import, knot/crease operations, snapping, compatible C0/C1 joins/transition surfaces and shell diagnostics; exact face/closed-patch conversion through recipes                |
| History and interaction  | Modeling undo/redo and timeline seeking, standard camera views/fit, display/theme/grid settings                                                                                                                                                                 |
| Files and execution      | Local artifact upload/download, project/scan/CAD import, project/STL/STEP export, job status/cancel                                                                                                                                                             |

Polygon-reduction comparisons use the recovered octree for small surfaces and a linear-storage BVH for surfaces above 100,000 triangles or when the octree exhausts its node budget. GUI preview/accept and `mesh_process` with `scanTools.reducePolygons` share this path. The BVH still evaluates signed triangle distances with the existing numerical kernel, palette/search radius and tolerance statistics; comparison does not modify reduction output. Equal-distance BVH candidates use stable source-triangle order. Index construction and comparison retain cancellation checks.

Resident spatial reduction proves complete source vertex fans before separating fans disconnected only by a patch cut. The temporary representatives have identical coordinates and stay pinned at patch boundaries; fans that fail this check and locally unsafe facets remain protected. Original-to-reduced comparison retains unique samples and corner IDs without constructing original adjacency, using the same weld order for GUI and MCP. These improvements retain resident source/output arrays; disk-backed application loading is not yet enabled. Always inspect achieved counts and any protected-topology message rather than treating the requested count as achieved.

Full Sketch and NurbsPatch wire structures are shown below. Existing domain validators enforce their invariants. Operations outside the advertised schemas are rejected; do not inject native worker IDs, raw worker requests, executable code, or arbitrary geometry fields into a command.

Sketch v1 contains `version:1`, `points:[{id,x,y}]`, `segments:[{id,a,b,construction?}]`, optional `arcs:[{id,a,b,center,clockwise,construction?}]`, and `constraints`. Constraint kinds include fixed, coincident, horizontal, vertical, distance, horizontalDistance, verticalDistance, radius, tangent, parallel, perpendicular, equal and angle. Inspect an existing sketch or the source `src/sketch.ts` for each constraint's fields. Optional `frame` defines its position and orientation; frame definitions live in `src/sketch-frame.ts`.

NurbsPatch contains `format:"scanforge-nurbs"`, `version:1`, `countU`, `countV`, `degreeU`, `degreeV`, `knotsU`, `knotsV`, row-major `points:[[x,y,z],...]`, and `weights`. Surface fitting takes `options:{countU,countV,degree?,projection:"xy"|"xz"|"yz",sampleLimit}`. Knots and weights must satisfy the existing rational surface validator.

`surface_set` also accepts optional `scanId`, the ID of an existing mesh or
point-cloud source. `surface_get` returns that association as `scanId`; omitted
updates retain it. Missing sources and CAD sources fail before publication. The
GUI's freeform control-grid editor uses this same revision/retry guarded write;
each accepted edit adds one model-history step. Exact parametric CAD faces still
use `cad_rebuild` with a `surface` recipe. Mesh patch edits through `surface_set`
or `surface_operation` invalidate derived normals, edges, fitted-plane and scan
count caches while retaining the editable patch and source association. These
caches must be recomputed from the edited geometry.

Join compatible patches with `surface_operation` using `entityId`,
`operation:"join"`, exactly one of `referenceId` or `referencePatch`, and
`options:{referenceEdge:"u1",targetEdge:"u0",continuity:"C1",reverse:false}`.
Boundaries are `u0`, `u1`, `v0` or `v1`; continuity is `C0` or `C1`.
The target may be a mesh patch or exact CAD authored by a `surface` recipe.
Raw references use the NurbsPatch structure above, bounded to 2–16 controls per
direction and degrees 1–5. Seam degree, control count and normalized knots must
match. The reference stays fixed; locked workspace references remain readable.
Self-reference and exact-target downstream references reject before rebuilding.
Target and affected dependent locks also reject without publication.

The result includes `entityId`, `representation`, applied `options`,
`referenceSource` and `changedControlIndices`. Exact joins also return
`rebuiltFeatureIds` and `cleanupFailures` from the ordinary atomic CAD rebuild path.
One accepted join adds one model-history step; identical request retries reuse
the result. Use `job_cancel` to cancel. The GUI's NURBS surface panel submits this
same operation and exposes its owned cancellation outside the busy panel.
The joined patch is materialized, with no persistent seam dependency. C1 matches
transverse homogeneous derivatives in normalized parameters; it is not a general
surface blend or a native-reference equivalence claim.

Create a separate compatible transition with the same `surface_operation`
reference/options contract and `operation:"blend"`; optional `name` names the
new surface. The existing target must be an unlocked mesh patch or unlocked
exact authored `surface` target. Both sources, their metadata and native/BREP
handles stay unchanged, and the current target selection is retained. Locked
references are readable, including a snapshot of a feature downstream from the
target; blend does not rebuild either source. Self-reference is rejected.

Blend returns `entityId`, `featureId`, `representation:"exactCad"`, applied
`options` (including default `reverse:false`) and `referenceSource` as either
`{kind:"entity",entityId}` or `{kind:"patch"}`. Use `surface_get` to inspect the
new control net and `cad_inspect` for exact diagnostics. The new entity has an
independent editable `surface` recipe. Later source edits do not update its seams.
One accepted blend adds one model-history step; identical request retries reuse
the same job receipt. Native failure, cancellation or stale revision prevents
publication and retires newly created handles while retaining source/history
handles. Cancel the owned operation with `job_cancel`.

The supported bridge uses source coordinates in millimetres, compatible seam
degree/control count/normalized knots and the same 2–16 controls/degree 1–5
limits. C0 creates a linear transverse patch; C1 creates a cubic homogeneous
Hermite patch matching outward reference and inward target derivatives in
normalized parameters. `reverse:true` reverses reference seam order. Invalid
generated rational weights and invalid native faces reject. This materialized
transition has no persistent seam/source constraint and does not provide general
CAD-edge blends, G2 continuity or native-reference equivalence.

`surface_operation` also accepts exact authored `surface` targets for `grid`,
`quadImport`, `knot`, `crease` and `snap`, using the same dependent rebuild path.
Grid/quad control counts are bounded by the surface validator to 2–16 per axis,
with degrees 1–5. Quad import reads an uploaded ordered OBJ artifact; refinement
uses `axis:"u"|"v"` and a normalized interior `parameter`, with optional knot
`repetitions`. Snap takes the control `index` and optional `scanId`. Omission
reads the associated source if present, otherwise the target's display geometry,
matching the panel. Explicit missing IDs reject. External downstream CAD snap
sources reject before native work so the rebuild cannot change the read source;
own-display snapping remains available. GUI snapping submits this same job and
awaits publication with an owned cancel control. Other GUI control edits use the
same pure surface helpers followed by `surface_set` or `cad_rebuild`. Exact
results include `rebuiltFeatureIds` and `cleanupFailures`; all edits retain the
editable recipe, BREP, dependency locks and one-commit history semantics.

If a modeling job reports **CAD operation exceeded 90 seconds; kernel reset**,
its worker and native handles have been retired. Saved BREP, display geometry
and model history remain in the workspace. Export `format:"project"`, then
reopen that artifact with `project_import` and `replace:true` to restore exact
handles before further modeling or STEP export. GUI recovery uses Save project
and Open that `.scanforge` file. Preserve unsaved work with that project export;
do not replace the scene with a display-mesh export. The bounded browser timeout
test verifies project reopen, exact validity and subsequent GUI STEP export.

Use read-only job `cad_inspect` with `{entityId}` to inspect the object's saved
exact BREP. Poll `job_get`; `job_cancel` stops its separate diagnostic worker.
The Properties panel's **Inspect exact CAD** button calls this same operation.
It returns `units:"mm"`, BRepCheck `valid`, unique `solids`, `shells`, `faces`,
`edges`, `vertices`, analytic `areaMm2`, `signedVolumeMm3`, absolute `volumeMm3`,
and `topologyVisits`. Surface-only objects have zero solids and volume. Negative
signed volume remains visible instead of being silently reoriented. This is a
kernel validity report, not a global self-intersection or native-reference
equivalence certificate. Compare properties and topology after exact exchange;
display mesh counts and volume estimates are separate observations.

Trim exact surfaces with `cad_create` (or edit with `cad_rebuild`) using
`recipe:{kind:"trimSurfaces",source:{featureId,output:0},cutters:[{featureId,output:0}],keepPoints:[[-2,0,0]],toleranceMm:0.1}`.
The source and cutters must resolve to exact CAD. The Surfacing **Trim surfaces**
panel uses this same recipe; its point picker records world coordinates in mm.
Keep points choose the nearest unique split face region within the tolerance.
Use multiple points to retain multiple regions. Output is one exact surface
compound; this operation does not create solid caps. Inputs remain unchanged.
Use `hideInputs` and `selectCreated` on `cad_create` for presentation options.

Limits are 1–16 distinct cutters, 1–128 finite keep points, positive tolerance up
to 1,000,000 mm, 4,096 source faces, 4,096 total cutter faces, 1,000,000 face
pairs, 16,384 output regions and 65,536 region/point queries. Ambiguous points
on cut boundaries, off-surface points and nonintersecting cutters fail without
committing history. Source/cutter dependencies rebuild atomically; world points
that no longer identify a region must be corrected. Cancellation uses `job_cancel`.
The GUI also cancels pending picking/work when its panel closes. Projects retain
the editable recipe and exact BREP; STEP retains the exact trimmed shape.

GUI recipe-based CAD creation, Boolean, revolve, split and parametric rebuilding
submit the same `cad_create`/`cad_rebuild` jobs used by agents. Inspect them with
`session_get`, poll `job_get` and cancel with `job_cancel`. Their revision fences,
validation, late-result cleanup and one-commit history are shared. `hideInputs`
hides only referenced feature outputs, preserving unused siblings from a split.
A split's ordered output 0 is named `<name> inside` and output 1 `<name> outside`.
Several CAD ribbon commands remain gated pending full workflow verification;
experimental panel access is not evidence that their ordinary ribbon entry or
native-reference behavior is accepted.

`command_get`/`command_run` ribbon launchers now share the visible ribbon's
verification, source-selection and busy gates. A disabled experimental ribbon
entry is no longer advertised as an available command. The underlying shared
modeling tools remain discoverable independently. Loft, sweep, polygon extrusion,
revolve, Boolean, solid split and shell have matched ordinary ribbon/public-MCP
workflow receipts. Fillet/chamfer use the exact edge discovery described below.

For edge treatment, call `cad_inspect` with `{entityId,edgeOffset:0,edgeLimit:32}`.
Supplying either paging field requests `edgeReferences:{offset,total,nextOffset,items}`
and `inspectedRevision`; omitted offset is 0 and omitted limit is 32. Limits are
offset 0–200,000 and 1–128 items per page. Omit both fields to retain the existing
summary-only result. Each item has treatment `index`, curve `kind`/numeric
`curveType`, `degenerate`, analytic `lengthMm`, and available `endpoints` and
`boundsMm:{min,max}`. Endpoints follow curve parameter order, not topological
orientation; a closed curve can have equal endpoints. Bounds include kernel
tolerance. Degenerate edges retain indices but have kind `degenerate`, null
curve type, zero length and no editable curve endpoints.

Use discovered indices in the existing `edges` recipe with `operation:"fillet"`
or `"chamfer"`, positive `amount` in mm and the source feature/output reference.
Pass the report's `inspectedRevision` as `expectedRevision`. Rebuilds invalidate
references; re-inspect instead of replacing the old revision with the current
one. GUI Fillet/Chamfer use these same paged references, show curve geometry and
retain the inspected revision through Apply. Both ordinary ribbon entries now
have matched GUI/public-MCP discovery and modeling receipts. Owned CAD inspection
and trim cancellation stays reachable outside the busy tool panel and uses the
existing job cancellation path, preserving the live modeling kernel.

Inspection admits up to 64 MiB of UTF-8 BREP and 200,000 topology visits. Its
kernel has the existing 90-second timeout. Invalid BREP, missing exact geometry,
resource exhaustion and changed revision fail without modifying model/history.
Failure, timeout and cancellation dispose only the inspection worker; the live
modeling kernel and Undo-owned handles remain intact.

CAD import and modeling results pass BRepCheck before display tessellation or
native-handle publication. Invalid topology/geometry fails with the same repair
message through GUI and MCP, preserving the current model and history. Maker
completion or a renderable mesh alone is insufficient for exact CAD acceptance.

Surface fitting additionally accepts `method:"projected-grid"|"approximate"`.
Omitting it preserves projected-grid behavior. Approximate uses the recovered
XYZ basis, derivative penalties and column-normalized LU through the same worker,
selection extraction and transaction as the GUI. Set `regularizationWeight`
(finite, nonnegative; default `0.0001`) only with `method:"approximate"`.
The penalty weights are fixed at `[0,1,0.1]`. This method uses the existing explicit
projection and deterministic samples; full native UV initialization, iterative
parameter correction and automatic orientation/tolerance are not established by
the arithmetic fixtures. It does not reconstruct closed or overlapping surfaces.

Approximation admits at most 10,000 actual samples, 256 coefficients, an estimated
64 MiB workspace and 250,000,000 scalar work units before matrix allocation.
The default 10×10 controls with 10,000 samples fit this budget; larger combinations
may require fewer controls or samples. Resource rejection leaves source/history
unchanged. Its result includes `method:"approximate"`, `regularizationWeight`,
sample XYZ residual `rms`/`maxError` in millimetres and estimated `solverBytes`.
These are residuals at the supplied projected UVs, not closest-surface deviation
or a whole-native-controller parity claim. Existing projected-grid diagnostics
remain projected height residuals. Accepted controls use the saved patch's
V-outer/U-inner ordering after transposing the recovered core's U-outer/V-inner net.

`surface_fit` defaults to the entire input, retaining point-cloud support. Set
`selectionOnly:true` to fit the active raw mesh's selected visible triangles,
or the active point cloud's selected XYZ points. Hidden mesh facets are excluded
through the same extraction helper as GUI fitting. An empty, hidden-only,
mismatched or invalid selection is rejected before a worker starts. A changed
source or cancelled job cannot publish a fitted surface.
The accepted patch retains its source link and creates one history transaction.
This shared workflow does not establish numerical parity with the native fitter.

## Limits and recovery

- One operation admission lane protects the owning model. Lightweight state reads and job/artifact tools remain available while a job runs. A second geometry operation returns `BUSY`.
- Jobs expire after 15 minutes; mesh/surface/import workers also retain their existing shorter inactivity/hard leases. CAD retains its existing 90-second per-operation timeout. Cancellation is cooperative: synchronous native CAD may finish before its output is discarded and the lane is released. Poll the terminal job status; do not assume `job_cancel` completed native cleanup immediately.
- The latest 32 geometry jobs are retained. Artifact storage is limited to 64 artifacts totaling 1 GiB, with a 15-minute inactivity lease and 1 MiB decoded upload chunks. These are automation transfer limits; they do not change the shared importer's geometry/worker admissions or the editor's manual file limits. Delete completed transfer artifacts before the next large upload when needed.
- Primitive fits use at most 20,000 sampled vertices. Point-cloud selection slots identify XYZ records; mesh selection slots identify facets. Existing `analysis_fit` arithmetic is retained: `selectionOnly:true` extracts selected coordinates into Float32 storage before sampling; omitted/false uses original whole-source coordinates. Hidden metadata does not independently filter this primitive-fit operation. GUI empty selection retains whole-input fallback, while explicit MCP selection requires a nonempty mask. Section/deviation analysis is capped at 2,250,000 coordinates (250,000 triangles or 750,000 point samples); reduce a separate copy when needed. Modeling estimates are not certified metrology.
- Locked objects and affected locked dependents cannot be edited. Geometry changes invalidate stale triangle selection/authoring where applicable. Individual split outputs cannot be deleted alone.
- Edge/face references remain kernel indices. Refresh state and revision after topology changes. Persistent topology naming is not implemented.
- Unsupported geometry features remain unsupported: arbitrary automatic scan-to-solid reconstruction, scanner drivers are not created by MCP integration. ASC point clouds are supported by `project_import`; triangle-only processing rejects them. Browser-owned device permission dialogs and file choosers remain human/browser interactions; use file artifacts and semantic commands instead.
- `REVISION_CONFLICT`: reread state and reconcile intent; use a new ID for a changed request. `REQUEST_CONFLICT`: do not reuse an ID for a different command. `INVALID_ARGUMENT`: correct the published-schema parameters. `RESOURCE_LIMIT`: release transient artifacts or use manual import. `OPERATION_FAILED`: inspect its exact message and job diagnostics. `BRIDGE_UNAVAILABLE`: check the running MCP client, paired browser, token/origin/port and ownership lease.
- Native timeout resets can invalidate current browser handles; save retained BREP and reopen the project using the existing recovery workflow. Disconnect requests cancellation; it does not erase the user's project or persistent backups.

## Maintainer validation

```sh
npm run build
npm test -- tests/automation-api.test.ts tests/automation-operations.test.ts tests/authoring-operations.test.ts tests/browser-bridge.test.ts tests/mcp-server.test.ts
npm test
npm run test:cad
npm run test:mcp:browser
npm run test:mcp:visual
npm run format:check
```

The browser test uses installed Chrome, a disposable profile, an isolated static server and the actual MCP stdio executable. It closes its MCP child, browser and HTTP server in `finally` and verifies port closure. It does not use or alter an existing user browser session. See `docs/MCP_ARCHITECTURE.md` for extension rules.

### Dedicated Split mesh command

Split mesh is available in the Scan Data ribbon independently of Edit Scan. Agent access is unchanged: use `mesh_process` with a `scanEdit` request, `action: "split"`, and a cutting `targetId` (or the existing plane parameters). Smooth selected area and Defeature remain in the quick tools; MCP exposes `smoothSelected` and `defeature` through the same processing operation. Selected-area smoothing defaults to six passes with strength 0.5 in both the quick action and MCP; supply `iterations` and `strength` explicitly to override this preset (the previous preset was two passes at 0.5). Boundary smoothing retains its three-pass, 0.3 preset. Selection tools, clear/invert, and cut/copy creation retain their existing selection operations; the new icons are presentation only.

Coordinate alignment also accepts optional `translation: [x, y, z]` in mm. These offsets follow the constructed reference frame axes and are applied before rigid inversion. They are not world-axis translation. Both preview and apply return the offsets alongside the resulting matrix; omission means no offset. The GUI uses the same shared operation through Frame translation (mm). Translation inputs must contain exactly three finite values within +/-1e9 mm. Editing them discards the current preview; apply remains one history transaction.

Alternatively, pass `translationPoint: [worldX, worldY, worldZ]` to `alignment_preview` or `alignment_apply`. It is a finite world-space point in mm within +/-1e9, resolved against the current source-reference frame before offsets are applied. It replaces any supplied numeric `translation`. The result reports both the picked world point and the computed frame-axis `translation`; the picked point becomes the aligned origin while reference orientation is retained. References bound to object IDs are reread from the current revision. In the GUI use **Pick translation point on canvas**; editing a numeric offset clears the picked-point override. Preview, discard, cancellation and history retain their existing semantics.

Origin/reference constraints can bind current CAD faces or fitted features: `{ "kind": "reference", "entityId": "cad-id", "referenceId": "cad-id/face/0", "axis": 2, "flip": false }`. Obtain stable IDs through `alignment_references`; optional `centerAt` is passed to the verified reference conversion. Preview and Apply read those references again at the requested workspace revision. Missing, foreign and unsupported reference IDs fail before geometry mutation. Source objects may be locked because they are read only; moving targets must remain unlocked meshes, point clouds or exact CAD bodies. The GUI provides Reference object and Feature / face selectors with paged inspection and cancelled reads on disposal. Choose all requested features before previewing. Responses include resolved constraints in addition to the frame and resulting bounds.

Canvas CAD-face picking is available in the coordinate-alignment panel. `alignment_references` accepts optional `triangleIndex`, the original CAD render triangle slot returned by `viewport_pick`. It maps half-open tessellation ranges to exactly one face and returns that face's existing stable reference ID. Missing or ambiguous ranges fail; unsupported surface kinds stay explicit. Fitted-only objects cannot resolve a CAD render triangle. The GUI keeps the moving scan selected while picking a source face, reads the same shared operation, and cancels pending reads on panel disposal. Use the returned reference ID with `alignment_preview` or `alignment_apply`.

Coordinate-frame Apply uses the recovered native source-frame identity predicate at zero tolerance. Mesh/point normal transforms preserve native rotation-only arithmetic and signed zeros; translations never enter normals. These numerical corrections are shared by GUI and MCP alignment preview/apply, with native worker captures and public Apply regression coverage. Exact CAD uses its separately recovered axis-frame placement.

Spacebar repeats the last repeatable ribbon or keyboard tool/view command with the current selection and settings. File operations, deletion, selection changes, and undo/redo do not replace that command. Text editing, active dialogs/previews, held keys, and busy operations block the shortcut. Parameterized tool commands reopen their normal parameter panel; they do not silently reuse an old mesh or confirm a preview.

MCP: `command_get` lists command names, availability, `lastCommand` and `canRepeat`. `command_run` takes a discovered `name`, `expectedRevision` and fresh `requestId`; `command_repeat` takes the same revision/request guards and repeats the last command. Both return `{command, status: "launched"}`. This acknowledges a launch; inspect application/progress state or use the existing domain tools to finish parameterized workflows and verify asynchronous outcomes. Existing domain tool invocations do not replace the GUI repeat target.

Alignment `parallel` defaults to true. Large scan streams (at least 1,048,576 vertices) use up to two CPU workers when the browser has at least two hardware threads and admits the temporary memory. Small scans and unsupported/low-memory environments use cancellable serial chunks. `parallel: false` requests serial execution explicitly. Each target reports `execution.physicalWorkers`, `execution.chunkVertices` and a fallback reason. The GUI checkbox sends the same option. Worker input chunks are copied and transferred, never the model's original buffers; source coordinates, original index/facet slots and saved selections remain unchanged. Workers are released before Preview/Apply returns, on cancellation, or after a bounded timeout. This path uses CPU workers; GPU acceleration is not implemented here.

Identity frames take the native early no-op path: no coordinate buffers or CPU workers are created, the model and history remain unchanged, and bounds reporting stays cancellable. The shared result identifies this as `identity transform`.

Coordinate alignment results also return `cadMatrix`, the recovered exact-CAD placement matrix. It can differ slightly from the scan `matrix` because the original CAD path normalizes and orthogonalizes its axis frame. Exact CAD targets use OpenCascade axis-frame placement through the same GUI/MCP Preview and Apply operations, with a byte-exact matrix check before presentation. Scan targets continue to use `matrix`. CAD results retain exact BRep topology and rebuild display geometry; fitted centers/directions and scalar parameters are preserved through verified native primitive handlers; stale authoring recipes and display-facet selections are cleared. Each CAD target reports `execution.backend: "OpenCascade"` and `copyGeometry: false`. Preview replacement, discard, failure and cancellation release temporary CAD handles; Apply preserves both committed source and result for Undo/Redo. Identity alignment produces no new shape or history entry. The broad ribbon Align workflow remains gated independently.

The coordinate-alignment panel exposes an explicit **Objects to move** list when several eligible objects exist. It calls the same `alignment_preview` / `alignment_apply` contract with the checked `entityIds` (maximum 32). Meshes, point clouds and exact CAD bodies can share one frame and one history transaction; locked and unsupported targets are excluded. Changing targets invalidates the preview. An empty or unavailable target set disables Preview/Apply. If a later target fails, previously prepared CAD handles are released and every committed object remains unchanged. Explicit targeting is distinct from the original automatic model-selection policy, which remains under investigation.

Coordinate alignment preserves fitted primitive parameters through the recovered native geometry handlers. Target results expose `fit` and `planeFrame`; Preview owns these proposed frames while committed metadata stays unchanged. Mesh/point-cloud metadata uses `matrix`; CAD fit metadata uses `cadMatrix` and its plane frame is freshly extracted from the transformed BRep. Rigid movement preserves radius, height, top radius, RMS and maximum residual values. Plane normals and tangents are normalized using the native arithmetic. Sphere orientation metadata stays unchanged because the native sphere record has no direction parameter. Apply and Undo/Redo keep geometry and metadata together; this does not enable the unverified automatic all-feature controller.

Point-cloud coordinate alignment retains immutable local coordinates and normals
and composes a double-precision placement instead of repeatedly rounding stored
coordinates. Each target and `object_get` summary exposes `pointCloudPose`: 192
hexadecimal characters encoding twelve little-endian Float64 values in row-major
3x4 order. Geometry requested with `includeGeometry` remains in world coordinates.
Execution reports `localBuffersRetained`, `poseBits`, physical worker count and
fallback reason. Derived bounds and geometry still require CPU work under the
existing bounded worker admission; retained GPU buffers do not mean the entire
transaction is constant-time. Undo/Redo, preview discard and project recovery
retain the pose. Geometry-changing edits discard inherited placement when they
replace the world-coordinate buffers. Binary exports containing posed clouds use
manifest version 3, or version 4 when cloud attributes are present, and share
local buffers across history; the reader also accepts version 2. Construction
identity metadata selects binary manifest version 5, which also preserves cloud
attributes and placement. JSON exports include both world compatibility geometry
and placement, using wire version 2 for cloud attributes or version 3 for
construction identity metadata.

Ordinary objects may carry a persisted `constructionOrderKey`, exposed by
`object_get` as 32 lowercase hexadecimal characters. It is read-only through
`object_update`; duplicate an object through `object_duplicate` to receive a new
identity. GUI duplication uses the same operation. Project save/reopen and model
Undo/Redo preserve these keys, and duplicate or malformed keys within one scene
are rejected. Keys may recur across different history states for the same object.

Point/line reference construction remains under implementation. Its internal
codecs preserve precise semantic geometry and recipes, but GUI project opening,
MCP `project_import` and `backup_restore` reject files containing these objects
in the current scene, Undo history or Redo history. The failure leaves the open
workspace intact and reports that reference construction objects are not yet
supported. Such files must wait for reference rendering and operation support;
changing their version tags or removing semantic metadata is not a migration.
No reference construction command is advertised yet.

The internal cached-session core now checks versions and a 60-second lease and
consumes an exact cached Apply proposal. Public session commands, source
resolution and editor integration are still pending; agents cannot start these
sessions yet. See [session evidence](evidence/reference-construction-session-20261024.json).

The internal workspace binding preserves selection-only changes while retiring
cached results after model/history changes. It follows immutable geometry-carrier
publication and compares precise reference payloads through the lossless codec;
it does not hash scan buffers or admit native sources. Public session integration
is still gated. See [binding evidence](evidence/reference-construction-binding-20261024.json).

An internal host preview owner now supplies timer expiry, owner-scoped release,
display-restoration failure handling and cleanup-pending diagnostics after a
committed Apply. Its callbacks now reach the production viewport and stable host
proxy, but public session commands remain unavailable. See
[owner evidence](evidence/reference-construction-preview-20261024.json) and
[adapter evidence](evidence/reference-preview-adapter-20261024.json).

When an internal construction preview is present, `viewport_get` includes
`referenceConstructionPreview` with `ownerId`, `state` (`ready` or `retiring`),
`pendingDisposals`, `units: "mm"`, geometry, lossless `geometryEncoding` and bounds.
The preview is excluded from project/history counts and object picking.
Application inspection reports its `referenceConstruction` preview flag, including
retained cleanup. Timer expiry and API disposal now release this actual display;
failed cleanup stays owner-scoped for retry. This does not advertise a way to
begin/edit/apply a construction yet.

Production semantic display cleanup now retries unfinished detach/geometry/material
phases and staged replacement retirement. Shared GUI/MCP viewport picking remains
consistent after recovery. This is verified with real WebGL fault injection;
the complete construction preview adapter and public sessions remain gated. See
[display cleanup evidence](evidence/reference-display-cleanup-20261024.json).

An isolated rendered-viewport fixture verifies existing `project_get`,
`object_get`, `viewport_get`, `viewport_pick` and `viewport_control` with semantic
references. This does not open project admission or construction authoring.
See [rendered evidence](evidence/reference-rendered-viewport-20261024.json).

The internal projected-candidate selector returns an original index only. The
earlier CAD projection-to-axis composition was removed: correspondence between
its provider paths was unestablished. No reference construction tool was exposed
or removed. Source/provider resolution and shared lifecycle remain unfinished.
See [the correction evidence](evidence/reference-projection-selection-20261024.json).

Internal integration fixtures now expose stored reference common-source links
through existing `alignment_targets` dependency discovery. Transitive references
are reported in `dependentIds`/`references`; semantic objects remain blocked
movement targets. This does not enable reference import or authoring. Ordered
pick records alone do not create dependency links. See
[dependency evidence](evidence/reference-dependencies-20261024.json).

The internal shared average-line evaluator skips record binding when its common
source set is empty, retaining definition validation and prior-endpoint
finalization. Pair construction still requires record binding. This does not open
the construction admission gate. See
[the focused evidence](evidence/reference-empty-average-20261024.json).

The reference inspection contract is implemented for integration testing while
that admission gate remains closed. `object_get` and `project_get` report semantic
`points`, `lines`, `triangles` and Float64 `bounds.min/max` in millimeters.
`reference.geometry` and `reference.definition` contain readable saved values;
`geometryEncoding` and `definitionEncoding` retain exact numeric bits, including
signed zeros, across JSON transport. `includeGeometry` returns a geometry artifact
with `units`, `semantic` and `encoding`, rather than an empty triangle buffer.
The encoded form is authoritative when comparing bits.

`reference.evaluation` reports `{status:"stored", outcome:null}` because the
persisted internal completion word does not identify the last evaluation outcome.
Inspection does not evaluate the recipe or claim a successful/fallback result.
`sourceBindings` reports `identity-matched`, `missing-object`, `unassigned-key` or
`identity-mismatch` in saved common-source order. `recordBindings` retains each
line record's index and object presence, including duplicates; presence does not
establish a resolved geometric pick. Inspection never assigns keys or repairs
links. Mesh-copy, sampled analysis/editing and element-selection paths reject
semantic references before worker dispatch or mutation. These contracts do not
enable creation, import or dependency propagation.

The GUI geometry inspector and status bar use these same semantic counts and
precise bounds. A reference shows point/line counts and its position or bounds;
it does not show triangle vertices, surface area or mesh volume. Bounds-derived
display statistics refresh when the semantic payload changes, even if the empty
display carrier is reused. These display centers are bounding-box centers, not
the datum adapter's arithmetic convention. `ui_set` rejects brush/section modes
and sampled-geometry panels for reference selections before changing interface
state; choose a sampled mesh/cloud or CAD object for those tools. GUI navigation
uses the same validator. Element selection and section analysis also retain
their shared sampled-geometry rejection. Reference imports remain gated and
server-rendered inspector tests do not establish rendered/native GUI acceptance.

Reference viewport integration remains behind that import gate. Its point/line
display path is separate from triangle meshes and preserves authoritative
Float64 bounds for scene and object framing. Display vertices use Float32 offsets
from the stored start/point; offsets outside finite Float32 range fail explicitly
without replacing saved geometry. Canvas and `viewport_pick` use precise semantic
hit points and report `referenceKind:"point"|"line"`, `triangleIndex:null` and no
cloud `pointIndex`. Visibility, locking, selectability and clipping affect hits;
visible locked objects still contribute to the scene-scaled hit tolerance.
Reference picks remain outside triangle/point-cloud brush selection. Decorative
CAD edge lines do not become semantic reference hits. These CPU scene/raycast
contracts have automated coverage; rendered GPU/native acceptance, GUI statistics
and datum consumers remain outstanding.

The first alignment of a cloud loaded from a JSON project retains the active
point selection while converting local storage to Float32. Subsequent poses and
metadata-only changes retain the same point identities; geometry replacement
invalidates that selection session. This uses the existing shared alignment
operation and selection tools; no additional parameters are required.

`mesh_process` segmentation now retains each worker's region classification and fitted parameters in its new mesh object, matching the GUI's classified-region output. Its response includes `segmentClassifications` in segment order. Use the returned `entityIds` with `project_get` and `alignment_preview` / `alignment_apply`; fits remain derived session metadata and project import still discards them under the existing project policy. This transport correction does not change or certify the segmentation/classification algorithm.

Exact CAD `alignment_preview` and `alignment_apply` retain `surfaceScanId`, the
source-scan identity for a fitted surface, and report it in each target result.
The Object properties alignment panel shows the same reference by source name,
or by identity when that source is absent. The stale fitting patch is still
cleared after placement; retaining its source reference does not re-fit the
surface or move that source automatically. History and project files preserve
the reference.

Use read-only `alignment_targets` with `entityIds` to discover dependent features
before placement. It returns seeds first, then transitive dependent targets in
scene order, plus `dependentIds`, resolved reference identities, `blocked`
targets and `exceedsTargetLimit`. Raw mesh/point-cloud dependents are excluded;
source scans remain valid explicit seeds. Existing source-scan links and
parametric feature/output references supply the application dependency graph.
Locked, empty and unsupported targets are reported rather than silently omitted.
Review the returned IDs, resolve blockers and pass the list to
`alignment_preview` / `alignment_apply`. The GUI's **Include dependent features**
action uses this same discovery operation and updates its visible target list
before Apply. Discovery does not change geometry, selection, revision or history.

The collector matches all 6,144 captured native cases. Application graph mapping
and cycle bounds are separate implementation choices; complete native scene
acquisition, every authoring relationship and the general Align controller are
still unfinished. CAD placement currently clears stale parametric recipes, so
recipe-only relationships now survive as retained identity/link metadata;
retained source-scan links remain discoverable. This operation does not certify
all-feature alignment.

Nonidentity exact CAD placement stores `authoringLinks` when clearing a recipe:
its `featureId`, output slot, and resolved source entity IDs. Discovery indexes
that identity after baking and follows its retained links, including after
Undo/Redo and project save/reopen. Preview/Apply reports the metadata for each
target; the GUI displays the referenced object names or unresolved identities.
It preserves references, not an editable recipe or automatic regeneration.
Project format version 1 accepts this optional metadata with bounded, unique
reference identities; older projects remain supported.

`alignment_targets` also includes sibling outputs of a selected active
authoring feature and reports their IDs in `groupIds`. Review these along with
dependent targets. Placement rejects a target list that would leave an
incomplete output group or dependent recipe with a missing authoring source,
before allocating any CAD result. Include the complete discovered group before
Preview/Apply. Identity placement preserves recipes and needs no baking.

### Command-specific tool panels

`ui_set.workspace` accepts individual command panels: `fineAlign`, `repairMesh`, `segmentMesh`, `smoothMesh`, `decimateMesh`, `globalAlignment`, `landmarkAlignment`, `loft`, `sweep`, `fillet`, `chamfer`, `surfaceOffset`, `sewSurfaces`, `shell`, `surfaceThicken`, `splitSolid`, `linearPattern`, `circularPattern`, `mirrorBody`, `extrude`, `revolve`, and `boolean`. Panels share the inspector layout but mount only controls relevant to the active command. `application_inspect` reports that specific workspace and its accessible controls. Legacy `processing`, `advancedCad`, and `reconstruct` navigation resolves to `repairMesh`, `loft`, and `extrude`, respectively. Existing mesh and CAD semantic operations are unchanged.

Primitive fit controls are available in the `fit` workspace. Point-cloud reduction and noise controls use `pointReduce` and `pointNoise`; GUI Reduce polygons / Reduce noise routes to these when a point cloud is selected. Their existing semantic `mesh_process` point-cloud operations remain available. Unsupported mesh-only commands report a mesh prerequisite instead of opening an unrelated point-cloud editor.

`objectColor` opens the focused color control; `properties` retains the complete object inspector.

**Adaptive point display:** Auto density is enabled by default for point clouds,
including older projects. Set `object_update` patch fields `pointAutoDensity`
(boolean, default true) and `pointDensity` (10–100 percent, default 100); both are
available in the GUI display panels through the same operation. Higher density
shows more points. Disabling Auto density shows every eligible point. Read
effective settings from `object_get`. Main `viewport_get.pointCloudDisplay`
reports `entityId`, `autoDensity`, `density`, `eligiblePoints` (excluding hidden
slots), `sampleFraction`, `estimatedDisplayedPoints`, and `samplingMethod`
(`stable-sample` or `full`). Compatibility fields `cellSizePx` and
`maxScreenOffsetPx` are always null and zero: there is no display grid or point
displacement. Count estimates are before clipping/occlusion, not exact selected
vertices or GPU primitive counts. Explicit saved density and Auto on/off choices
are preserved; absent values use 100% with Auto density enabled.

The uniform screen-grid display has been reverted. Adaptive display uses a
deterministic original-vertex-ID hash to select a stable nested sample. Retained
points keep their original rendered positions, RGB and depth. Zooming in raises
the budget; density scales projected area divided by `(pointSize+1)^2`, with a
256-point budget floor. Sparse clouds and near-plane intersections retain full
display. Auto density off shows every eligible point. Hidden indexing, picking,
measurement, processing and exports remain full resolution. Very small isolated
features may require higher density or full display. This does not build a spatial
LOD tree or avoid processing source vertices on the GPU. Settings persist through
projects, backups and modeling undo. MCP revision/retry protection is unchanged.

Point clouds expose **Point size (px)** in both display panels (1–10 screen pixels, default 1). New ASC imports start in solid lime green `#aaff00`, including files with white or other RGB values; imported RGB stays available. For clouds with RGB, **Point colors** switches between file RGB and solid object color. Choosing an object color in the GUI also selects solid mode. The shared MCP operation is `object_update` with `patch: {pointSize: 1, pointColorMode: "solid", color: "#aaff00"}` plus the usual `entityId`, `expectedRevision`, and unique `requestId`. `pointColorMode: "source"` restores file RGB, falling back to object color when RGB is absent. `object_get` returns effective `pointSize` and `pointColorMode`; invalid sizes/modes and point-option updates to non-cloud objects fail atomically. RGB bytes and geometry remain unchanged. Display options persist through JSON/binary save, backups and modeling undo. On project/backup load, legacy clouds with no explicit `pointColorMode` and a previous white (`#ffffff`) or neutral (`#a6a6a6`) default migrate to solid green, including retained history. Explicit saved solid/source modes and other custom colors are preserved. Old projects otherwise use 1 px and source mode when fields are absent.

Project import and backup restore frame the restored visible geometry after it is
published to the viewport and await presentation before reporting completion.
This retains off-origin scan coordinates; it does not relocate geometry. GUI
recovery and MCP `backup_restore` share the project import path. Use `viewport_get`
to inspect the fitted `target` and visible `bounds`, and `object_get` to verify
the effective color/mode.

Reference-axis options are now computed by the same native-derived resolver in
GUI and MCP. `alignment_preview` and `alignment_apply` job results include
`referenceOptions` in constraint order: `enabledAxes` uses physical X/Y/Z order,
`axis` is the native default, and `enabled`, `visible`, `selectionCode` preserve
native radio order (plane Z/X/Y; direction X/Y/Z). These are eligibility
predicates, not a substitute for frame construction acceptance. Explicit MCP
axes remain explicit; the GUI disables incompatible choices and picks the
native default when selecting a new reference/type. Existing live bindings,
revision checks, cancellation and history semantics are unchanged.

`alignment_preview` and `alignment_apply` now follow native frame readiness:
at least one accepted reference makes the frame ready. A rejected reference
retains the frame produced by other references instead of failing the whole
request. Job results expose `referenceAcceptance`, one boolean per constraint,
and the GUI preview identifies references that did not constrain its frame.
Malformed inputs, unresolved live bindings, locked targets, cancellation and
transform failures still fail under the existing shared validation rules.

Alignment constraints can now use `{ kind: "origin", reference: "XY", axis: 2 }`.
`reference` is one of `XY`, `YZ`, `XZ` (world origin planes), `X`, `Y`, `Z`
(world origin axes), or `origin` (the world origin point). `axis` remains the
physical target X/Y/Z index 0/1/2, consistent with manual and object references;
optional `flip` reverses planes/axes and is ignored for the origin point. Both
`alignment_preview` and `alignment_apply` resolve these through the shared origin
payload adapter. Result `constraints` contains resolved numerical references.
The GUI's Origin reference selector uses the same contract in each slot; editing
point/direction/type switches that slot back to manual input. Origin choices
replace object bindings and require no source entity or CAD allocation.

`ui_set` accepts `datumAlignmentOpen: true` to open the same reference-based
alignment panel as the Main/Scan Data Align command. A selected, unlocked mesh,
point cloud or exact CAD target is required. Opening normalizes workspace to
`properties`, tool panel visibility to true and interaction mode to `inspect`;
contradictory workspace/visibility inputs fail. `application_inspect` reports
`datumAlignmentOpen`. Use `datumAlignmentOpen: false` to close an idle panel;
discard an active datum preview first. Opening never changes model geometry or
history. `command_run` with `name: "ribbon:align"` launches this same entry.
The primary command no longer invokes the unverified principal-axis placeholder.

Paired `mesh_process` registration uses moving coordinates in `sourceLandmarks`
and fixed coordinates in `targetLandmarks`. The worker now matches the original
candidate builder: fixed landmarks are passed first to the asymmetric native
solver, and its already-inverted moving-to-fixed result is published directly.
The previous opposite-order solve plus another inversion could give different
optimized candidates and spread-gate outcomes. RMS retains the native wrapper's
ranking residual; maxError is measured on transformed moving landmarks. Input,
cancellation, history and worker contracts are unchanged. This fixes the initial
candidate; the native subsequent full landmark-preview refinement is still a
separate incomplete path, and the point-pair ribbon remains independently gated.

### Indexed scanner normals in alignment

PLY scanner normals are retained as authored corner normals and as optional
`indexedMesh.normals` in original vertex order, including unused vertices. These
authored fields are distinct from the derived display-cache normals. `object_get` with
`includeGeometry:true` returns those indexed normals in its geometry artifact.
JSON, streamed JSON and binary project save/reopen preserve them. Older projects
without this optional field remain supported.

`mesh_process` with `operation.kind:"nativeRefine"` automatically uses supplied
indexed scanner normals without regenerating or normalizing their magnitudes.
Meshes without this data use the existing native-derived normal generator.
Paired/ICP/global and origin/reference alignment rotate indexed normals with the
scan; metadata changes retain them and invalidated topology is discarded.
`mesh_transform` preserves normals through rotation, without applying translation
or uniform scale to the vectors. GUI and MCP alignment share the same staging
operation, which derives display-cache normals from the transformed indexed
geometry. It does not use the authored scanner normals for that cache. Native
rendering parity remains unverified; see
[the original PLY staging comparison](NATIVE_GLOBAL_ORIGINAL_PLY_STAGING.md).
No new operation parameter is required.

# Picked-point alignment session editing

`landmark_get` reads the active session, original world-coordinate picks, preview
markers and preview lock. `landmark_edit` begins a session with `movingId` and
`fixedId`, or performs `pick` (with `entityId` and a three-coordinate `point` in
mm), `remove-last`, `clear`, or `reset`. Supply the current `expectedRevision`
and a unique `requestId`; retries return their original receipt.

After preview, picking fails and removal/clear leave the points unchanged.
Reset removes the transactional preview and retains original picks and geometry.
Cancel with `preview_discard` targeting `landmarks`. These session edits do not
solve or accept alignment and do not create model-history entries. The complete
native point-pair command remains gated; this tool does not certify its full
numerical pipeline or expose acceptance. GUI and agent edits share the same
state guards and double-precision preview-marker arithmetic.

## Seeded surface refinement

`mesh_process` with `operation.kind:"nativeRefine"` accepts optional
`seedVertices:[0,15,42]`: zero-based IDs in the current original indexed source
buffer, obtainable through `object_get` geometry. Use fresh IDs after topology
edits. GUI Fine align exposes the same option under Landmark refinement region.
The shared worker resets vertex selection and grows snapshot rings until the
selected face count reaches 3,000 or stops changing. All selected visible region
vertices participate; `sampleBudget` is ignored for this seeded mode, and the
whole scan moves. Radius and logical worker count retain their existing meanings.

Omit `selectionOnly` when supplying seeds alone. With `selectionOnly:true`, a
nonempty existing triangle selection is still required; its face flags contribute
to the native stopping count. Diagnostics include `seedVertices`, `seededFaces`,
`seedGrowthPasses` and `seedFaceReferences`, plus the existing CPU execution
diagnostics. IDs and sizes are validated, worker transfer copies seed buffers,
and preparation allocations are limited to 256 MiB. This is a preparation option
for verified surface refinement, not certification of the complete point-pair
coarse/refinement pipeline.

Datum alignment preserves finite, non-unit scanner normal magnitudes, including
values above the coordinate-size limit. Coordinate limits still apply to
positions, and nonfinite normal outputs are rejected. GUI and MCP datum
operations share this correction; no new parameter is required.

Selection-only and seeded `nativeRefine` now prepare query records only for
selected visible vertices. Indexed order, source flags and scanner normal values
remain unchanged. Supplied normals avoid full-size coordinate/normal copies;
when normals are absent, the existing full-mesh normal computation remains.
Inactive records still undergo validation. This optimization is automatic for
GUI and MCP; sampling and CPU lane settings are unchanged.

Alignment target preparation uses exact numeric edge keys where the vertex ID
range permits safe integer packing, with a string-key fallback for larger
ranges. Successful seeded refinement clears the face selection without a
per-face callback. Both optimizations are automatic in the shared GUI/MCP
processing path; agent parameters, CPU lane settings, cancellation and native
results are unchanged. The measured owner-scan comparison and its limits are in
`docs/evidence/alignment-preparation-performance.json`.

Point-pair landmark picks (`landmark_edit`, action `pick`) use native Float32
world-coordinate precision, widened to doubles for storage. GUI and MCP share
this rounding. Finite doubles outside the Float32 range fail without changing
the session; inspect `landmark_get` for the stored coordinates.

Point-pair sessions can begin with only `movingId`; `fixedId` is optional.
`landmark_get` returns `fixedId: null` for the all-reference picking filter and
`referenceIds` for the captured visible, selectable, unlocked reference objects.
Points on the moving scan form M; points on any captured nonmoving reference
form F, in insertion order. A bound fixed target filters GUI picking, while
refinement scope remains independent. Use `landmark_edit` with action
`reference-target` and `fixedId` to bind a filter, or omit `fixedId` to clear it.
Changing that filter clears picks and preview; clearing also selects visibleScene
refinement. Fixed-only refinement requires a bound reference. These session edits
create no model history. Picks retain each reference identity, and reference
geometry changes or removal invalidate acceptance. Newly imported references
require rebinding the filter or restarting the session to capture the new scene.

An ordinary successful point-pair preview has one candidate. `landmark_get`
reports `candidateCount`, `candidateIndex`, `canPreview`, `canReset` and
`canRemove`. After preview, use `landmark_accept` or `landmark_edit` action
`reset`; a new `landmark_preview` request requires reset first. Reset retains
picks and committed geometry and creates no history. Repeated requests using
the original request ID retain normal idempotent receipt behavior. A failed
registration does not publish an empty preview.

Object rename: F2 opens the rename dialog for the current object selection. Use object_rename with name and optional entityIds over MCP (omit IDs to use the selection). A single target receives the trimmed name; multiple targets receive name - 1, name - 2, etc. in Objects-panel order, in one transaction. Names retain the existing metadata behavior: geometry undo does not revert them. Selection and geometry are preserved. Names must remain within 200 characters including the numeric suffix. Normal revision, retry and busy guards apply.

Canvas landmark picking uses the same world-point extraction as `viewport_pick`:
mesh hits retain their surface intersection, while point-cloud hits use the actual
measured vertex transformed by its world pose. `landmark_get` reports the resulting
Float32-rounded records. Moving/fixed pick modes filter canvas hits; picking and
cancel do not create modeling history. This integration check does not certify original native hit testing. The ordinary
point-pair entry is available with the source policy below; split view remains separate.

The ordinary point-pair ribbon entry and `command_run` name `ribbon:alignNPoints`
share source resolution: prefer the active eligible scan, then a uniquely selected
scan, then the sole eligible scan in the scene. A second object is not required
to open. `command_get` reports availability. Hidden, locked, unselectable, empty,
CAD, parametric and fitted-surface objects cannot be moving command sources.
Point-cloud eligibility is an application extension of the native mesh selector.
The command opens the same `landmark_edit` session without creating history;
explicit `landmark_edit` begin continues to accept a caller-specified moving ID.
Preview/reset/accept, cancellation, revision checks and active-dialog admission
remain shared with the GUI.

Alignment query workers on isolated origins read one shared packed target tree
directly and initialize together when the parent tree, packed buffers, target
arrays and source lanes fit the existing 128 MiB pool cap. Nonisolated pools
retain object-tree transport and sequential startup. Oversized targets retain
serial fallback. This is automatic for GUI and MCP alignment and adds no request
parameter. Native traversal order, logical lane reduction, results, cancellation
and diagnostics keep their existing contracts. Full-file native equality and
timing scope are documented in `docs/ALIGNMENT_PERFORMANCE.md`; two workers do
not imply a measured speedup for every selected region.

Viewport surface picking is accelerated by the same background-built display index for canvas interactions and `viewport_pick`; no new agent parameters are required. Triangle IDs and clipping semantics are preserved, with ordinary picking available while the index builds. See [viewport performance](VIEWPORT_PERFORMANCE.md).

### Object selection responsiveness

`object_select` uses the same operation for object-tree clicks and MCP requests. It applies selection without opening/closing the global processing indicator. Revision validation, identical-request replay, the single operation admission lane, selection modifiers and structured selected-ID results are unchanged. Selection does not alter authored geometry or add a modeling-history entry.

When an Interactive mirror display provider is installed, `viewport_get` also returns `interactiveMirror` with `active`, `pending`, `ready`, `error` and `sourceCount`. Pending camera work does not imply a geometry edit. A failed display keeps its failure message and does not retry on every frame. This diagnostic does not advertise an enabled Interactive command: its complete App/dialog and public operation integration remains gated.

### Interactive scan alignment

Use `interactive_alignment_get` to inspect the active session, immutable target references, Double poses, Float32 measured bounds, version, settings and worker diagnostics. `interactive_alignment_edit` with `action: begin` accepts one to 32 distinct selected raw mesh or point-cloud IDs (or the current selection). Hidden, locked, unselectable, empty, exact-CAD and parametric targets are rejected. Finish competing previews/dialogs first.

In the GUI, press `R` in Main or Mesh selection mode to begin Interactive alignment for the current eligible selection. The shortcut invokes the same `interactive_alignment_edit` operation with `action: begin`; agents can begin directly through MCP and inspect the session with `interactive_alignment_get`. Typing, held keys, busy operations and active dialogs block the shortcut. Right view uses `Shift+R`; sketch mode retains `R` for three-point arcs.

Subsequent edits require `sessionId`, `expectedSessionVersion`, the current project `expectedRevision` and a fresh `requestId`. Supported actions are `configure` (integer drag strength 0–100, mesh mirror preview and XY/YZ/XZ plane), `step` (rotatePositive/rotateNegative/translatePositive/translateNegative, axis 0–2 and finite value), `reset`, `currentView` and `drag`. Drag points are normalized top-left viewport coordinates; pointer capture may extend beyond the viewport. Handles 1–3 translate in YZ/XZ/XY planes, 4–6 translate X/Y/Z, and 10–12 rotate X/Y/Z. Other native handle modes are not advertised. Mirror preview requires a selected mesh; point clouds retain ordinary pose preview. Native rendering/pixel parity is not claimed.

GUI and MCP share these operations and the same live session store. Preview changes GPU matrices without baking authored geometry or adding history. Measured bounds are fresh after numeric steps and Current View; fast drags, Begin and Reset do not publish measured bounds. `viewport_get.interactiveMirror` reports asynchronous mirror readiness/failure. Unrelated geometry, selection, launchers, import, history and preview edits are blocked while the session owns the scans. Camera navigation remains available.

`interactive_alignment_apply` returns a cancellable job receipt. Poll `job_get`; success bakes the poses once and creates one history entry if geometry changed. Computed viewport scale and effective grid spacing remain observable in `project_get.settings` but do not change the project revision, so camera motion or layout updates during Apply do not cause a workspace conflict. Actual project and authored setting changes still invalidate running work. Use `preview_discard` with `target: interactive` (or GUI Cancel/Escape) to cancel and release the session pool/display without changing committed geometry. It does not invoke another preview's discard handler. Refresh session versions after each accepted edit; identical requests retain the existing retry contract. See [native alignment evidence](NATIVE_INTERACTIVE_ALIGNMENT.md).
Camera navigation picks the surface under the pointer once at orbit start and keeps that world point fixed throughout the drag, without changing the initial framing. While a visible large mesh has no ready CPU surface index, a temporary GPU depth pass picks the visible mesh, point-cloud or line surface with transforms and clipping, without a synchronous full-scan query. Each new gesture uses the pointer surface, then the view-center surface, then the center ray at the depth of the visible model bounds center; previous gesture pivots are never reused. Large point clouds use rendered depth too, including the displayed point size, transforms and clipping. Ordinary selection and MCP `viewport_pick` retain their exact hit and triangle-ID contracts.

MCP `viewport_control` with `action: "rotate"` accepts optional paired `x`/`y` coordinates in normalized top-left `[0,1]` space. Supply them to rotate around that visible surface using the same surface picker and orbit correction as mouse navigation; a pointer miss uses the view-center surface and then screen center at the depth of the visible model bounds center, matching mouse rotation. Omit both for the same frame-centered rotation. The camera look-at target can have an unrelated depth after earlier surface rotations or panning and is used only if there is no model depth to resolve. Read `viewport_get` before/after to inspect the camera result.

A small green rotation-center dot appears while middle-button orbit is held, at the fixed world-space pivot (or actual target fallback), and hides on release/cancellation. It is clipped outside the view and does not intercept pointer input. `viewport_get.orbitCenter` reports `source` (`mouse`, `spacemouse`, or null), world-mm `point` (or null), and `markerVisible`; this is the same state used to draw the dot.

### Curvature-aware Defeature

`mesh_process` with `selectionOnly: true` and
`operation: {kind: "scanEdit", action: "defeature"}` uses the same
surrounding-curvature reconstruction as the GUI. Select the entire feature and
leave a clean surrounding collar. Job diagnostics expose `curvaturePatches`,
`curvatureFitRms` (model units) and `curvatureFallback`; unsupported collars retain
the spatial-fill fallback. Requests, cancellation, revision checks and history
semantics are unchanged. See
[Defeature reconstruction and limits](DEFEATURE_CURVATURE.md).

### Working job status at the pointer

All shared mesh/scan worker jobs, including Defeature, publish their current stage
and progress to one app-level pointer label. It displays the stage with a muted
2-pixel linear bar instead of numeric percentage text. Unknown progress uses a
static, dim segment without pulsing or sweeping animation. CAD and import
operations use the app's existing busy message and available import progress. The label
appears only when the pointer is directly over the exposed 3D canvas. The ribbon,
object list, floating tool panels, dialogs and leaving the app hide it. A panel
covering a stationary pointer also hides it. There is no center-screen fallback
before a pointer position is known. Placement flips and clamps within the canvas;
the label never intercepts input.

Success, failure and cancellation release each worker's status through its
existing cleanup path, preserving queue timing and ownership. Existing Cancel
controls remain available. `application_inspect.progress.working` exposes the
full job text, including numeric percentage, even while the pointer label is
hidden. This full text remains in `application_inspect.statuses`; the visible
label exposes its stage and an accessible progressbar value. MCP `job_get` progress,
request schemas, model/history semantics and geometry behavior are unchanged.

## Automatic hole surface recovery

Automatic entire-hole filling (`algorithm: "automatic"`, `mode: "entire"`)
fits a local quadratic to retained, connected scan faces when the collar is
smooth and sufficiently supported. Steep, creased, underdetermined or poorly
fitted collars use positive boundary-edge height interpolation instead of
extrapolating scan normals into a pit. The fallback stays within the rim's
height range in the cap frame; it cannot reconstruct missing curvature without
reliable support. Existing rim and retained vertices stay fixed. Explicit flat,
tangent and curvature algorithms, partial fills and bridges keep their behavior.
Both GUI and MCP use the same `mesh_process` scan-edit operation. Successful
results expose `diagnostics.surfaceFitHoles`, `surfaceFitMaxRms` (model units),
`boundedFallbackHoles` and `surfaceFallbackReasons`. These count accepted patches;
`method` retains the selected algorithm category. The GUI reports how many holes
were filled from the boundary. Unsupported or invalid disks still remain unchanged
and count as skipped.

## Constrained hole triangulation

Entire-hole fills (`mesh_process` with `kind: "scanEdit"`, `action: "fillHoles"`,
`mode: "entire"`) legalize cap diagonals before density refinement and during
final fairing. A bounded, cancellable queue replaces long, thin ear-cut fans with
local triangles, avoiding excessive subdivision on long narrow scan openings.
Existing rim vertices stay fixed. Cap interior edges cannot reuse diagonals of
the retained mesh: those diagonals are flipped away or subdivided inside the cap
to avoid duplicate facets and nonmanifold edge connections.

GUI and MCP share this triangulation and the existing `addedTriangles`,
`filledHoles` and `skippedHoles` diagnostics. No new parameters are required.
The 100,000-triangle patch limit, refinement limits and single-hole/batch failure
semantics remain enforced; genuinely oversized patches still fail safely.
Surface estimation, model history, undo/redo and cancellation use the existing
shared operations.

### Verified watertight reconstruction

`mesh_process` with `operation:{kind:"scanTools",operation:{kind:"repolygonize",resolution:0.5}}` accepts optional top-level `targetIds` for up to 32 additional aligned raw meshes, excluding the source. Additional inputs remain unchanged; the source is replaced unless `createNew:true`. GUI and MCP share reference validation, reconstruction and topology verification. Successful jobs report topology counts plus `diagnostics.watertight`, `inputMeshes`, `resolution`, `weldTolerance` and `selfIntersectionsChecked:false`. Closed disconnected components are reported separately. Fine reconstruction uses surface-local sampling, bitsets and streamed frontier topology verification: up to one billion grid points, sixteen million output faces and 500 million sampling candidates. Input admission permits up to 500 million coordinates and 256 MiB of logical private numeric transport payload: ordinary Float32 views cost four bytes per coordinate, numeric arrays eight, and immutable Float32 shared-buffer views are borrowed without transfer by the disposable reconstruction worker. Repeated views are counted separately. This payload limit is not a heap or process memory bound. Global alignment produces shared final streams directly when cross-origin isolation supports them; ordinary-buffer fallbacks remain supported. Reconstruction counts output first and allocates one exact contiguous output buffer. ShrinkWrap retains its separate three-million-face input limit. New diagnostics include `gridPoints`, `distanceTests`, `samplingCandidates` and `verification`. Increase resolution when an explicit resource limit is exceeded; requested resolution is never silently coarsened. Resolution is sampling spacing, not a maximum-deviation tolerance. The exported headlight scan was validated at 0.5 mm; see the linked report for sampled surface-distance comparisons. Use revision/request guards and poll `job_get`; errors and cancellation preserve inputs. See [workflow, limits and native evidence](WATERTIGHT_MESH.md). Existing `scanEdit/fillHoles` with omitted indices fills all valid closed boundaries without reconstructing the whole surface.

### ShrinkWrap

`mesh_process` supports `operation:{kind:"scanTools",operation:{kind:"shrinkwrap",sampleInterval:0.5,gapFill:0,organicShape:false,extraThickness:0,maxDeviation:0.1,scope:"whole"}}`. Scope is `whole`, `selected`, or `isolated`; selected excludes hidden facets and isolated uses visible facets after hiding a subset. Local wrapping preserves outside geometry and a fixed seam; it does not claim to close unrelated parent holes. Whole scope accepts top-level `targetIds` for additional aligned raw meshes, retained unchanged. Extra thickness is outward offset, not a prescribed wall thickness. Use normal revision/request guards, optional `createNew:true`, and poll `job_get`.

`scan_preview` exposes the same GUI preview lifecycle: `action:"create"` with entityId and ShrinkWrap operation returns a previewId through its job; `compare` uses that ID and an optional positive deviation; `accept` uses that ID and optional createNew; `cancel` releases it. Each mutation requires a fresh expectedRevision and unique requestId. Retained previews expire after 60 seconds or source/reference changes. Both GUI and MCP operate on the same retained preview. Comparison reports unsigned distances at all source triangle corners, including repeated vertices; these are not certified global bounds. Source-fit, topology, generated-region, scope and resource diagnostics remain available to agents. See [ShrinkWrap workflow and evidence](SHRINKWRAP.md).

Whole ShrinkWrap now runs an exhaustive triangle-pair self-intersection check before returning or retaining a preview. It reports selfIntersectionsChecked, selfIntersectionPairs, selfIntersectionCandidatePairs, selfIntersectionTestedPairs, selfIntersectionIndexFaces, selfIntersectionTriangles, selfIntersectionMethod and selfIntersectionScope; selfIntersectionExamples is a bounded JSON string of original output face-index pairs. The check uses exact Float32 orientation predicates after BVH broad-phase validation. It rejects intersections, incomplete index coverage, overflowing bounds, cancellation and the 500-million candidate-pair limit rather than reporting a partial zero. Local wrapping checks changed facets against the whole parent, reports changedRegionSelfIntersectionsChecked:true, and leaves selfIntersectionsChecked:false when unchanged-only pairs were excluded. No extra MCP action is required; GUI and MCP share this guarded kernel.

### Global Fine Align preview, Apply and Cancel

The Global fine align panel and MCP share `global_alignment_preview`,
`global_alignment_state`, `global_alignment_apply` and
`global_alignment_cancel`. This command refines an already approximately placed
scan set; it does not automatically find a coarse placement or establish complete
original-application or browser parity.

Preview requires 2–32 visible, unlocked raw triangle meshes. Omit `entityIds` to
use all visible raw meshes, or supply unique object IDs for an explicit subset.
Hidden objects and unsupported point clouds/CAD objects are excluded from the
implicit set; explicitly naming them fails. A visible raw mesh with a lock,
hidden triangles or incomplete facets blocks preparation and reports the reason.
Show all its triangles and unlock it first. Point clouds require an appropriate
point alignment workflow; exact CAD requires origin/reference alignment.

`searchTolerance` is in millimetres. Its omitted value is 0.5, an observed
persisted command setting rather than a recovered factory default. Shared input
normalization rounds a finite value to Float32, takes its absolute value and
widens it again; zero is allowed and values outside finite Float32 range fail.
`parallel` defaults to `true` and controls bounded CPU execution. Input
preparation has a collective 512 MiB estimated admission limit; subsequent
correspondence-query admission still applies independently. This is not a total
browser-memory guarantee. Preparation and query workers retain their bounded
lifetimes and cancellation cleanup.

Before deriving new input normals, the shared preview checks unresolved worker
cleanup and retries the retained exact handles with their existing bounded
recovery. If a stop remains unconfirmed, the preview job fails with
`OPERATION_FAILED` and an error beginning `Unresolved exact worker cleanup`;
no new input preparation or staged result is published. Poll the returned
`jobId` with `job_get` for that failure. `global_alignment_state` can already
report `idle`; this does not prove every worker stopped or memory was released.

After the failed job settles, a new `global_alignment_preview` attempt uses the
current `expectedRevision` and a **new** `requestId` to retry cleanup before
preparation. Persistent failures still block it; do not bypass the error or
start duplicate work. While its receipt is retained, repeating the identical
old request returns its original job receipt, even after failure; changed
arguments with that ID return
`REQUEST_CONFLICT`. State reads and `global_alignment_cancel` do not provide a
separate worker-recovery command. A successful cancel or an expired lease is not
proof of physical worker exit.

For each mutation, send the current `expectedRevision` and a fresh `requestId`.
Preview returns a job receipt; poll `job_get` until it settles. Read
`global_alignment_state` to inspect the shared preparing/preview/idle state,
`previewId`, participating IDs, normalized settings, input summary, diagnostics
and expiry. Per-scan outer diagnostics expose mean distance, coverage percentage,
stability and convergence; nonfinite metric values are returned as `null`.
Nonconvergence is a structured result, not proof of successful alignment. The
panel labels acceptance **Apply anyway** in that case; inspect the staged result
and diagnostics before accepting it.

Preview preserves authored geometry and history and retains the exact staged
result for 60 seconds after preparation completes. GUI and MCP see the same
cached preview. Apply with its `previewId` adopts that result without solving
again and records one `Global Fine Align` history entry. Expiry or changes to
authored inputs, project settings or history invalidate it; create a fresh
preview instead of applying stale output. Ordinary selection alone does not
invalidate it.

`global_alignment_cancel` remains available while preparation is busy, aborts
the owning preparation, releases the staged display and closes the panel without
committing geometry. The panel's Cancel/close and Escape use this operation too.
For automatic cleanup, pass the `jobId` returned by `global_alignment_preview`:
`global_alignment_cancel({jobId, expectedRevision, requestId})`. The scope stays
valid after the job finishes and its preview is cached. A mismatched or obsolete
job ID returns `cancelled: false` without aborting another job, releasing another
preview or closing its panel. Omit `jobId` only to explicitly cancel the current
shared global preview. Panel unmount, late launch responses and preparation
timeouts use the scoped form.
Cancellation, failure, invalidation and expiry request cleanup of the same
retained resources; failed stop requests keep recovery ownership. Cancellation
does not accept a partial scan set.

Automatic entire-hole filling also continues smooth non-quadratic scan surfaces.
The shared GUI/MCP operation first tries its existing quadratic collar fit. If
that fit is inadequate, a bounded thin-plate interpolant uses up to 192 spatially
spread samples from the retained connected collar and rim. The existing angular,
8192-face support, 2048-rim, cancellation and patch-validation limits remain in
force. Overhangs and steep lips keep the conservative boundary-height fallback.
Interpolation is accepted only when errors against all retained support samples
stay within 0.1 normalized radius individually and 0.02 radius RMS. Interior
heights are limited to the retained support envelope; original rim vertices and
source facets remain fixed. This approximates missing geometry from available
scan evidence; features wholly absent from the collar cannot be recovered.
Use `mesh_process` with `operation: {kind: "scanEdit", action: "fillHoles",
mode: "entire", algorithm: "automatic", indices: [boundaryIndex]}`. Existing
`surfaceFitHoles` includes accepted interpolated surfaces; the additional
`interpolatedSurfaceHoles` count identifies that subset. `surfaceFitMaxRms`
reports the accepted surface model's retained-support RMS in millimetres.

Interpolated automatic fills also detect a dominant direction of collar-slope
variation and continue supported rib sections along that direction. Directional
fits retain the same support-error gates and retry the isotropic fit if rejected.
A screened cotangent solve reconciles the fitted surface with fixed rim heights
and averaged retained tangents, preserving the fitted interior curvature. It is
bounded to 600 iterations, 60000 new vertices and 8192 retained one-ring facets.
Original scan vertices remain fixed; finite correction overshoots are limited to
the full retained-support height envelope. Cancellation still aborts the operation.
Blending is optional: if its numeric solve or limits fail, the operation restores
the refined fitted patch and runs the usual winding and topology validation.
A blending failure alone no longer prevents a geometrically valid hole from
closing. The shared GUI/MCP diagnostics include `surfaceBlendFallbackHoles` and
`surfaceBlendLimitedHoles`; no new agent parameter is needed. Support-fit RMS
describes the interpolant, not a guarantee of final visual continuity or accuracy
of geometry absent from the scan. Close-up inspection remains necessary.

### Hole-filling batch progress

`mesh_process` with `operation: {kind: "scanEdit", action: "fillHoles"}`
(excluding bridge mode) shares the GUI batch progress. Poll `job_get` for
`progressDetails: {kind: "holeFill", phase, processed, total, closed, skipped}`.
`total` counts unique selected closed boundaries (all closed boundaries when
`indices` is omitted). Diameter-filtered or rejected patches count as processed
and skipped, so `processed = closed + skipped`; a processed hole is not necessarily
closed. The stable closing label and linear fraction track processed/total.
Preparation reports no invented count. Updates are limited to five per second,
with immediate phase changes. `phase: "finalizing"` means the holes have been
processed but output geometry/topology is still being prepared. `complete`
means the geometry worker finished; inspect the job's terminal status before
using the result. Cancellation/errors retain their existing terminal states and
do not imply successful completion. Final `diagnostics.filledHoles` and
`diagnostics.skippedHoles` remain available unchanged. The pointer card shows the
same counts, and the GUI status bar retains the final outcome summary.

### Parallel mesh batch imports

`project_import_batch` prepares up to two STL/OBJ/PLY/ASC files concurrently using the same scheduler and parser as the GUI. Scene publication is serialized, appends to the current workspace, and retains one undo step per file. Results and failures retain input order; scene insertion follows readiness order. CAD imports remain serialized and project replacement stays separate. The batch fits the view once after scan publication.

Cross-origin isolation lets indexed PLY/STL imports share immutable expanded positions and PLY corner normals with project encoding workers, reducing copies during save/export/automatic backup. Packed binary PLY also shares final indexed vertices, normals and triangle indices; binary STL shares final indexed vertices and triangle indices. The general PLY loader keeps ordinary indexed buffers, and ordinary buffers remain the fallback without isolation. No agent parameter is required. Source geometry, history, cancellation and project formats retain the same contract.

Background mesh preparation may remain `scheduled` while imports or queued/active surface-picking preparation own priority. It resumes afterward; foreground mesh information and already queued topology operations retain ownership. GUI picking and MCP `viewport_pick` keep their existing hit and facet-ID contract.

Automatic backups wait during priority preparation and can postpone an in-progress automatic attempt when imports or picking begin. The previous backup remains available through `backup_list`; the latest eligible revision retries on a later 30-second interval. A postponed attempt is not marked saved. Explicit project save/export jobs keep their existing behavior and cancellation contract.

Admission uses device CPU/memory hints, reported JavaScript heap headroom where available, a 64 MiB per-file threshold, and a conservative 512 MiB decoded batch estimate. Inputs above these limits remain supported through one parser; browser hints cannot guarantee physical memory availability.

Poll `job_get`: `progressDetails.kind` is `importBatch`, with `files` containing `index`, `name`, `status` (`queued`, `importing`, `rendering`, `complete`, `failed`, `cancelled`), `fraction` (0-1), and `stage`. The cursor overlay shows the active filenames and bars plus completed/queued/failed counts. `job_cancel` stops queued and active scan work, waits for worker cleanup, and retains committed objects. Per-file errors do not stop other imports. Native CAD cancellation still waits for native work to settle.

Canvas navigation: hold the right mouse button and drag to pan; hold the middle button
and drag to rotate. Right-drag panning also works in mesh edit and does not open the
context menu on release; a stationary right click still opens it. Existing modifier
shortcuts remain available. Agents use `viewport_control` with `action: "camera"` to pan
by translating `position` and `target` by the same world-mm vector, or `action:
"rotate"` to orbit; inspect `viewport_get` before and after. These use the same viewport
camera and preserve geometry/history.

Camera navigation additions:

- Double-click the middle mouse button without dragging or modifiers to fit all
  visible objects. This uses the existing `viewport_control` `action: "fit"` operation
  and also works in mesh edit. A middle drag does not trigger Fit.
- ViewCube settings offers **Free orbit** and **Constrained orbit (Z up)**. Free orbit
  remains the session default. Constrained mouse/ViewCube orbit and semantic
  `action: "rotate"` preserve world-Z upright and cap pitch just short of the poles.
  Changing orbit mode removes roll without moving the camera or target. Explicit
  camera poses, named standard views, and SpaceMouse remain their own navigation
  paths. This session setting is not saved into geometry history.
- Choose **Zoom Window** from ViewCube settings, then left-drag a rectangle. The
  rectangle is fitted on the camera-facing plane through the current target;
  it does not select geometry or infer a new surface depth. Release applies the
  zoom and exits the tool. Escape, pointer cancellation, or loss of window focus
  cancels it without changing the camera. Tiny drags cancel without zooming.

Agents use `viewport_control` with `action: "navigation"` and either or both
`orbitMode: "free" | "constrained"` and `zoomWindowActive: true | false` to configure
orbit or arm/cancel the same window tool. Supply at least one setting. Mode changes
reject active selection/model/orbit gestures; finish those before changing modes.
`viewport_get.navigation` exposes `orbitMode` and `zoomWindowActive`.

For direct rectangle zoom, use `viewport_control` with `action: "zoomWindow"` and
`x0`, `y0`, `x1`, `y1`: finite normalized top-left viewport coordinates in `[0,1]`.
Reversed corners are accepted; both rectangle dimensions must span at least 4 CSS
pixels. Invalid rectangles fail without camera changes. Orthographic zoom is bounded
to `[0.001,1000]`; perspective window zoom reduces camera distance. Existing revision,
request retry, and busy/preview safeguards apply. Read `viewport_get` before/after;
geometry, selection and undo history remain unchanged.

### Undo and redo the active sketch edit

Use `history_undo` or `history_redo` with `scope:"sketch"`, a fresh `expectedRevision` and `requestId` to traverse the editor's current sketch edit session. This is the same shared action as the sketch Undo/Redo controls. It changes only the active saved sketch (or the legacy draft when none is active); other sketch sessions and CAD model history remain unchanged. Inspect `sketch_get` after the action. The reply is `{updated:boolean,scope:"sketch"}`; `updated:false` means that session has no edit in that direction. Existing single-step sketch undo/redo retention is unchanged. Retry an identical request with the same requestId without applying the edit twice.

Omit `scope` (or use `scope:"model"`) to retain existing model-history behavior, including undoing a completed extrusion. `history_get` continues to describe model history. Sketch edits and model creation are distinct histories; sketch-scope undo does not remove an extruded body. Busy and Interactive alignment editing guards apply. Sketch history does not modify source CAD objects. This adds no new sketch locking policy or new tool.

### Scan section references for a sketch

Use `mesh_process` with `operation:{kind:"sketchSection",options:{plane:"OXY",offset:1,onSlicingPlane:true,selectedOnly:true}}` and the usual object/revision/request fields. All four options are required: `plane` is OXY/OYZ/OXZ, `offset` is finite world millimetres, and the two switches are booleans. `selectedOnly:true` uses the current nonempty triangle selection on the specified source object. Omit the top-level `selectionOnly` flag or supply the same value; contradictory flags are rejected before processing. The operation retains original triangle slots and excludes hidden triangles, matching GUI Create Sketch section extraction. `onSlicingPlane:false` projects references onto the zero-offset reference plane.

Poll the existing job receipt and read the JSON artifact: `sketchSection` contains the frame, local reference segments, actual/placed world segments and eligible-triangle count. Extraction changes no geometry, selection, sketch ownership or model history. A missing/stale/empty selection, a selected region with no eligible visible triangles, or a nonintersecting plane fails without an accepted result. To retain references, use the existing `sketch_manage` create action with a validated empty Sketch v1 containing the returned `frame` and `reference`; reference samples are separate from editable curves. This does not assert original native section-algorithm parity.

NURBS display tessellation used by GUI patch editing and `surface_set` preserves
interior knot multiplicity degree + 1 as separate one-sided span strips in U and
V, without triangles across a discontinuity. Continuous and C0 patch sampling
retains its existing order. `surface_shell` and GUI shell validation enforce
`options.triangleBudget` against the actual sampled strip cells, including
off-grid breaks; an on-grid break does not add an extra cell. A budget failure
publishes no assembled result. Inspect returned shell diagnostics; display
tessellation does not certify a closed or valid exact CAD solid.

### Analytic sketch extrusion

Use `cad_create` with `recipe:{kind:"extrude",profile:{kind:"sketch-curves",sketch:<Sketch v1>},height:10}` and the usual revision/request fields. The sketch must solve into one closed unbranched line/arc cycle; construction geometry is excluded. Height is positive millimetres, at most one billion. The optional sketch frame places the profile and defines its extrusion normal. Circular arcs remain exact CAD curves; no `chordTolerance` is accepted for this profile kind. Invalid topology, inconsistent radii, unsolved constraints and intersecting profiles fail before a body is committed. Inspect the job receipt and `project_get`; use `cad_rebuild` with the same recipe kind to edit the feature. Both the GUI's solved-profile extrusion and MCP call the shared `cad_create` operation, with existing cancellation, revision, retry and model-history behavior.

Existing `profile:{kind:"sketch",sketch:...,chordTolerance:...}` recipes retain their sampled polygon geometry on rebuild. Use `sketch-curves` explicitly to migrate a legacy feature to analytic curves. The sketch panel's arc preview tolerance affects drawing only. CAD meshes remain tessellated for display. Exact-cylinder volume and STEP round-trip checks establish kernel correctness; native workflow equivalence remains unverified.

### Symmetry and atomic sketch solving

Sketch v1 supports `{id,kind:"symmetric",first,second,axis,reverse}`. `first` and `second` identify two distinct lines or two circular arcs. `axis` identifies a separate nondegenerate segment marked `construction:true`; it is editable reference geometry, not a fixed world axis. `reverse` is required: false pairs first.a/first.b with second.a/second.b; true swaps the second endpoints. Arc centers are reflected too. Reflection reverses arc traversal, so arc clockwise flags must differ with reverse:false and match with reverse:true. Invalid axes, missing references, mixed curve kinds and incompatible arc orientation are rejected. Removing an axis or either curve removes dependent symmetry constraints.

Read the active draft with `sketch_get`, add the relation to its `constraints`, then use `sketch_set` with `solve:true` and fresh revision/request fields. The shared operation solves and applies the draft once, returning `{updated:true,solution}` with the solved sketch, residual, convergence, conflict IDs, iteration count and local DOF. A conflict or unsolved result leaves the prior draft/revision unchanged. The GUI Add constraint action uses this same operation. Sketch Undo/Redo traverses the resulting edit without changing model history. Omit solve or use false to retain existing unsolved draft replacement. `sketch_solve` remains read-only; its returned solution can be inspected before applying. Saved sketches and project exports retain symmetry IDs and endpoint correspondence. Mathematical reflection tests and GUI/MCP workflow checks do not establish native solver numerical equivalence.

`cad_create` also accepts `selectCreated:true` to select the first result before the job succeeds. The GUI extrusion uses it so a delayed selection change cannot invalidate a following agent operation. Omitted or false retains existing agent selection behavior; model creation still records one history entry.

### Construction curves in the sketch viewport

Set `construction:true` on a sketch segment or circular arc to use it as reference geometry. The main 3D sketch editor draws these curves dashed; ordinary curves remain solid. `sketch_get` returns the same flags and `sketch_set` updates them through the existing draft/history operation. Display grouping does not change curve coordinates, sketch frames, units, snapping or endpoint picking. Construction curves remain excluded from closed CAD extrusion profiles. Symmetry-related endpoint markers include its axis endpoints and reflected arc centers; blue means a point participates in a relation, not that it has zero degrees of freedom. Read `sketch_solve` for actual local DOF and conflicts.

### Two-line Corner Trim

Read the active draft with `sketch_get`, then call `sketch_corner_trim` with `first` and `second` segment IDs, explicit `firstEnd` and `secondEnd` (`a` or `b`), and the usual revision/request fields. Each selected end moves to the infinite straight-line intersection in sketch UV millimetres. The first selected point ID is retained and shared by both lines; the second selected point is removed. Opposite ends, segment IDs, construction flags, placement and scan references remain unchanged. The result contains `changed`, `intersection:[u,v]` and `pointId`; read `sketch_get` to inspect geometry. Already joined ends return `changed:false` without adding history.

Parallel/coincident or degenerate lines, collapsed retained segments, unbounded intersections, affected constraints and endpoints used by other geometry fail atomically. Remove the affected relation or detach geometry explicitly before retrying; relations are never discarded automatically. GUI **Corner Trim → Join corner** uses this same operation and endpoint choices. Sketch Undo/Redo handles the edit independently of model history; saved sketches retain the shared endpoint. This operation supports two straight lines. Paint trimming and fixed-radius line fillets use the separate shared operations described below. Line/arc corner intersections and automatic fillets remain open; see [corner evidence](NATIVE_SKETCH_CORNERS.md).

### Bounded geometry digests

For full-size geometry comparisons, call read-only `object_geometry_digest` with `entityId`, then poll its receipt through `job_get`. The job hashes the stored display, indexed scan and point-cloud numeric carriers with at most 1 MiB of canonical staging per chunk, yielding between chunks. It returns `entityId`, coordinate `units:"mm"`, `buffers` and optional `pointCloudMatrixBits`. Each buffer reports `path`, `encoding`, `elements`, `rawBytes`, `sha256`, `storage`, `backingId`, `shared` and, for typed views, `byteOffset` and `backingBytes`. Normals and indices are dimensionless. Missing optional carriers are omitted; empty carriers have the SHA-256 of empty bytes.

Encoding follows project storage: little-endian `f32` for Float32 arrays, `f64` for ordinary coordinate/normal arrays and `u32` for triangle indices, including restored ordinary index arrays. Signed zero is preserved. Invalid/nonfinite values or indices outside u32 fail the job. Compare path, encoding, element count and hash across snapshots; hashes with different encodings are not directly comparable. Backing IDs describe aliases within this one response and are not persistent object identities. `rawBytes` is canonical payload size, and `backingBytes` is an underlying typed-buffer size; neither measures total application RAM. Exact BREP, NURBS controls, recipes and metadata are outside this carrier digest.

Use `job_cancel` to stop hashing. Cancellation or a project revision change discards the digest instead of publishing a mixed snapshot. The read-only job preserves geometry and history while using the existing API admission lane. This is suitable for checking GUI/MCP edits, Preview/Cancel and Undo without creating a large `object_get(includeGeometry:true)` JSON export. It verifies buffer identity/content, not registration quality or native numerical parity.

### Global alignment transform receipts

The `global_alignment_preview` job result, `global_alignment_state` and `global_alignment_apply` response expose the same staged `outer` transform receipt. `matrixFormat:"row-major-3x4"`, `matrixEncoding:"float64-le-hex"` and `translationUnits:"mm"` describe each `states[].matrix` and `applications[].matrix`. Each twelve-value matrix also has `matrixBits`: 192 lowercase hexadecimal characters encoding twelve little-endian Float64 values, preserving signed zero. Use the bits when JSON number encoding would lose that distinction. Arrays are detached copies of the cached controller matrices and order.

`states` contains controller poses before the gauge inverse. `applications` retains the exact controller-issued sequence: per-object poses followed by the common gauge inverse. The geometry executor groups these stages by object and applies both stages to each object, retaining intermediate Float32 rounding. The receipt sequence therefore does not describe cross-object execution order, and a composed matrix need not reproduce stored coordinates bit for bit. Apply adopts the cached staged geometry once; it does not run registration again. Inspect convergence and diagnostics separately: transform exposure alone does not establish registration quality or native numerical equivalence.

### Paint trimming sketch intervals

Read `sketch_get`, then call `sketch_trim_stroke` with `stroke:[[u,v],...]`, positive `radiusMm` and the usual revision/request fields. Coordinates and radius are sketch-local millimetres; stroke coordinates are unsnapped. One point paints a disk; consecutive points paint the union of capsules. The operation removes entire line/arc/circle intervals bounded by actual analytic intersections or open endpoints, using the original draft for the whole stroke. A two-arc circle is periodic when its geometry and construction policy agree; its storage seam is not a trim boundary. Unrelated records, placement, scan references and constraints are preserved.

The response has `changed`, `removedCurveIds` (original IDs deleted completely), `retainedCurveIds` (retained pieces of affected curves; the first piece can reuse its original ID) and `intersectionCount` (distinct geometric intersections across the input, not just painted hits). Use `sketch_get` for exact retained curves and shared point IDs. A no-hit returns `changed:false` without adding history or changing revision. Changed results call the same draft operation once, giving one sketch Undo/Redo edit independently of model history. Reuse the same request ID only for an identical retry.

A retained piece of an ordinary nonperiodic arc becomes a straight segment when the absolute normalized chord-direction dot product about its evaluated midpoint is strictly greater than `0.9999996192282494`; equality retains an arc. Both small sweeps and nearly full sweeps can qualify. Periodic circles keep their existing curved replacement policy. Conversion preserves the curve ID and construction flag; read both `segments` and `arcs` in `sketch_get` rather than assuming that an ID stays in the same collection. An unused center point is removed unless other geometry or a point constraint still references it. Affected constraints remain an atomic rejection. This classification uses application analytic curve evaluation; complete native numerical trim equivalence is not established.

Affected curve/endpoint constraints, ambiguous coincident overlaps, invalid geometry and resource limits fail atomically. The error identifies affected constraint IDs; remove relations explicitly before retrying. This conservative policy is an application contract, not verified native constraint transfer. Limits are 4096 stroke samples, 32768 input/output points, 4096 constraints, 512 stored input curves, 65536 distinct intersections, 8192 output curves and 2000000 counted work units including conservative validation cost. Inputs below individual count limits can still exceed the work budget. The helper yields and checks ownership/cancellation; no partial result is published.

In the GUI choose **Paint trim**, set **Trim radius (mm)** and paint in the model view. Preview changes display only; release submits this shared operation once. Escape, right-click, capture loss, draft/tool changes and pointer cancellation discard the gesture. The pointer-down project revision is retained, so an intervening authored edit cannot cause a stale preview to overwrite the draft. Native numerical equivalence and undocumented brush/constraint policies remain separate acceptance gates.

### Exact camera projection observations

`viewport_get` also returns copied `projectionMatrix` and `cameraWorldMatrix`, each sixteen numbers in `cameraMatrixFormat:"column-major-4x4"`. They include the actual perspective/orthographic projection, zoom, aspect and view offset; no assumed field of view is required. For a world-mm point, transform by the inverse camera-world matrix and then projection matrix, divide by homogeneous W, and map NDC `(x,y)` to normalized top-left `((x+1)/2,(1-y)/2)`. Use the current viewport dimensions/canvas bounds for CSS coordinates, and refresh after camera/layout changes. These are observational results, not editable project geometry or a replacement for surface picking.

### Fixed-radius line-corner fillets

Call `sketch_corner_fillet` with the active draft's `first` and `second` straight-line IDs, `firstEnd`/`secondEnd` (`a` or `b`), positive `radiusMm` no greater than 1e9, and the usual revision/request fields. GUI **Corner Trim → Fillet radius (mm) → Create fillet** uses this same guarded operation. The opposite endpoints define the retained rays from the infinite-line intersection. The helper places two tangent points and one analytic circular arc inside that corner. A shared selected corner point is split into two tangent point IDs; distinct selected IDs are retained. Line IDs, opposite ends, unrelated records, frame and scan reference are preserved. Matching construction policies propagate to the arc.

The response contains `changed:true`, `intersection`, ordered `tangentPoints`, `center`, `radiusMm` and `arcId`; coordinates are sketch-local millimetres. Read `sketch_get` for exact arc direction and topology. One publication produces one sketch Undo/Redo edit, independently of model history. Identical request retries reuse their receipt. The operation does not join the corner through an intermediate authored edit.

Invalid radii, parallel/degenerate or numerically unresolved geometry, radii that reach an opposite endpoint, mixed construction policies, affected constraints and selected endpoints shared with unrelated primitives fail atomically. Constraint errors list relation IDs; remove or detach explicitly. No constraint transfer, automatic radius detection or automatic dimension is inferred. Limits: 32768 input/output points, 8192 input/output curves, 4096 constraints and 2000000 counted work units, including admitted generic validation cost. Cancellation/revision checks run before publication; individual count limits do not guarantee admission under the work budget.

To verify an extruded fillet, read `alignment_references` for the CAD body. Exact CAD cylinder faces include `radiusMm`, read from the kernel surface, alongside their axis, V-span length and triangle range. This optional field applies to cylinder faces; cone and torus radius conventions are not inferred. Reference inspection remains read-only and preserves existing axis/plane outputs. Mesh analysis volume is a tessellation result and is not exact kernel mass.

### Shared reconstruction job lifecycle

GUI **Re-polygonize → Apply** submits the existing `mesh_process` reconstruction operation and observes its public job. GUI and MCP use the same source/reference validation, revision checks, disposable processing worker, commit and history path. The GUI does not retain a second canonical reconstruction output in a geometry-session worker or commit the returned geometry again. Public parameters and reconstruction limits remain unchanged. Poll `job_get` for the topology and diagnostics; `job_cancel` requests cancellation. A cancellation request can race with completion, so inspect the terminal job and project state before assuming geometry was preserved. A reported successful terminal result remains authoritative if cancellation arrives afterward.

### ASC color and normal interpretation

Fresh GUI/MCP ASC imports use `xyz-rgb`: XYZ plus integer RGB, with white for
XYZ-only/fallback records. Select `xyz-normal` explicitly to retain six-column
scanner normals. Read/write the shared preference through
`project_get.settings.importAscAttributes` and
`settings_set.patch.importAscAttributes`; `project_import` and
`project_import_batch` accept a per-request `ascAttributes` override.
No existing object is reinterpreted by preference changes.

Object summaries omit bulk color data and expose `pointColorAttributes`
(encoding `rgba8`, point count and bytes). `object_get(includeGeometry: true)`
includes `pointColors`; `object_geometry_digest` hashes its canonical `u8`
bytes. Cloud transforms and edits retain corresponding colors. Colored or
interpretation-bearing saves require JSON wirev2/binaryv4; older readers reject
these versions. Current readers retain older projects. Read [ASC attributes](ASC_ATTRIBUTES.md)
for parsing bounds, history and export limits. Native displayed-color and full
GUI importer equivalence remain unverified.

### Mirror sketch geometry

Read `sketch_get`, then call `sketch_mirror` with a straight construction segment
ID as `axis`, a nonempty unique `curveIds` array, and the usual
`expectedRevision`/`requestId`. The infinite supporting line is the mirror axis;
coordinates are local sketch UV millimetres. Exclude the axis from `curveIds`.
To copy a circle stored as two semicircles, select both arc IDs. The GUI's
**Mirror geometry → Mirror axis → curve checkboxes → Mirror selected** uses the
same operation.

This creates independent copies. Originals and existing constraints remain;
no symmetry or copied constraints are added. Shared selected endpoints and arc
centres are copied once, construction flags survive, and arc direction reverses.
Frame and scan-reference metadata remain unchanged. The result contains
`changed:true`, `pointMap`, `curveMap`, `createdPointIds`, and `createdCurveIds`.
Maps associate original IDs with copy IDs; new IDs are deterministic in stored
point/curve order, independent of selection order. Read `sketch_get` to inspect
the copied analytic geometry. One `history_undo`/`history_redo` with
`scope:"sketch"` steps the edit; model history remains separate.

Mirror keeps copied endpoint IDs independent. Both analytic `sketch-curves` and
legacy `sketch` extrusion recipes passed to `cad_create` join profile endpoints
with exactly equal local UV coordinates, even when their point IDs differ.
This affects derived wire assembly only: `sketch_get`, constraints and saved
recipe graphs preserve the authored IDs. Real gaps, zero-length edges, branches
and disconnected cycles remain errors. No near-point snapping is performed;
repair gaps explicitly through `sketch_set` or GUI endpoint editing. See
[profile junction behavior](SKETCH_PROFILE_JUNCTIONS.md).

Limits are 32768 input/output points, 8192 input/output stored curves, 4096
constraints, 4096 selected curves and 2000000 work units. Coordinates must remain
within ±1e9 mm; axis length must be at least 1e-10 mm. Invalid references,
nonconstruction/degenerate axes, exceeded limits, cancellation and changed
revisions fail before publication. The helper yields during bounded work and
uses the existing executor's cancellation, busy and retry guards. These bounds
and ID rules are implementation policies; exact native thresholds and ID order
remain unverified. See [mirror evidence](NATIVE_SKETCH_MIRROR.md).

### Collinear sketch segments

Add `{id,kind:"collinear",first,second}` to the Sketch v1 constraints and call
`sketch_set` with `solve:true`, `expectedRevision` and `requestId`. Both references
must be distinct straight segments with finite lengths at least 1e-10 mm.
Construction, disjoint, overlapping and reversed lines are supported; endpoints
are not welded and lengths are not equated. The two residuals measure the second
segment's endpoints against the first supporting line in local UV millimetres.
The existing solver tolerance is 1e-6; extrapolating from the other reference can
amplify its error. Read the returned solution diagnostics and `sketch_get`.
Conflicts and invalid references leave the draft and revision unchanged; sketch
history, retry protection and saved-sketch/project persistence remain shared with
the GUI Constraint menu. See [collinear behavior](SKETCH_COLLINEAR.md) for limits
and the distinction between native command evidence and numerical verification.

### Full-size N-point preview resource limits

Historical original-three-STL checkpoints rejected both moving scans' default
`visibleScene` previews at the old 100,000-node limit. Alignment now admits trees
against a 512 MiB estimate for object nodes, live memberships and packed query
transport; geometry buffers and other application allocations are separate.
The estimate reserves 512 bytes per node and 24 per live membership, including
parent/child overlap during subdivision. Native subdivision and query order are
unchanged. Other noise consumers retain their existing node-count limits.
There is no public budget override. Exhaustion reports `OPERATION_FAILED` with
`Alignment target tree exceeds its memory budget` and estimated required/allowed
bytes. The 4 GiB validation-process cap is separate from this tree estimate.
Float32 indexed normals retain Float32 render storage through acceptance;
legacy numeric arrays retain their original precision. `object_geometry_digest`
reports `f32` for compact normal buffers; project/wire formats are unchanged.
See the [historical failure evidence](ORIGINAL_STL_WORKFLOW.md).

Poll the terminal `job_get.status`: the historical failures reported `progress: 1`, which
is not success. They leave the session active with all twelve picks retained,
`preview:false`, `canPreview:true` and historically `canReset:false`.
Current live sessions additionally expose `previewStatus:error` and
`previewError`, and enable Reset after an error. Both historical failed previews
preserved all nine committed geometry carriers and the three-import history.
Identical request retries return the same job receipt; its job stays failed and
no second solve runs. For an intentional new attempt, supply a new request ID
and the current revision. This does not remove the resource guard.

Close the failed session through `preview_discard` with `target:landmarks` or
GUI Cancel. Both post-failure close routes preserved geometry/history in the
full-size replay. This checks closing an already failed job, not in-flight
cancellation, successful alignment, acceptance or native final-controller parity.

### In-flight N-point cancellation

A full original-STL replay cancels MCP-issued previews after paired-worker
progress while `job_get.status` is still `running`. Worker and public progress
can already be `1`; wait for the terminal status. GUI Cancel closes the draft
and produces `status:cancelled` with error code `CANCELLED`. MCP `job_cancel`
produces the same terminal state but retains the active draft and twelve picks;
close that draft with `preview_discard` targeting `landmarks` when finished.

Both worker targets closed within the five-second probe budget. Identical
request retries returned the original cancelled job receipts without another
solve. All nine original geometry carriers and the three-import history were
preserved. See [the complete cancellation evidence](ORIGINAL_STL_WORKFLOW.md).
This covers MCP-issued raw-mesh jobs, not GUI-submitted previews, later native
CAD/controller stages, successful alignment or acceptance. That historical
checkpoint still had the resource failures described above.

### Indexed alignment storage and project encoding

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

The complete original-three-STL GUI/MCP coarse/refinement, cached acceptance,
retry, Undo/Redo and GUI save workflow passed under the unchanged 4 GiB Job,
peaking at 3,457.16 MiB. Independent decoding matched all 13 current geometry
carriers and full history. See [the validated workflow](ORIGINAL_STL_WORKFLOW.md#bounded-indexed-alignment-memory-correction).
Native final numerical equivalence remains unverified.

### Compact binary project restoration

GUI opening and MCP `project_import` / `backup_restore` now preserve binary `u32`
mesh topology as `Uint32Array` instead of widening it into ordinary numeric
arrays. Hidden/saved facet selections retain their existing array semantics even
when their encoded chunks match topology. Legacy JSON and `f64` storage remain
compatible; face order, values, signed zero and current/history aliases survive.

The decoder worker publishes final Float32 geometry and Uint32 topology through
the existing immutable shared-buffer policy when cross-origin isolation permits
it. Saving or backing up those restored revisions then shares their backing with
the encoder. Other hosts retain private typed buffers and transfer only decoded
worker-owned storage; retained model/history buffers never detach. Public schemas,
revision/retry/cancellation rules, worker leases and file formats are unchanged.
`object_geometry_digest` reports the actual shared or private backing and the same
canonical hashes. See [restoration validation](PROJECT_LOAD_PERFORMANCE.md#binary-topology-and-history-publication).

## Converted line kernel compatibility

The internal converted-line backend preserves prepared direction bits through
a checked adapter for the bundled kernel. When replacing kernel bindings, run
`tests/kernel-line-direction-fidelity-smoke.mjs` under owned resource admission
and a finite lease, alongside the existing CAD checks. Unsupported binding or
layout errors require a compatible adapter/kernel pair; do not bypass the
checks or infer a successful native body from a candidate. See
[CAD direction fidelity](CAD_DIRECTION_FIDELITY.md). Public sketch tools and
schemas are unchanged by this internal correction.

Also run `tests/kernel-line-open-topology-smoke.mjs` for converted-line kernel
compatibility: it checks distinct endpoint identities, orientation, short spans
and retirement. Its passing open-edge fixtures do not authorize closed-profile
or complete native admission claims.

`tests/kernel-line-child-smoke.mjs` also checks line-child source projection into
the ordered collection, staged replacement and collection-owned retirement.
`tests/sketch-line-collection.test.ts` covers retained and empty sources,
owner/child placements, source codec and shared pick resolution. These are
internal integration checks; the unfinished ordered editor and complete native
admission are not advertised as available public sketch operations.

Also run `tests/kernel-line-draft-fork-smoke.mjs` when changing the line draft or
kernel bindings. It checks independently owned copies of partial draft state,
rejected-wire preservation, cancellation, source changes, cleanup failures and
100 retirement cycles. This application staging copy is not native cloning or a
completed public editor capability.

### N-point view divider

Drag the vertical divider between the result and picking views to resize the
picking-view column. Focus the divider and use Left/Right (two percentage points)
or Home/End (20/50 percent). The default is 32 percent; requested widths are
clamped to 20-50 percent. Responsive layout keeps at least 220 px for the picking
column and 360 px for the result where available, so the rendered percentage can
differ from the requested value in a narrow window. Layout is scoped to the
alignment session and survives point edits, preview/reset and reference changes.

Agents use `landmark_edit { action: "view-layout", referenceWidthPercent: 40,
expectedRevision, requestId }`; missing/nonfinite values fail, and finite values
outside the limits clamp. Read `landmark_get.layout` for the configured width,
limits and pixel minima, and `viewport_get` for actual rendered dimensions.
Resizing changes no geometry, picks, camera poses or history and does not cancel
or restart pending automatic previews. The existing busy/revision/retry guards
remain in force. The main result region stays accessible by its name and MCP
view role; its redundant top-left caption was removed to avoid peeking behind
the floating alignment panel.

### Direct N-point picking and deselection

The top-right canvas always adds **fixed** points and the bottom-right canvas
always adds **moving** points. There are no pick-mode buttons or point coordinate
lists in the floating panel. Each canvas has **Undo point**, **Clear**, and **Fit**.
Click a numbered marker button to deselect that point; this does not add a new
point through the canvas. Fixed and moving markers remain independently editable.

MCP uses the same shared edits: `landmark_edit` action `remove-point` requires
`entityId` and zero-based `pointIndex` within that entity's filtered `landmark_get.picks`
sequence. Invalid/missing indices and unrelated objects fail. `remove-last` and
`clear` accept optional `entityId` to remove only that canvas's points; omitting
it preserves the existing whole-session behavior. Removal invalidates the result,
cancels superseded work and automatically recomputes when at least three equally
sized point groups remain. Other-side picks and committed geometry/history are
preserved. Markers renumber after removal: refresh `landmark_get` before selecting
another index. `landmark_get.views.fixed.position` is `top-right`, and
`views.moving.position` is `bottom-right`; original-pose markers, point coordinates
and diagnostics remain available through MCP after removing their panel lists.

Point-cloud rotation uses a bounded 6 CSS-pixel neighborhood when the exact
pointer pixel falls between rendered scan dots. The nearest displayed depth
sample supplies depth on the original pointer ray, so clicking inside a dense
cloud keeps the pivot under the cursor. Exact pixel hits take priority; objects
outside that neighborhood do not count as pointer hits. Only a local miss uses
the screen-center/model-depth fallback. Mouse and viewport_control rotate(x,y)
share this behavior, including adaptive sampling and clipping; viewport_get
orbitCenter exposes the actual active pivot. Mesh-only picking remains exact.

### Application context menus

Chrome's native context menu is disabled throughout the application document,
including the ribbon, blank areas, fields and portal dialogs. Releasing a
right-button pan outside its canvas cannot invoke browser UI. App context-menu
handlers retain their normal events and actions. Agents continue to use the
existing semantic tools for those actions; `application_inspect.contextMenuPolicy`
reports `application-only`. No native browser-menu capability is exposed.

## Inspection measurements and signed primitive reports

`analysis_measure` uses the same calculation as the GUI measurement selector.
Omit `kind` for existing two-point distance calls; pass `kind:"distance"` with
`first`/`second`, or `angle`, `radius`, `diameter` with `third`. Points are world
XYZ millimetres. Angles are included angles in degrees with `second` as the vertex.
Circle measurements use three noncollinear points in any plane; responses retain
center, radius and diameter. All responses retain `kind`, `value`, `units` and
ordered `points`; distance/angle also retain their named scalar. Invalid picks
fail without geometry/history changes. GUI exports the same JSON value.

`analysis_deviation` accepts an analytic `fit` and optional positive finite
`tolerance` in mm (default 0.1). GUI and MCP use one report builder. Results expose
`samples`, `excluded`, `coverage`, signed minimum/maximum/mean, RMS, maximum absolute
error and `withinTolerance`. `artifact` retains the distance array for existing
callers; `report` is a reproducible JSON report including the fit, tolerance,
statistics, sample order, units and limits. Hidden samples are `null` in the full
original source order: point indices for clouds, triangle corners for surfaces.
Coverage is the fraction of visible source samples, not spatial/area coverage.
Distances describe oriented infinite analytic surfaces, including open planes;
positive means along the plane normal or outside radial surfaces. They do not
certify watertight inside/outside, finite cap distances, general scan-to-CAD
surface distances or continuous surface-error bounds. GUI exports the same report.

`analysis_section` and GUI sections exclude hidden triangles and use world-mm
axis/offset settings. Results include `units`, `axis`, `offset`,
`scope:"visible-triangles"`, length, segment count and CSV/DXF artifacts. Point
clouds are rejected because point order does not define a triangle surface.
Inspection admission retains the existing 2,250,000 coordinate limit: 750,000
point/corner samples, or 250,000 triangles. Reduce a copy when the limit is
exceeded. Analysis is read-only, adds no model-history entry, and exported report
files retain parameters independently of ephemeral GUI previews. These operations
alone do not imply that M6 native and milestone acceptance has passed.

### Reference-surface deviation and shared heatmaps

Instead of `fit`, pass `referenceId` and a required positive `maxDistance` in mm
to `analysis_deviation`. The reference must be a distinct triangle surface. Both
objects are limited to 2,250,000 coordinates. Hidden source samples and hidden
reference triangles are excluded. `signed` defaults to false; true uses the
nearest reference triangle winding. Search is exclusive: distances equal to
`maxDistance` are unmatched. Reports retain `referenceId`, `maxDistance`,
`signed`, `referenceGeometry`, `eligible`, `unmatched` and `referenceTriangles`
(the original reference triangle slot per source sample, null when unmatched).
Per-sample mappings remain in the report artifact instead of inline responses.
Zero matches return null error statistics and zero coverage, not a zero error.
CAD references use their Float32 display tessellation, not exact BREP distances.
Sparse samples, open boundaries and local winding signs limit interpretation.

Select the report source with `object_select`, then use `inspection_display`
`action:"show"` with the returned `inspectionId`, current `expectedRevision` and
unique `requestId`. GUI Compare uses these same operations. `action:"clear"`
releases the display. Gray means unmatched; blue/green/red encode negative/zero/
positive distances relative to tolerance. Display requires the original entity
identities; edits, hidden-face changes or replacement make old reports unusable.
The most recent report is retained for 15 minutes, replaced by another analysis,
and released on API disposal. No geometry is adopted or modeling history added.
Primitive deviation jobs yield between bounded chunks; reference comparison
yields around index construction and every 4096 source samples. `job_cancel`
waits for cooperative settlement and publishes no partial result.

### Saved inspection definitions

`inspection_manage` with `action:"save"`, `name` and `definition` saves up to 32
small project definitions. A deviation definition is
`{kind:"deviation",entityId,fit,tolerance}` or
`{kind:"deviation",entityId,referenceId,maxDistance,tolerance,signed}`. A measurement
definition is `{kind:"measurement",measurement:{kind,first,second,third}}`; omit
`third` for distance. The same GUI Save actions use this operation. `inspection_get`
reads definitions and `inspection_run` with `inspectionId` returns a cancellable
job with the normal measurement or deviation result. The source must still exist.
Run explicitly to recompute against current geometry; old heatmap buffers/native
handles are not persisted. Project JSON, binary project files and backups retain
`authoring.inspections`. Exported report JSON retains the independent numeric
result snapshot. Save/delete use revision/retry guards and preserve other authoring
metadata; they mark the project dirty without adding modeling history. Delete a
definition using `inspection_manage` `action:"delete"` and its `inspectionId`.

`inspection_display` also accepts `action: "measurement"` with an `analysis_measure`-shaped `measurement`, or `action: "section"` with selected `entityId`, `axis` and millimetre `offset`. These guarded actions display the shared validated measurement markers or visible triangle section in the GUI and return its numerical result without modeling history. `clear` removes all inspection overlays; API disposal releases them. Point clouds cannot supply triangle sections.

Inspection heatmaps use the same blue/cyan/green/yellow/red palette and right-hand vertical scale as mesh reduction. The retained report tolerance sets the saturated blue/red endpoints; hidden or unmatched samples remain gray. The inspection scale is read-only; change tolerance through the analysis parameters and recompute. `inspection_display` and MCP captures render this same scale.
