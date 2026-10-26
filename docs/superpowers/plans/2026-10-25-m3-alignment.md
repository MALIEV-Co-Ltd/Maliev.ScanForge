# M3 alignment and scan combination implementation record

M3 is issue #3 / GitHub milestone #4. The owner also requires exact native Re-polygonize comparison. The runtime candidate is `296925eac314f49c2875bcbdb5ea5245e2cf6fe9`, build `scanforge-bab4f9199590cf11` (2,095 compiler inputs / 273 assets). [Acceptance and evidence](../../M3_ACCEPTANCE.md) records each tested source, retained input, command, comparison boundary and measured limitation.

## Constraints retained

- Preserve the dirty primary checkout, other chats and live native session. Work in the isolated `codex/m3-alignment` checkout.
- Preserve complete original STL/PLY/ASC input bytes and millimetre units; distinguish captured prealigned native inputs from pristine originals and known-copy controls.
- Share application operations between GUI and MCP, including validation, defaults, revision/retry/lock checks, cancellation, ownership, history and persistence. Keep catalog and agent documentation consistent.
- Run heavy validation serially in owned 4 GiB / 25% CPU jobs with finite leases. Keep failed, timed-out and admission-failed receipts separate from successful runs.
- Assess registration quality separately from numerical equivalence. Do not turn optimizer convergence flags, partial overlap or exact native reproduction into unsupported accuracy or watertightness claims.

## Completed implementation and runtime verification

- [x] Resolve milestone numbering, verify M1 dependency and create an isolated worktree from the verified baseline.
- [x] Reproduce and fix Fine Align accuracy/overlap reporting, complete-target binding, normal ownership, stable cloud selection and worker indexed-output defects with regressions.
- [x] Integrate native signed-field reconstruction and shared method/input/owner rules; preserve explicit voxel reconstruction for clouds, mixed inputs and closed-envelope workflows.
- [x] Preserve new-owner construction identity, reversible input visibility, complete normal/index carriers and binary project/history state through GUI and MCP.
- [x] Build with zero warnings/errors; pass 49,172 local tests (64 explicitly skipped), focused worker tests and current hosted build/test/CAD/format checks.
- [x] Compare all original native Global controller/query/setter geometry and computed normals using captured clocks and the retained prealigned state; verify cached Apply/retry and Undo/Redo. Record unobserved scanner attributes separately.
- [x] Compare native Re-polygonize ordered/indexed geometry and observable encoded normal information on all three complete posed inputs, with actual GUI/public-MCP execution, export/reimport and reopened history. Generic STL serialization and unknown QSF fields remain explicitly outside this operation comparison.
- [x] Verify original STL/PLY/ASC placement, Fine/global/reconstruction workflows, cancellation/retry/history and persistence with the exact source scopes in the acceptance ledger.
- [x] Complete independent current-build PLY GUI/MCP Fine solves and compare all 21 carriers and diagnostics without supplying GUI results to the MCP solver. Preserve the correctly reported unmet overlap target.
- [x] Render every corner of the actual ASC reconstructed output from front, top and world-isometric views; verify unchanged geometry/history and retain the edge-on world-isometric limitation.
- [x] Independently assess complete output topology, discrete distances and intersection candidates; retain partial-overlap, component/island and native open-boundary findings.
- [x] Review the source diff and resolve blocking defects; retain resource cleanup proofs, restore all temporary fixture attributes and archive stale validation data with complete SHA-256 verification.

## Integration and closure

[PR #11](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/pull/11) is the authoritative integration record and carries exact-head hosted checks. Documentation-only additions must retain a committed-byte bridge to the tested runtime inputs and assets. Use a normal expected-head merge after those checks pass, then verify remote main before closing [issue #3](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/3) and [milestone #4](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/milestone/4). Their live states record final integration and closure; this record does not publish a release.
