# ScanForge

An independently authored, open-source scan-to-CAD workbench that runs in a modern browser. TypeScript and React provide the interface, Three.js renders geometry, and OpenCascade.js processes exact CAD inside an isolated WebAssembly worker.

**Status: experimental 0.1 foundation. This is not a complete professional reverse-engineering suite.** Advanced freeform reconstruction, NURBS patch editing, constrained parametric sketches, automatic surface segmentation, scan registration, and topology-aware mesh repair remain unimplemented. See [capabilities](docs/CAPABILITIES.md).

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

## Workflow

1. Open STL, OBJ, polygon PLY, STEP, IGES or BREP. Unitless scan coordinates are assumed to be millimetres. Point-cloud PLY is rejected.
2. Orbit, pan, zoom, change viewpoints, inspect dimensions, measure between picked surface points, and create cross sections. Section segments export to CSV.
3. Fit a plane, sphere or cylinder to the whole mesh or a picked spherical region. Review residuals and signed deviation colors. Large fits use a bounded vertex sample. Triangle-soup sampling weights repeated vertices; this is not certified metrology.
4. Create reference planes or reconstruct fitted spheres/cylinders as exact CAD. Add box/sphere/cylinder solids, transform exact bodies, use union/subtract/intersect, or extrude a simple XY polygon.
5. Export visible exact bodies to STEP, or visible triangle geometry to STL. Scan meshes are excluded from STEP; there is no automatic mesh-to-solid conversion.
6. Save a `.scanforge` project and reopen it. Projects retain tessellation, object properties, and exact BREP where available. Worker IDs, current measurement points, fit analysis, and undo history are transient.

The built-in bracket is independently generated demonstration geometry, not measured scan data. Its two intersecting components are not welded; its volume is illustrative only.

## Limits and ownership

- Import file limit: 64 MiB. Project limit: 100 objects and 666,666 total triangles.
- CAD tessellation uses 0.15 mm linear and 0.35 rad angular deflection. Large or unusual models may fail import or exceed browser limits.
- CAD operations execute serially, with a 90-second timeout. A timeout destroys the worker and invalidates live CAD handles; save/reopen a project to restore retained BREP.
- Undo/redo retains at most 20 snapshots. Shapes unreachable from the current project and undo/redo stacks are released.
- Imported data is not uploaded. No telemetry, analytics, cloud geometry processing, CDN assets, or network APIs are used at runtime.
- GPU resources, listeners, and workers are disposed when the page closes. Rendering pauses when idle.

## Architecture

`src/ui/` owns interaction and project state. `src/viewport.ts` owns rendering and picking. `src/geometry.ts` contains independent analytical mesh algorithms. `src/io.ts` validates file/project boundaries. `src/cad/client.ts` owns a dedicated worker, and `public/cad-worker.js` owns native CAD handles and a disposable virtual filesystem. Tests exercise analytical geometry, file boundaries, and real native CAD roundtrips.

## License

Authored ScanForge code: [MIT](LICENSE). Dependencies retain their own licenses, including LGPL-2.1 for OpenCascade.js. See [third-party notices](THIRD_PARTY_NOTICES.md). Open-source licensing requirements still apply.
