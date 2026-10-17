# MVP parallel execution

The complete non-licensing reconstruction goal remains unchanged. Deliver the
usable reverse-engineering MVP first; optional capabilities and cosmetic polish
follow. This execution order does not remove requirements from the full goal.

## MVP acceptance path

Import STL/PLY meshes and ASC point clouds; select, clean and repair scan data;
align scans to references/origin and each other; combine aligned scans; construct
reference geometry; create and edit plane sketches; produce usable surface/solid
geometry; inspect deviations; save, reopen and export results.

Each capability requires a real shared GUI/MCP operation, discoverable parameters
and results, cancellation/error behavior, appropriate undo/history semantics,
and evidence matched to the claimed native behavior. A visible control or a
passing helper test does not establish a completed feature.

## Parallel lanes

This session supports four simultaneous agents including the coordinator.
Related domains share specialist lanes rather than pretending seven independent
agents are running. Reassign a freed slot to the next bounded MVP slice.

| Lane                                | Owner                                  | Initial assignment                                                                                                                    |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Alignment and scan integration      | Coordinator                            | Full three-scan public controller/final geometry comparison, remaining native preparation boundary, mixed import and combine workflow |
| Sketch and construction/primitives  | `mvp_sketch_construction`              | Identify the highest-value missing plane-sketch or reference-geometry operation and its native evidence                               |
| Surfacing and freeform              | `mvp_surface_freeform`                 | Identify the smallest missing operation that converts prepared scans/sketches into usable editable geometry                           |
| Inspection and deviation            | `mvp_inspection_deviation`             | Identify the highest-value correctness gap in scan-versus-reference inspection                                                        |
| UI/MCP integration                  | Coordinator, then available specialist | Own shared contract integration and common editor wiring; ensure every lane has parity                                                |
| Performance and resource scheduling | Coordinator, then available specialist | Bound allocations, preserve deterministic output, schedule expensive validation, verify cleanup                                       |

Specialists begin with targeted read-only source and retained-native-evidence
inspection. They return one concrete implementation slice, exact file ownership,
dependencies and validation. The coordinator then assigns non-overlapping write
ownership; independent implementation and evidence analysis can proceed together.
An investigation alone is not recorded as feature completion.

## Shared-state and resource rules

- Preserve unrelated existing work. Do not reset, broadly stage or commit it.
- The coordinator owns changes to common App/API/catalog files unless a specific
  integration window is assigned. Domain agents propose contract changes first.
- Keep source geometry, units, transforms, preview ownership and history contracts
  consistent across lanes. Reuse the existing shared operation architecture.
- No specialist starts native engines, browser replays, builds or test suites
  without a centrally assigned resource window. No independent admission races.
- Respect existing memory guards: native analysis 3072 MiB, builds 4096 MiB,
  suites 3072 MiB, full three-scan browser launch headroom 5120 MiB, plus each
  runner's existing runtime/storage caps. Do not lower guards to admit a run.
- Keep the latest development application on loopback port 5173. Track exact
  helper identity and finite lease; clean unused task-owned resources on every
  exit. Never stop another task or user application to free capacity.
- No push, deployment or release publication. The first release remains v0.1.0.

## Integration and completion gates

For each coherent source slice: build first, focused regressions, affected suite,
scoped static checks, GUI/MCP boundary verification and required native comparison.
Run these sequentially in their granted resource window. Review agent results
before integrating; commit only intentionally owned, validated changes.

Record unrun checks and exact blockers. Separate implemented, tested and native
verified status. Keep full-size scan comparisons distinct from synthetic workflow
fixtures, and numerical parity distinct from successful alignment quality.

Finish and validate the current alignment milestone, then integrate the next
ready MVP lane. Continue independent investigations and implementations during
that milestone when resources and ownership permit. Do not use optional work to
avoid an unresolved MVP gate.
