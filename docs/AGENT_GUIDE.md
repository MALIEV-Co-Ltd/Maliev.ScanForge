# ScanForge MCP agent guide

ScanForge exposes its browser-owned workspace through an official-SDK MCP stdio server. Agents and the editor use shared application operations, CAD evaluation, model validation and history. No hosted account, model provider or cloud geometry service is required.

Read this guide through the MCP resource `scanforge://agent-guide`. Discover exact input schemas through `tools/list` or `capabilities_get`. Read live state through `project_get` or `scanforge://project`. The application API version is **1.0**; the saved project version and MCP protocol version are separate contracts.

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

1. Read `scanforge://agent-guide`, then discover tool schemas.
2. Call `project_get`. Retain object IDs, feature IDs, units and the response's top-level `revision`.
3. For a mutation, supply that `expectedRevision` and a new `requestId` alongside command parameters.
4. If the tool returns a `jobId`, poll `job_get` approximately once per second until its status is `succeeded`, `failed` or `cancelled`. An accepted job is not a successful model edit.
5. Inspect returned diagnostics and affected objects. Use `project_get` again before the next mutation, particularly after a job, UI action, selection change or import.
6. Export requested outputs and retrieve their artifacts. Disconnect or delete unneeded artifacts when finished.

Never infer that an operation succeeded from a status message or transport success. Check `ok`, the job's terminal status and its result. Read the model state after modeling changes.

### Response contract

Successful tools return MCP `structuredContent` and equivalent JSON text:

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
- Unsupported geometry features remain unsupported: arbitrary automatic scan-to-solid reconstruction, scanner drivers and point-cloud import are not created by MCP integration. Browser-owned device permission dialogs, file choosers and modal layout navigation remain human/browser interactions; use file artifacts and semantic commands instead.
- `REVISION_CONFLICT`: reread state and reconcile intent; use a new ID for a changed request. `REQUEST_CONFLICT`: do not reuse an ID for a different command. `INVALID_ARGUMENT`: correct the published-schema parameters. `RESOURCE_LIMIT`: release transient artifacts or use manual import. `OPERATION_FAILED`: inspect its exact message and job diagnostics. `BRIDGE_UNAVAILABLE`: check the running MCP client, paired browser, token/origin/port and ownership lease.
- Native timeout resets can invalidate current browser handles; save retained BREP and reopen the project using the existing recovery workflow. Disconnect requests cancellation; it does not erase the user's project or persistent backups.

## Maintainer validation

```sh
npm run build
npm test -- tests/automation-api.test.ts tests/automation-operations.test.ts tests/authoring-operations.test.ts tests/browser-bridge.test.ts tests/mcp-server.test.ts
npm test
npm run test:cad
npm run test:mcp:browser
npm run format:check
```

The browser test uses installed Chrome, a disposable profile, an isolated static server and the actual MCP stdio executable. It closes its MCP child, browser and HTTP server in `finally` and verifies port closure. It does not use or alter an existing user browser session. See `docs/MCP_ARCHITECTURE.md` for extension rules.
