# ScanForge

An independently authored, open-source scan-to-CAD workbench that runs in a modern browser. TypeScript and React provide the interface, Three.js renders geometry, and OpenCascade.js processes exact CAD inside an isolated WebAssembly worker.

**Status: experimental workbench.** Editable rational NURBS patches, compatible closed-patch solid reconstruction, dependency-driven parametric rebuilds, line/arc sketch constraints, classified segmentation, scan registration and nonmanifold sheet repair are implemented. Their limits are explicit: this is not a complete professional reconstruction suite or a verified reproduction of another application's algorithms. See [capabilities](docs/CAPABILITIES.md).

## Run locally

Requires Node.js 22.12 or later and npm. Installation needs a network connection; operation uses local static assets.

```sh
npm ci --ignore-scripts
npm run dev
```

Open the loopback URL printed by Vite. No application server, account, API key, proprietary activation, or external CAD service is required. Do not open `index.html` through `file://`: browsers require HTTP(S) for workers and offline installation.

## Connect and control through MCP

Agents can control ScanForge through its local MCP stdio server. Start the application using the commands above and keep its browser tab open: geometry executes in that browser. Read the [complete agent guide](docs/AGENT_GUIDE.md) for modeling examples, artifact transfers, limits and recovery.

Generate a pairing token locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Configure your agent's MCP client to launch Node directly. Replace the example checkout path and token; keep the real token in local client secret/environment configuration, outside source control. Client configuration syntax may vary.

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

Use `node` as the stdio command, not `npm run mcp`: npm startup output can interfere with MCP messages. In ScanForge, open **Settings → AI agent access**, enter `http://127.0.0.1:5184` and the same token, then select **Connect agent**. Closing Settings keeps the connection active. **Disconnect agent** revokes access and requests cancellation of current agent work. This integration requires explicit browser pairing; remote MCP and unattended headless modeling are not supplied.

Once paired, the agent should:

1. Read the MCP resource `scanforge://agent-guide`, then discover tools and schemas with `tools/list` or `capabilities_get`.
2. Call `project_get` (or read `scanforge://project`) to inspect objects, units and the current `revision`.
3. Invoke a discovered tool with its documented parameters. For mutations, include the current `expectedRevision` and a new `requestId`.
4. If a tool returns a `jobId`, poll `job_get` approximately once per second until it succeeds, fails or is cancelled. Check `ok`, terminal status, diagnostics and actual results.
5. Refresh `project_get` before the next mutation. On a lost response, retry with the same request ID and identical arguments; on a revision conflict, inspect fresh state before submitting a new request.
6. Use import/export tools and artifact transfer tools to exchange files; delete unneeded artifacts when finished. See the guide for chunk sizes and transient retention limits.

Tools cover projects, object properties, selection, mesh analysis/processing, CAD creation/rebuild, sketches, surfaces, history, viewport controls, settings and file import/export. Discover current capabilities rather than assuming a GUI command or unsupported operation is available.

**Repository requirement:** every application change must also expose equivalent agent access through shared application operations, with MCP tests and documentation. Missing MCP parity blocks completion and commit. See [AGENTS.md](AGENTS.md) and the [MCP architecture](docs/MCP_ARCHITECTURE.md).

## Build and validate

```sh
npm run build
npm test
npm run test:cad
npm run preview
```

The build produces `dist/`, including local CAD glue and WASM. Serve this directory through any HTTP static server. Relative asset URLs support hosting below a path. Production builds include an offline service worker that caches the complete static application on first successful installation over HTTPS or localhost. Offline availability depends on browser storage quota and eviction; cache installation is not guaranteed on every device.

Before distributing bundled kernel binaries, resolve the dependency provenance limitations documented in [CAD distribution](docs/CAD_DISTRIBUTION.md). CI validates without publishing binary artifacts or deploying a website. The [release workflow](docs/RELEASING.md) tags validated source changes and publishes cumulative major/minor source releases; patch increments use tags without separate release notes. Future hosting belongs to the Legacy.Maliev.* frontend services.

## Appearance

Settings offers Light, Dark and System. The selected theme covers editor panels, controls and the 3D viewport and persists on this device. Opacity, color and visibility changes stay outside modeling history. Mesh editing has separate selection undo/redo, hide/isolate/reveal and persistent named selections. A tabbed ribbon groups scan, construction, surfacing, CAD and analysis commands. Objects and session History share the left sidebar; contextual tool options float beside the viewport. Unsupported commands are disabled and identified in their tooltips.

Dark mode uses monochrome charcoal shades. Newly imported and created parts start in neutral CAD gray under neutral studio lighting. Saved project colors and user color edits remain authored properties.

## Workflow

