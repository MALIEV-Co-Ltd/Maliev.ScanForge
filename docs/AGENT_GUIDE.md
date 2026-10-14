# ScanForge MCP agent guide

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

A hosted HTTPS page may be subject to browser local-network permission or connection restrictions. Grant the browser's local-network permission where supported; if blocked, serve the application locally on an allowed origin. Remote/hosted MCP transport and OAuth are not provided by this local integration.

## Agent operating procedure

### Browser project backups

`backup_list` reports the browser-origin backups, project identities, save times, file sizes, and the 30-second changed-project-only interval. Set `includeThumbnails:true` to receive WebP thumbnail artifacts; retrieve them using the artifact tools. Old backups can lack thumbnails. `project_get` includes the current `projectId`, and project exports retain it when reopened.

Use `backup_restore` with `backupId`, `replace:true`, `expectedRevision`, and a fresh `requestId`. It returns a job: poll until completion, then verify the current project and full undo/redo history. Restoration continues the same backup entry, including when selecting an old `:previous` snapshot. GUI Restore invokes this same operation. GUI file opening and MCP project import also retain a file's identity.

Use `backup_delete` with the selected `backupId`, `expectedRevision`, and a fresh `requestId` only when the user authorizes deletion. It removes that project's latest and legacy previous snapshots. The open model is unchanged; deleting its backup pauses automatic backups for the rest of this page session, preventing an interval write from recreating it. Its structured result reports `deletedProjectId` and `automaticBackupsPaused`. GUI Delete uses this same operation after confirmation. Storage errors surface as failed operations.

Backups are local to the paired browser origin and save changed data at 30-second intervals. Refresh or shutdown may lose work since the last completed interval. Stable project identities are shared across file copies; two tabs working on the same identity share its backup, with the last completed write taking precedence. New documents have separate identities. See [project files and recovery](PROJECT_FILES.md).

1. Read `scanforge://agent-guide`, then discover tool schemas.
2. Call `project_get`. Retain object IDs, feature IDs, units and the response's top-level `revision`.
3. For a mutation, supply that `expectedRevision` and a new `requestId` alongside command parameters.
4. If the tool returns a `jobId`, poll `job_get` approximately once per second until its status is `succeeded`, `failed` or `cancelled`. An accepted job is not a successful model edit.
5. Inspect returned diagnostics and affected objects. Use `project_get` again before the next mutation, particularly after a job, UI action, selection change or import.
6. Export requested outputs and retrieve their artifacts. Disconnect or delete unneeded artifacts when finished.

Never infer that an operation succeeded from a status message or transport success. Check `ok`, the job's terminal status and its result. Read the model state after modeling changes.

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

`viewport_get` reports projection, camera position/target/up/zoom, scene bounds and viewport dimensions. Use `viewport_control` with a fresh revision and request ID:

```json
{
  "expectedRevision": 7,
  "requestId": "frame-fixture-001",
  "action": "fit",
  "entityId": "actual-object-id"
}
```

Other actions are `rotate` (`direction`, `degrees`), `projection` (`orthographic`/`perspective`), `camera` (`position`, `target`, optional `up`, `zoom`, `projection`) and `sketchNormal` (requires the sketch editor open). Coordinates are world millimetres; rotation is in degrees. For selection framing, provide `entityId` and `selection: true` with a nonempty active triangle selection. `viewport_pick` takes normalized top-left `x`/`y` in `[0,1]` and returns ordered rendered-object hits and world points. Mesh triangle indices address rendered tessellation; point-cloud hits expose `pointIndex` instead. Neither is a native CAD face/edge reference. Picking does not change selection; use `object_select` or selection tools afterwards.

`ui_set` changes the ribbon tab, tool workspace, mode, tool-panel visibility or Settings visibility, and can dismiss the displayed error. It does not click arbitrary controls or accept GUI preview results. Changing workspace rejects an active GUI preview; inspect it, then explicitly use `preview_discard` with `target: "scan"`, `"surface"`, `"landmarks"` or `"sketchSection"` to discard the corresponding GUI preview. This uses the existing Cancel handlers, preserves committed geometry and remains available during GUI worker cleanup. It does not cancel API jobs; use `job_cancel` for those. Read visible control/status state to check the result. `settings_set` also exposes `normalsDisplay`; grid spacing uses the same supported bounds as the viewport.

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

