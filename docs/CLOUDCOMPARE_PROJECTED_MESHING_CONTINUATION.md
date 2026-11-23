# Projected meshing: cancellation, limits and real scan patch

Continuation completed 2026-10-28. The final browser/public MCP run passed on a
fresh server for the current checkout at `http://127.0.0.1:5190`. It used a
disposable Chrome profile and bridge; the existing 5173 browser/scene was left
untouched. The owned 5190 server was stopped and its listener confirmed absent.

[Final browser receipt](evidence/cloudcompare-20261028/meshing-continuation/evidence.json)
records actual results. The Browser plugin was unavailable, so this used regular
Playwright. No solver or worker response was mocked. An observer retained worker
creation, progress and termination calls; actual Playwright `Worker` close events
independently confirmed target closure before moving to the next test.

## Cancellation, retry and point limit

The synthetic input contains 500,000 unique projected points, generated
deterministically by `tests/point-cloud-meshing-lifecycle-browser.mjs`.

| Gate                         | Observed result                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-flight cancellation       | Three jobs cancelled after the actual processing worker reported “Triangulating projected surface”.                                              |
| Cancelled publication        | No mesh, geometry-history step or revision change; all source Float32 coordinates retained their SHA-256.                                        |
| Worker cleanup               | Every cancelled worker target closed; no result message was observed from those workers.                                                         |
| Request retries              | Retrying each exact request returned its retained cancelled job receipt and started no new worker.                                               |
| Successor after cancellation | The same 500,000-point input succeeded, producing 997,931 triangles with a 0.1 mm maximum edge setting; the worker target closed.                |
| Successor history            | One new mesh/history step; Undo restored the source-only scene with the exact source-coordinate hash.                                            |
| Above-cap admission          | 500,001 points failed with the documented 500,000-point limit before any processing worker was constructed; no revision/history/object mutation. |

The large successful output's full triangle quality was not independently
recomputed. This run establishes operation/cleanup/limit behavior and complete
source preservation, not an exhaustive numerical certificate for that large mesh.
The receipt's JavaScript heap snapshots describe the main browser context; they
are not aggregate process RSS measurements or proof of a process-memory cap.

## Deterministic real-data scope

Source: `C:/repo/alignment-example-files/asc-1.asc`, SHA-256
`4d1931c0f45b25951b682b54aba4b4ff3e9c0ebbd2f796e8615858691ff7e26c`.
It contains 140,113 valid XYZ/normal records. The fixture builder examines
dominant coordinate-axis normals and chooses a deterministic populated tile,
preserving source file order. It selects 333 points: approximately 0.238% of this
file, with no interpolation, smoothing or resampling.

The retained crop uses positive Y normals of at least 0.9 and half-open bounds
`[10,-22,-290]` to `[15,-21,-285]` mm. Its projection is XZ, with Y as height;
the chosen maximum full 3D edge is 0.35 mm. Exact source line indices and the
selection/tie-breaking algorithm are recorded in
[the manifest](evidence/cloudcompare-20261028/real-surface/manifest.json).
The initial positive-Z-only crop attempt did not meet its minimum size and is
retained separately; the all-axis selection rule is reproducible.

The fixture is an offline deterministic extraction, then imported into an
isolated application workspace. The browser exercises actual GUI meshing on that
point cloud and a fresh independent public MCP meshing request. Their expanded
positions, indexed vertices and triangle arrays match exactly. The source cloud,
including normals, remains unchanged. One history step, Undo and Redo are verified.

The independent `scripts/analyze-scanforge-real-meshing.mjs` reopens the original
owner ASC, verifies its whole-file hash, resolves the retained original line
indices and compares the selected records against the browser geometry artifact.
All selected Float32 positions and original normals match. Maximum coordinate
rounding relative to the selected original ASC decimal coordinates is
`0.000015136718729991117 mm`; the report does not claim unrounded decimal fidelity.

## Real patch geometry quality and limits

[Independent quality receipt](evidence/cloudcompare-20261028/meshing-continuation/real-surface-quality.json)
contains exact values and hashes. It imports no ScanForge triangulation code.

