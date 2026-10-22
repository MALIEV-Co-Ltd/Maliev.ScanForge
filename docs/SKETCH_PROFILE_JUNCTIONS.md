# Exact sketch profile junctions

The mirrored open half-profile reproduced a real GUI failure: **Extrude solved
profile** reported `Profile must be a single unbranched cycle.` Although both
halves met exactly at the construction axis, their independently authored point
IDs prevented traversal. The same rejection occurred in both public MCP
`cad_create` sketch extrusion recipe kinds.

The shared profile-topology helper now aliases endpoints with exactly equal
local UV coordinates while assembling the derived wire. Both analytic
`sketch-curves` and legacy sampled `sketch` recipes use it. Authored point IDs,
constraints, construction geometry, placement and recipe data are unchanged.
Arc centres remain analytic and arc direction follows the actual traversal,
including when junction IDs differ. Construction curves and unused points do
not create profile branches.

This does not snap nearby points or weld the editable sketch. A nonzero gap
remains open, including a gap of 1e-12 mm. Existing zero-edge, nonzero-area,
branch and disconnected-cycle checks remain in force. Signed zero represents
the same geometric endpoint. Exact endpoint matching is an application policy;
the native application's general joining tolerance and curve-network assembly
have not been established by numerical replay.

GUI extrusion and MCP `cad_create` reach the same profile helper through the
existing CAD evaluator. Revision/retry checks, kernel ownership, cancellation,
one model-history entry and sketch-history separation retain their existing
contracts. No additional MCP command or alternate agent implementation is
introduced. `sketch_get` and saved recipe graphs remain the source of authored
topology; CAD references and `mesh_analyze` expose the generated body.

Validation passed: 11 new regression tests, 132 focused tests, the production
build, CAD smoke checks and the full suite (47,667 passed, 64 skipped). A rendered
browser run compared GUI extrusion and both public MCP recipe kinds on offset
OXY, OYZ and OXZ planes: nine exact CAD bodies had matching world bounds and
planar face descriptors. The 40 x 60 x 20 mm fixture measured 48,000 mm3 through
its tessellation; exact CAD mass is not exposed. Retry protection, model
Undo/Redo, source-graph preservation and project save/reopen also passed.

The isolated browser run peaked at 1,162.7 MiB under a 4 GiB process-job limit
and 25% CPU cap. All 17 owned processes exited and all handles and three ports
closed. GPU readback warnings and two bridge teardown errors were recorded;
no workflow page exceptions occurred. Offline caching was not validated. A
fresh user-facing tab restored the same mirrored fixture and successfully
created the extrusion. A read-only independent review found no actionable
issues; it did not independently rerun the checks.

See [the structured evidence](evidence/sketch-profile-junctions.json). These
checks validate this application fix. Native general joining tolerance and the
separate three-scan solver comparison remain open.
