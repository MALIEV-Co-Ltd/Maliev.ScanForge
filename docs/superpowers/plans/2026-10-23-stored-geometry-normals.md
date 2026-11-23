# Stored mesh geometry normals implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve native computed mesh normals across rendering, alignment and project restoration while retaining scanner-authored normals and GUI/MCP parity.

**Architecture:** Add optional `IndexedMesh.geometryNormals` as immutable computed geometry state in original vertex order. Generate absent values with the verified native angle-weighted producer; rigid edits transform stored vectors instead of regenerating them from rounded coordinates. Disposable rendering data borrows this state, while source scanner normals retain their current contract.

**Tech Stack:** TypeScript, Float32 typed arrays, existing worker transport and binary project codec, Vitest, current application MCP operations.

**Spec:** [Native original PLY staging and renderer evidence](../../NATIVE_GLOBAL_ORIGINAL_PLY_STAGING.md), [agent guide](../../AGENT_GUIDE.md), repository AGENTS.md, and the user's complete native-parity goal.

## Global constraints

- Preserve original positions, topology, scanner normals, cancellation, resource admission, revision checks, retry protection and history.
- Keep the validation Job limit at 4 GiB; run heavy verification serially.
- Do not put the reference product name or private local paths in repository artifacts.
- Preserve existing binary formats and old projects without the optional field.
- Existing GUI and MCP operations must share the changed implementation.
- Rendered GUI/MCP acceptance is required before presenting the change as complete or committing it. The previously denied browser route is not bypassed.
- Continue in the existing user-requested main checkout with its uncommitted candidate; preserve unrelated changes.

## Review focus

- Older projects and meshes without scanner normals must initialize computed normals without losing topology.
- Malformed computed fields must fail validation before a project or preview is published.
- Two Float32 transform stages must preserve stored normal values exactly, including unused vertices.
- Save/reopen, undo/redo and backup must retain computed fields without detaching source buffers.
- Geometry edits must replace or invalidate stale computed fields; metadata-only edits retain them.

## GUI and MCP coverage

Affected GUI behavior: scan import shading, alignment preview/apply/cancel, transform, open/save/backup and history.
Shared operations: import worker/parser publication, indexed mesh helpers, datum staging, processing worker, global input preparation, project codec/restore.
Existing MCP coverage: `project_import`, `project_export`, `backup_restore`, `mesh_transform`, alignment operations, `object_get(includeGeometry:true)`, `object_geometry_digest`.
The optional geometry field is returned in the existing geometry artifact and hash response; no separate rendering control tool is needed.
Update AGENT_GUIDE.md and MCP_ARCHITECTURE.md with actual supported behavior and verification limits.

### Task 1: Persistent field and agent inspection

Files: `src/types.ts`, `src/indexed-mesh.ts`, `src/io.ts`, `src/project-file-codec.ts`, `src/geometry-digest.ts`, `src/automation/operations.ts`; test `tests/mesh-geometry-normals.test.ts`.

Interface: `IndexedMesh.geometryNormals?: Positions`; present fields have exactly three finite components per original vertex. Preserve them separately from `normals`.

- [x] Write red tests for malformed fields, JSON/streamed/binary round trips, revision payloads, MCP geometry artifact and digest coverage, and absent-field compatibility.
- [x] Run the focused tests and inspect expected failures.
- [x] Implement validation and all serialization/inspection paths using existing bounded storage and hashing.
- [x] Run the new tests plus indexed-mesh, project and geometry-digest contract suites.
- [x] Record results in the plan ledger. Do not commit this incomplete end-to-end candidate.

### Task 2: Native generation, import and restored display

Files: `src/scan-render-data.ts`, `src/scan-native-noise.ts`, `src/import-worker.ts`, `src/import-client.ts`, `src/restored-scan-display.ts`, `src/scan-render-preparation.ts`, `src/project-decoding-client.ts`, and corresponding worker/restore/display tests.

Interface: a shared helper returns stored Float32 computed normals or derives them from validated original indexed geometry. Publication creates a new mesh descriptor; it does not mutate previously published entities.

- [x] Add unequal-area/asymmetric facet tests that distinguish native angle weighting from area weighting and scanner vectors.
- [x] Add real import-worker and restore tests, including transfer deduplication and older projects.
- [x] Observe red results, implement native preparation and cache reuse, then run focused suites.
- [x] Preserve indexed display topology across restore and worker transport without duplicating published carriers.

### Task 3: Transform and processing lifetime

Files: `src/indexed-mesh.ts`, `src/datum-alignment.ts`, `src/datum-staged-scan.ts`, `src/processing-client.ts`, `src/processing-worker.ts`, `src/native-landmark-refinement.ts`, `src/native-surface-refinement.ts`, `src/automation/interactive-alignment-operations.ts`.

- [x] Add exact two-stage Float32 normal checks, immutable undo inputs, identity/translation/rotation cases and malformed/cancelled staging checks.
- [x] Rotate computed normals alongside indexed coordinates through each existing rigid operation.
- [x] Include computed fields in transfer/copy ownership rules and invalidate them with topology-changing edits.
- [x] Test shared GUI/MCP operation outcomes and history/retry/cancellation contracts.

### Task 4: Alignment input and resources

Files: `src/global-alignment-input-core.ts`, `src/global-alignment-input.ts`, `src/global-alignment-input-worker.ts`, `src/scan-global-registration.ts`, associated input/controller/operation tests.

- [x] Add tests that repeated alignment uses stored computed normals while explicit authored scanner data stays intact.
- [x] Carry canonical computed normals through the preparation worker and account for retained/cloned buffers within existing limits.
- [x] Run the original three-file numerical and staging comparisons with fresh source pins; compare all native computed normal bytes as well as positions.
- [x] Record actual memory, cleanup and numerical results under the unchanged 4 GiB cap.

### Task 5: Integration and acceptance

- [x] Update agent/architecture documentation and any affected discovery descriptions without advertising unsupported behavior.
- [x] Run build, full tests, CAD smoke, scoped formatting and diff checks once implementation is coherent. Full run: 47,774 passed, 64 skipped; four concurrent-edit failures passed in the subsequent 65-test focused run. Build, CAD, formatting and diff checks passed.
- [x] Rebuild/keep port 5173 current with verified process ownership.
- [ ] Complete real GUI/MCP import, preview, apply/cancel, history and save/reopen comparisons when browser access is authorized.
- [ ] Review the complete diff against the evidence and mandatory MCP parity. Commit only after all required gates pass; do not push.