| Metric                                                    |    Measured result |
| --------------------------------------------------------- | -----------------: |
| Stored source/output vertices                             |          333 / 333 |
| Vertices used by retained triangles                       |                237 |
| Unused stored vertices                                    |                 96 |
| Triangles / pruned candidate triangles                    |          275 / 374 |
| Connected components of the triangle complex              |                 11 |
| Boundary edges                                            |                193 |
| Connected boundary-edge components                        |                 13 |
| Simple closed boundary loops                              |                 10 |
| Branching/touching boundary components                    |                  3 |
| Edges with more than two incident triangles               |                  0 |
| Non-manifold vertices by combinatorial vertex-link checks |                 10 |
| Inconsistent shared-edge winding                          |                  0 |
| Degenerate / duplicate triangles                          |              0 / 0 |
| Triangle surface area                                     | 7.964262092603 mm² |
| XZ projected triangle area                                | 7.701581270987 mm² |
| Maximum full 3D edge                                      |  0.349969189185 mm |
| Minimum triangle angle                                    |  21.339585 degrees |

The rendered result is visibly sparse and consists of disconnected strips and
point-touching pieces. The edge cutoff leaves holes and unused samples. Zero
non-manifold edges therefore must not be summarized as “manifold”: the independent
vertex-link check finds ten non-manifold vertices. Boundary components are counted
as simple closed loops only when each boundary vertex in that component has degree
two; the three other components are reported separately.

This is a bounded real-data workflow/edge-limit/retention result. It does not
establish complete real-scan surface coverage, watertightness, scanner accuracy,
self-intersection freedom or full 3D reconstruction quality. The original cloud
is preserved so the user can inspect these gaps and choose another patch or edge
limit. No meshing quality gate was redefined around this sparse result.

[GUI controls](evidence/cloudcompare-20261028/meshing-continuation/real-surface-gui-controls.png),
[inspected rendered mesh](evidence/cloudcompare-20261028/meshing-continuation/real-surface-gui-mesh.png).

## Truthful GUI completion status fix

The continuation exposed a product bug: after successful shared `mesh_process`
publication, selecting the new mesh triggered the App source-change cancellation
effect before the GUI adapter received the terminal success receipt. The GUI then
said “Projected meshing cancelled” even though the mesh/history had committed.

The new browser regression first failed on the missing success summary:
[red receipt](evidence/cloudcompare-20261028/meshing-continuation/status-regression-red.json),
[red screenshot](evidence/cloudcompare-20261028/meshing-continuation/status-regression-red.png).
`runProjectedMeshing` now sets and clears the existing `scanToolAccepting` guard,
as the other commit adapters already do. The final GUI run explicitly verifies
the actual “Created 275 projected triangles; source cloud preserved” summary
after output selection. This changes completion presentation only; geometry,
MCP results and history continue through the same shared application operation.

Final focused checks passed 47 tests across six files, including meshing core,
worker, executor/schema, GUI command, panel isolation and the existing shared
source-change cancellation guard tests. The final browser run passed with no page
errors. The parent investigation performs the final production build.

## Retained interruptions and reproduction

- `evidence-initial-pass.json` records the first complete continuation run.
- `evidence-before-status-fix.json` adds actual worker-target close observations,
  while retaining the then-unchecked GUI status limitation.
- `failure-bridge-startup.json` records a `BRIDGE_UNAVAILABLE` infrastructure
  failure during concurrent generated-kernel/build changes reported by the parent.
  It is separate from the expected status regression.
- The expected status red and final green receipts remain separate; no failed
  receipt was rewritten as a pass.

Reproduce fixtures and independent quality analysis with:

```text
node scripts/cloudcompare-real-surface-fixture.mjs
node tests/point-cloud-meshing-lifecycle-browser.mjs
node scripts/analyze-scanforge-real-meshing.mjs
```

The browser script defaults to the separate 5190 origin and requires a verified
current-checkout development server there. It uses a disposable browser/workspace,
closes its bridge/profile and retains artifacts under
`docs/evidence/cloudcompare-20261028/meshing-continuation/`.