1. Open STL, OBJ, polygon PLY, STEP, IGES or BREP. Unitless scan coordinates are assumed to be millimetres. Point-cloud PLY is rejected.
2. Middle-drag rotates, Ctrl+middle pans and Shift+middle zooms. Right-click opens viewport actions. Change viewpoints, inspect dimensions, measure between picked surface points, and create cross sections. Section segments export to CSV or DXF LINE entities in world XYZ millimetres.
3. Select triangles with a screen brush, rectangle, ellipse or connected-region wand. Alt subtracts; Select through includes hidden layers; Ctrl+wheel adjusts brush radius or wand angle. Copy, cut or delete selected triangles with undo. Connected growth ignores winding and stops at nonmanifold edges and vertex-only contacts. Fit a plane, sphere, cylinder or cone to the whole mesh, selected triangles or a picked spherical region. Review residuals and signed deviation colors. Large fits use a bounded vertex sample. Triangle-soup sampling weights repeated vertices; this is not certified metrology. See [mouse interaction](docs/INPUT_INTERACTION.md) for evidence and limits.
4. Center and align scan principal axes. Create reference planes or reconstruct fitted spheres/cylinders/cones as exact CAD. Add box/sphere/cylinder/cone solids, transform exact bodies, use union/subtract/intersect, extrude a simple XY polygon, or revolve a radius/Z profile around the Z axis.
5. Use Scan Data tools to inspect topology, repair winding/duplicates/degenerates, fill eligible planar holes, smooth, reduce or segment meshes. Align paired XYZ landmarks or refine a nearby alignment with sampled ICP, or search 24 principal-axis poses before ICP. Segmented regions classify supported planes, spheres, cylinders and cones; unsupported regions remain unclassified. Outputs enter undo history; Cancel preserves the original geometry.
6. Create a freeform control grid, fit a scan projection, edit control coordinates/weights/knots, insert rational knots, prepare creases, join compatible C0/C1 boundaries, snap controls and import ordered quad grids. Convert a NURBS patch to an exact CAD face. Create constrained line/arc sketches with dimensions, radius and tangent constraints, conflict diagnostics and degrees of freedom; solve before extrusion. Arcs are converted to polygon chords at the chosen tolerance.
7. Use CAD tools for lofts, path sweeps, selected-edge fillets/chamfers, offsets, sewing, shells, thickening, linear/circular body patterns, arbitrary-plane mirroring and inside/outside solid splitting. Patterns are unfused compounds. Edge and face references currently use zero-based kernel indices. Export visible exact bodies to STEP, or visible triangle geometry to STL. General automatic mesh-to-solid conversion is absent.
8. Assemble compatible NURBS patches, inspect seam/topology diagnostics and convert a closed single shell into an exact CAD solid. The worker sews the faces and checks orientation and kernel validity. Automatic reconstruction of an arbitrary scan is not available.
9. Edit a CAD feature's JSON recipe through the advanced CAD tool panel and rebuild its dependent features atomically. Failed or cancelled rebuilds preserve the prior model; successful rebuilds support Undo. Projects retain these recipes, tessellation, object properties, exact BREP, NURBS grids and the sketch draft. Worker IDs, measurement points, fit analysis and session undo history are transient.

SpaceMouse navigation is available in Settings through browser-local WebHID, with explicit device selection, translation/rotation sensitivity, deadzone, dominant-axis and rotation-lock controls. See [input devices](docs/INPUT_DEVICES.md) for tested protocol coverage and hardware limitations.

The built-in bracket is independently generated demonstration geometry, not measured scan data. Its two intersecting components are not welded; its volume is illustrative only.

## Limits and ownership

- No application-level file byte, triangle-count, or object-count cap. Available browser, GPU and WebAssembly memory determines capacity. Binary STL uses chunked reads into a transferable Float32Array; OBJ, PLY, ASCII STL and project loading still need whole-file parsing. A 200,000,084-byte binary STL with four million triangles was imported and rendered in browser validation.
- CAD tessellation uses 0.15 mm linear and 0.35 rad angular deflection. Large or unusual models may fail import or exceed browser limits.
- CAD operations execute serially, with a 90-second timeout. A timeout destroys the worker and invalidates live CAD handles; save/reopen a project to restore retained BREP.
- Undo/redo retains at most 20 snapshots. Shapes unreachable from the current project and undo/redo stacks are released.
- Normal editor operation keeps imported data local, with no telemetry, analytics, cloud geometry processing or CDN assets. Explicit MCP pairing enables loopback command and artifact transfer to the configured local agent bridge; geometry still executes in the browser.
- GPU resources, listeners, and workers are disposed when the page closes. Rendering pauses when idle.
- Mesh topology uses memory proportional to mesh complexity. Importing a large file does not prove that all repair operations fit available memory. Mesh processing has cancellation, a two-minute inactivity lease and a fifteen-minute hard expiry.
- Scan fitting remains a projected height-field method. Closed reconstruction requires compatible supplied patches; it does not discover an arbitrary scan's surface network or certify global self-intersections and nested cavities. Segmentation and PCA/ICP registration are heuristic. Ambiguous nonmanifold junctions split into separate manifold sheets; optional planar capping cannot repair arbitrary holes. Parametric edge/face recipes use kernel indices, which may become invalid after topology changes; persistent topology naming is absent.

## Architecture

ScanForge supports local AI-agent control through MCP. The editor and agents share CAD creation/rebuild operations, project validation and modeling history. Configure a stdio MCP client, then pair its loopback bridge in **Settings → AI agent access**. Agents can inspect and edit supported scan/CAD/sketch/surface features, run cancellable jobs, and transfer local import/export artifacts. See the [agent setup and usage guide](docs/AGENT_GUIDE.md) and [MCP architecture](docs/MCP_ARCHITECTURE.md). Browser pairing is explicit; the ordinary editor needs no bridge. Headless and remote/cloud MCP execution are not included.

`src/ui/` owns interaction and project state. `src/viewport.ts` owns rendering and picking. `src/geometry.ts` contains independent analytical mesh algorithms. `src/io.ts` validates file/project boundaries. `src/cad/client.ts` owns a dedicated worker, and `public/cad-worker.js` owns native CAD handles and a disposable virtual filesystem. Tests exercise analytical geometry, file boundaries, and real native CAD roundtrips.

## License

Authored ScanForge code: [MIT](LICENSE). Dependencies retain their own licenses, including LGPL-2.1 for OpenCascade.js. See [third-party notices](THIRD_PARTY_NOTICES.md). Open-source licensing requirements still apply.
