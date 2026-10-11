# ScanForge

An independently authored, open-source scan-to-CAD workbench that runs in a modern browser. TypeScript and React provide the interface, Three.js renders geometry, and OpenCascade.js processes exact CAD inside an isolated WebAssembly worker.

**Status: experimental workbench.** Editable rational NURBS patches, projected scan fitting, line-sketch constraints, normal-based segmentation, landmark/ICP registration and topology diagnostics/repair are implemented. Their limits are explicit: this is not a complete professional reconstruction suite or a verified reproduction of another application's algorithms. See [capabilities](docs/CAPABILITIES.md).

## Run locally

Requires Node.js 22.12 or later and npm. Installation needs a network connection; operation uses local static assets.

```sh
npm ci --ignore-scripts
npm run dev
```

Open the loopback URL printed by Vite. No application server, account, API key, proprietary activation, or external CAD service is required. Do not open `index.html` through `file://`: browsers require HTTP(S) for workers and offline installation.

## Build and validate

```sh
npm run build
npm test
npm run test:cad
npm run preview
```

The build produces `dist/`, including local CAD glue and WASM. Serve this directory through any HTTP static server. Relative asset URLs support hosting below a path. Production builds include an offline service worker that caches the complete static application on first successful installation over HTTPS or localhost. Offline availability depends on browser storage quota and eviction; cache installation is not guaranteed on every device.

Before distributing bundled kernel binaries, resolve the dependency provenance limitations documented in [CAD distribution](docs/CAD_DISTRIBUTION.md). This repository publishes authored source and dependency references; CI validates but does not publish binary artifacts or deploy a website.

## Appearance

Settings offers Light, Dark and System. The selected theme covers editor panels, controls and the 3D viewport and persists on this device. A tabbed ribbon groups scan, construction, surfacing, CAD and analysis commands. Objects and session History share the left sidebar; contextual tool options float beside the viewport. Unsupported commands are disabled and identified in their tooltips.

## Workflow

1. Open STL, OBJ, polygon PLY, STEP, IGES or BREP. Unitless scan coordinates are assumed to be millimetres. Point-cloud PLY is rejected.
2. Orbit, pan, zoom, change viewpoints, inspect dimensions, measure between picked surface points, and create cross sections. Section segments export to CSV.
3. Brush triangle selections; copy, cut or delete selected triangles with undo. Fit a plane, sphere, cylinder or cone to the whole mesh, selected triangles or a picked spherical region. Review residuals and signed deviation colors. Large fits use a bounded vertex sample. Triangle-soup sampling weights repeated vertices; this is not certified metrology.
4. Center and align scan principal axes. Create reference planes or reconstruct fitted spheres/cylinders/cones as exact CAD. Add box/sphere/cylinder/cone solids, transform exact bodies, use union/subtract/intersect, extrude a simple XY polygon, or revolve a radius/Z profile around the Z axis.
5. Use Scan Data tools to inspect topology, repair winding/duplicates/degenerates, fill eligible planar holes, smooth, reduce or segment meshes. Align paired XYZ landmarks or refine a nearby alignment with sampled ICP. Outputs enter undo history; Cancel preserves the original geometry.
6. Create a freeform control grid, fit a scan projection, edit control coordinates/weights/knots, snap controls and import ordered quad grids. Convert a NURBS patch to an exact CAD face. Create constrained line sketches with dimensions, conflict diagnostics and degrees of freedom; solve before extrusion.
7. Use CAD tools for lofts, path sweeps, selected-edge fillets/chamfers, offsets, sewing, shells and thickening. Edge and face references currently use zero-based kernel indices. Export visible exact bodies to STEP, or visible triangle geometry to STL. General automatic mesh-to-solid conversion is absent.
8. Save a `.scanforge` project and reopen it. Projects retain tessellation, object properties, exact BREP, NURBS authoring grids and the sketch draft. Worker IDs, measurement points, fit analysis, and undo history are transient. Editing mesh coordinates or transforming a body invalidates its old surface authoring grid; this prevents stale controls from rebuilding unrelated geometry.

SpaceMouse navigation is available in Settings through browser-local WebHID, with explicit device selection, translation/rotation sensitivity, deadzone, dominant-axis and rotation-lock controls. See [input devices](docs/INPUT_DEVICES.md) for tested protocol coverage and hardware limitations.

The built-in bracket is independently generated demonstration geometry, not measured scan data. Its two intersecting components are not welded; its volume is illustrative only.

## Limits and ownership

- No application-level file byte, triangle-count, or object-count cap. Available browser, GPU and WebAssembly memory determines capacity. Binary STL uses chunked reads into a transferable Float32Array; OBJ, PLY, ASCII STL and project loading still need whole-file parsing. A 200,000,084-byte binary STL with four million triangles was imported and rendered in browser validation.
- CAD tessellation uses 0.15 mm linear and 0.35 rad angular deflection. Large or unusual models may fail import or exceed browser limits.
- CAD operations execute serially, with a 90-second timeout. A timeout destroys the worker and invalidates live CAD handles; save/reopen a project to restore retained BREP.
- Undo/redo retains at most 20 snapshots. Shapes unreachable from the current project and undo/redo stacks are released.
- Imported data is not uploaded. No telemetry, analytics, cloud geometry processing, CDN assets, or network APIs are used at runtime.
- GPU resources, listeners, and workers are disposed when the page closes. Rendering pauses when idle.
- Mesh topology uses memory proportional to mesh complexity. Importing a large file does not prove that all repair operations fit available memory. Mesh processing has cancellation, a two-minute inactivity lease and a fifteen-minute hard expiry.
- Scan surface fitting is a projected height-field least-squares fit, not general closed-body surfacing. Normal-based segmentation is not semantic recognition of CAD surfaces. ICP is a local, sampled point-to-point refinement, not global scan registration. Planar hole repair cannot resolve arbitrary nonmanifold topology. Sketches support straight segments, not arcs or tangency; authoring is not a dependency-driven feature tree.

## Architecture

`src/ui/` owns interaction and project state. `src/viewport.ts` owns rendering and picking. `src/geometry.ts` contains independent analytical mesh algorithms. `src/io.ts` validates file/project boundaries. `src/cad/client.ts` owns a dedicated worker, and `public/cad-worker.js` owns native CAD handles and a disposable virtual filesystem. Tests exercise analytical geometry, file boundaries, and real native CAD roundtrips.

## License

Authored ScanForge code: [MIT](LICENSE). Dependencies retain their own licenses, including LGPL-2.1 for OpenCascade.js. See [third-party notices](THIRD_PARTY_NOTICES.md). Open-source licensing requirements still apply.
