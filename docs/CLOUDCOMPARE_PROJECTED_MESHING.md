# Projected point-cloud meshing

Investigation and implementation: 2026-10-28. This delivers the projected 2.5D
route for single-valued surface scans. General closed-object reconstruction and
Poisson reconstruction remain separate, unimplemented routes.

## Native basis and implementation boundary

REA inspection of the installed CloudCompare 2.13.2 `CCCoreLib.dll` identified
`PointProjectionTools::computeTriangulation` at `0x180057630` and
`Delaunay2dMesh::removeTrianglesWithEdgesLongerThan` at `0x18001f950`. Their
retained records are in `evidence/cloudcompare-20261028/rea-core-bundle.json`.
The projected branch triangulates two coordinate dimensions, then filters using
all three original coordinate dimensions. The maximum edge condition applies to
each of a triangle's three edges. Static pseudocode is derived evidence, not
original source or observed execution.

The parent investigation also executed the installed CloudCompare on the
437-point `fixtures/fixed.ply` curved surface with XY projection and maximum edge
2 mm, retaining `native-delaunay-output.ply`. The independent comparison below
uses that actual native output.

ScanForge uses Delaunator 5.1.0, pinned in `package.json` and `package-lock.json`.
[Its upstream API and license](https://github.com/mapbox/delaunator) were checked;
the installed package is ISC licensed. No CloudCompare GPL implementation was
copied or linked. This implementation chooses explicit XY/XZ/YZ projection,
consistent positive omitted-axis winding, and stricter refusal of multiple
heights at exactly the same projected location after Float32 conversion.

## Shared application path

GUI: **Edit scan → Point-cloud processing → Mesh a projected surface**. Choose
the projection plane and maximum mesh edge in mm, then **Create projected mesh**.
It processes the whole visible cloud, preserves that object, creates/selects a
new triangle mesh and records one geometry-history entry. Undo removes the mesh;
Redo restores it. Ordinary point-selection processing controls do not restrict
this whole-cloud action.

MCP uses the same revisioned application operation:

```json
{
  "entityId": "cloud-id",
  "operation": {
    "kind": "pointCloudMesh",
    "plane": "xy",
    "maxEdgeLength": 2
  },
  "expectedRevision": 12,
  "requestId": "unique-request-id"
}
```

Submit through `mesh_process`, poll `job_get`, cancel with `job_cancel`, and use
returned `entityIds` with `object_get`/geometry artifacts. The GUI adapter submits
this same public command. Validation, locks, revisions, retries, worker leases,
cancellation and commit/history all use the existing application path. The
processing worker runs the projected triangulator and returns indexed topology
and expanded display geometry. No new agent tool is required.

Diagnostics include `algorithm:projected-delaunay-2.5d`, `projectionPlane`,
`sourcePoints`, `uniqueProjectedPoints`, `duplicatePoints`, `triangles`,
`prunedTriangles`, `maxEdgeLength`, `normalsRequired:false` and a readable summary.

## Limits and recovery

- Accepts 3–500,000 XYZ samples. Reduce larger clouds first. Bounds are checked
  before copying geometry into the worker and again inside the triangulator.
- Requires a raw unlocked point cloud with all points visible. Omit
  `selectionOnly` and targets; `createNew:false` is rejected. Extract a separate
  cloud to mesh only part of a scan.
- Coordinates must remain finite at Float32 output precision. Exact duplicate
  XYZ samples are deduplicated for triangulation. Multiple heights at one exact
  projected location are refused; choose another plane or segment one surface.
- Collinear/degenerate projections and outputs with no remaining triangles fail
  without changing geometry/history. Normals are not consumed or required.
- `maxEdgeLength` defaults to zero: no pruning, so the projected convex hull is
  filled, including holes. A positive value removes triangles with any full 3D
  edge longer than the limit. It does not recover hole boundaries automatically.
- This projection can bridge distinct surfaces or fold an overhanging scan even
  when no exact duplicate projected coordinates occur. The user must choose a
  single-valued surface and inspect the result. This is not a closed-object or
  volumetric reconstruction algorithm.

## Actual validation

Focused tests passed: 48 tests across seven files, including the triangulator,
real processing worker in process, shared executor with mocked worker transport,
public schema, GUI command dispatch, panel isolation, existing point-cloud edits
and reconstruction operations. TypeScript
passed. The new module's missing-import red run was observed before production
implementation.

`tests/point-cloud-meshing-browser.mjs` passed against the verified current
checkout server at `http://127.0.0.1:5187`, with a disposable Chrome profile and a
real public MCP bridge. It preserved the user's browser and scene. Browser
plugin was unavailable, so this used regular Playwright.

The browser run verified GUI/public-MCP identical expanded positions, indexed
vertices and triangle arrays; unchanged source geometry; one history entry;
Undo/Redo; XY/XZ/YZ; and a steep triangle whose XY edges pass but full 3D edges
exceed 2 mm. That failure preserved revision/history. Browser errors were empty.
Screenshots of controls and the rendered source/mesh were inspected. Derived
normal caches are populated lazily and are outside the geometry equality claim.

[Browser receipt](evidence/cloudcompare-20261028/meshing-browser-evidence.json),
[controls](evidence/cloudcompare-20261028/meshing-gui-controls.png),
[rendered result](evidence/cloudcompare-20261028/meshing-gui-result.png).

The independent `scripts/compare-cloudcompare-meshing.mjs` reads native PLY with
Three's PLYLoader and compares it with the public MCP geometry artifact; it
imports no ScanForge triangulation implementation.

| Metric                                              | Native CloudCompare |                 ScanForge |
| --------------------------------------------------- | ------------------: | ------------------------: |
| Float32 vertices                                    |                 437 | 437, byte-value identical |
| Triangles                                           |                 772 |                       772 |
| Shared triangle vertex sets, ignoring winding/order |                 772 |                       772 |
| Boundary edges                                      |                  92 |                        92 |
| Non-manifold edges                                  |                   0 |                         0 |
| Degenerate triangles                                |                   0 |                         0 |
| Positive-Z triangles                                |                 772 |                       772 |
| Maximum 3D edge, mm                                 |  1.9776569792780032 |        1.9776569792780032 |
| Surface area, mm²                                   |  472.79050883645596 |         472.7905088364563 |

[Native comparison receipt](evidence/cloudcompare-20261028/meshing-native-comparison.json)
includes both output hashes. This establishes topology/coordinate agreement for
this one synthetic surface and these settings; it does not establish general
CloudCompare equivalence, scanner accuracy, closed-object reconstruction,
normal/shading equality or complete meshing milestone acceptance.

Three failed browser harness receipts are retained separately. The first waited
for transient status text; the second compared lazy derived-normal cache fields;
the third incorrectly assumed geometry artifacts fit one chunk. The final
harness waits for public scene state, compares coordinate/topology arrays and
reads all artifact chunks. These were test-harness corrections, not changes to
application success criteria or hidden product failures.

The [continuation report](CLOUDCOMPARE_PROJECTED_MESHING_CONTINUATION.md) records
real worker cancellation/closure, retry and 500,000-point admission tests, a
bounded real ASC surface patch, its disconnected/point-touching topology limits,
and the GUI completion-status regression/fix discovered during that work.