Call `project_import` with the completed `artifactId`, `unit:"mm"`, current revision and request ID. Units may be `mm`, `cm`, `m`, `in`, or `ft`; all workspace coordinates are millimetres. Importing a project requires `replace:true`, which replaces the workspace and its authoring/history. Export unsaved work before replacement. STEP/IGES/BREP units follow the existing CAD importer.

For several scans/CAD files, use `project_import_batch` with `artifactIds` in import order, a common `unit`, current `expectedRevision`, and a fresh `requestId`. GUI drop and file-picker imports use the same sequential queue. Workers prepare smooth normals, bounds and statistics before transfer; import completion waits for a viewport draw and paint opportunity. Full resolution is retained unless sampled preview was explicitly chosen. Each completed file is an independent model undo step. A batch returns `completed` import results plus `failed` entries containing the original zero-based file `index` and `error`. A failed file does not discard successful imports; cancellation stops the remaining queue and retains committed objects. Inspect `project_get` after cancelling. Project files must be opened separately; they cannot be mixed into a batch. Existing artifact limits are unchanged.

`object_select` accepts `toggle:true` (Ctrl/Command-click) and `range:true` (Shift-click); combining them adds a range. Range order follows the Objects list and skips locked/unselectable objects. The range anchor is the last ordinary/toggle selection; repeated Shift-clicks retain it. `project_get` reports `selectedIds`, `selectedId` (active object for single-object tools), and `selectionAnchorId`. Omitting `entityId` clears the object set. GUI and MCP share these semantics; selecting several objects does not make single-object modeling commands operate on every object.

Ctrl+Z/Ctrl+Y use model history in the main workspace. Mesh selection uses its local undo/redo while a local step exists, then falls back to model history. Text fields and modal dialogs keep their native keyboard behavior. MCP retains explicit `history_undo`, `history_redo`, and triangle-selection operations.

Press **V** to toggle each selected object's visibility, retaining the object selection. The entire set changes atomically, using the existing display behavior outside modeling history. Agents use `object_visibility_toggle` with optional `entityIds`; omitting IDs uses the current object selection. Explicit IDs support hidden and locked objects because visibility is a display setting. Empty/stale targets fail before mutation. Geometry and triangle selections remain unchanged. Typing, visible dialogs and busy operations keep V inactive.

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
direction and optional length. CAD records include face index and the matching
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
`expectedRevision`, `requestId`, `entityIds` (1–32 distinct unlocked mesh/point-cloud
targets) and `constraints` (1–3 ordered references). Each reference has `kind`
(`plane`, `direction`, `point`), `point` (XYZ mm), `axis` (0=X, 1=Y, 2=Z; ignored
for points), optional `flip`, and a `direction` XYZ vector for planes/directions.
Use physical unit normals/directions from `alignment_references` when available.
Constructors are replayed in primary/secondary/tertiary order; incompatible
constraints fail without a model commit. Exact CAD targets are not supported.
Preview returns the native frame, rigid inverse matrix and proposed scan bounds;
it preserves the model and history. `preview_discard` with `target:"datum"`
restores the committed scene. Apply records one history step and preserves
facet/point identities and saved selection slots. Identity transforms are no-ops.
Use `job_get`/`job_cancel`; cancellation or revision conflict before commit
discards the result. GUI Object properties invokes these same operations for
manual coordinates, axis/flip controls, canvas point picking and center-to-origin.
Automatic feature bindings and original frame-translation controls remain
unfinished; the general ribbon command remains disabled.
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

For STEP, every included object must be exact CAD. Hide scan/reference objects before exporting STEP, or export an all-CAD workspace. This check avoids silently omitting requested visible geometry.

Call `artifact_read` with the artifact ID, byte `offset` and optional `length` (maximum 262,144). Decode each returned `base64` chunk, append in offset order, and stop at `eof:true`. Use the agent's own authorized file tools to save bytes at the requested location. ScanForge does not grant arbitrary filesystem read/write privileges. Delete disposable artifacts through `artifact_delete`; exporting does not mark the browser project as saved.

## Point clouds and landmark registration

See [point-cloud editing](POINT_CLOUD_EDITING.md) for selection, deletion, simplification, noise reduction and connected-selection MCP contracts.

