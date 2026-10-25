# M6 inspection implementation and acceptance plan

**Goal:** Complete issue #6 with reproducible inspection and shared GUI/MCP results.
**Architecture:** Reuse world-mm geometry and immutable entities. Centralize inspection validation, measurements, hidden-element filtering, sections and signed primitive reports; retain existing artifact contracts. Use the same helpers in the editor and MCP executor.
**Spec:** GitHub issue #6 and milestone 7, fetched 2026-10-25.

## Constraints

Preserve source buffers, revision/retry protection, job cancellation, history and resource guards. Native comparisons must use identical geometry/settings. Passing analytic or browser fixtures does not prove native parity. Do not close until M3/M5 dependencies and every acceptance gate pass.

## Work

- [x] Add failing analytic and API tests for distance/angle/radius/diameter, signed primitive statistics, hidden geometry, sparse clouds, section scope and invalid inputs.
- [x] Implement shared inspection calculations; connect GUI and published MCP schemas, artifacts and documentation.
- [x] Verify heatmap mapping for indexed geometry, hidden faces, edits and transforms; verify GUI/public-MCP numerical and export equality, history, persistence, cancellation and cleanup.
- [ ] Record native comparisons and exact candidate/source/build identity; run build, affected/full tests, CAD smoke and formatting.
- [ ] Review changes and evidence, merge verified changes into main, then close issue/milestone only if every gate passes.

## Review focus

Degenerate picks must fail without NaNs. Hidden cloud indices are points, mesh indices are triangles. Signed analytic distances describe oriented infinite surfaces, not watertight inside/outside. Sections cannot reinterpret sparse clouds as triangle soup. Cancellation/stale revisions must publish no artifacts or geometry changes.

Implementation, automated verification and independent review passed. Native comparison coverage remains partial; see `docs/M6_ACCEPTANCE.md`. Milestone closure is still gated by M3/M5 and the native matrix.