`project_import` accepts `.asc` scans containing XYZ columns and optional NX/NY/NZ columns. Choose the import unit as for other scans. Every point is retained as a `pointcloud` object, without artificial triangle faces; normals survive project round trips and rigid alignment. Import results and object summaries report `points`, rather than `triangles`. Triangle topology and mesh-editing operations reject point clouds.

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
| Analysis                 | Mesh topology, primitive fitting, sections, deviations, point distance                                                                                                                                                                                          |
| Exact CAD                | `cad_create` recipes: primitives, BREP, extrude, revolve, loft, sweep, NURBS face, compatible closed patches, patterns, mirror, transform, booleans, split, fillet/chamfer, offset, sewing, shell and thicken                                                   |
| Parametric edits         | `cad_rebuild`, persistent feature/output references, dependency validation and rollback                                                                                                                                                                         |
| Sketches                 | Read/write active Sketch v1, solve constraints, create/activate/rename/delete saved sketches; sketch recipes permit extrusion of solved profiles                                                                                                                |
| NURBS                    | Control grids, weights/degrees/knots, projected scan fit; grid creation, quad OBJ import, knot/crease operations, snapping, C0/C1 joins and shell diagnostics; exact face/closed-patch conversion through recipes                                               |
| History and interaction  | Modeling undo/redo and timeline seeking, standard camera views/fit, display/theme/grid settings                                                                                                                                                                 |
| Files and execution      | Local artifact upload/download, project/scan/CAD import, project/STL/STEP export, job status/cancel                                                                                                                                                             |

Full Sketch and NurbsPatch wire structures are shown below. Existing domain validators enforce their invariants. Operations outside the advertised schemas are rejected; do not inject native worker IDs, raw worker requests, executable code, or arbitrary geometry fields into a command.

Sketch v1 contains `version:1`, `points:[{id,x,y}]`, `segments:[{id,a,b,construction?}]`, optional `arcs:[{id,a,b,center,clockwise,construction?}]`, and `constraints`. Constraint kinds include fixed, coincident, horizontal, vertical, distance, horizontalDistance, verticalDistance, radius, tangent, parallel, perpendicular, equal and angle. Inspect an existing sketch or the source `src/sketch.ts` for each constraint's fields. Optional `frame` defines its position and orientation; frame definitions live in `src/sketch-frame.ts`.

NurbsPatch contains `format:"scanforge-nurbs"`, `version:1`, `countU`, `countV`, `degreeU`, `degreeV`, `knotsU`, `knotsV`, row-major `points:[[x,y,z],...]`, and `weights`. Surface fitting takes `options:{countU,countV,degree?,projection:"xy"|"xz"|"yz",sampleLimit}`. Knots and weights must satisfy the existing rational surface validator.

## Limits and recovery

- One operation admission lane protects the owning model. Lightweight state reads and job/artifact tools remain available while a job runs. A second geometry operation returns `BUSY`.
- Jobs expire after 15 minutes; mesh/surface/import workers also retain their existing shorter inactivity/hard leases. CAD retains its existing 90-second per-operation timeout. Cancellation is cooperative: synchronous native CAD may finish before its output is discarded and the lane is released. Poll the terminal job status; do not assume `job_cancel` completed native cleanup immediately.
- The latest 32 geometry jobs are retained. Artifact storage is limited to 64 artifacts totaling 64 MiB, with a 15-minute inactivity lease. These are automation transfer limits; they do not change the editor's existing manual file limits. Large scan transfers may require the human to import locally.
- Primitive fits use at most 20,000 sampled vertices. Synchronous section/deviation analysis is capped at 250,000 triangles; reduce a separate copy or a supported selected region when needed. Modeling estimates are not certified metrology.
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

Origin/reference constraints can bind current CAD faces or fitted features: `{ "kind": "reference", "entityId": "cad-id", "referenceId": "cad-id/face/0", "axis": 2, "flip": false }`. Obtain stable IDs through `alignment_references`; optional `centerAt` is passed to the verified reference conversion. Preview and Apply read those references again at the requested workspace revision. Missing, foreign and unsupported reference IDs fail before geometry mutation. Source objects may be locked because they are read only; moving targets must remain unlocked scans. The GUI provides Reference object and Feature / face selectors with paged inspection and cancelled reads on disposal. Choose all requested features before previewing. Responses include resolved constraints in addition to the frame and resulting bounds.
