# M2 Unroll auxiliary ownership implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, task by task. Complete M2 before moving to another milestone.

**Goal:** Publish Unroll's mesh, saved sketch and hidden cylindrical roll frame through one GUI/MCP transaction, with complete history and persistence.

**Architecture:** Keep `runUnrollCommand` on the existing revision-checked `mesh_process` operation. Retain the observed frame and radius as semantic data. Model revisions carry only the saved-sketch identities owned by that transaction; ordinary sketch edits stay outside model history.

**Tech Stack:** TypeScript, React, existing binary project codec and Vitest/browser integration.

**Spec:** Existing approved M2 verification plan; native Unroll acceptance at `1406906b0`, frame constructor `14041cd20` and data constructor `14041ca30`, retained image SHA-256 `a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`. Static evidence establishes frame plus radius, not a generic coordinate marker. Existing finite exported mesh/sketch cases remain the numerical acceptance basis.

## Global constraints

- Shared GUI/MCP operations, validation, cancellation, request protection and history are mandatory.
- Preserve unrelated sketches and the user's current browser scene.
- No retained native image execution; no native input retry without resolving the existing access failure.
- Local guarded validation remains 4 GiB aggregate / 25 percent CPU, serialized with peers.

## Review focus

- Undo after editing the generated sketch retains its edited value for redo.
- Unrelated sketches edited or added after Unroll survive undo, redo and revision seek.
- Project reopen retains both sides of every auxiliary history transition.
- Repeated Unroll and replacement mode create independent owned identities.
- Cancellation, stale revisions and invalid geometry publish none of the auxiliary objects.

### Task 1: Saved-sketch model history

Files: `src/model-sketch-history.ts`, `src/history.ts`, `src/project-file-codec.ts`, `src/object-operations.ts`, `src/ui/App.tsx`, `tests/model-sketch-history.test.ts`.

- [ ] Write failing tests for owned identity deltas, unrelated edits, seek in both directions, active sketch removal, duplicate rejection and binary history reopen.
- [ ] Add validated `ModelSketchChange` target records and capture/apply helpers. Extend `seekModelRevision` with optional authoring state; invert only crossed deltas using live owned values.
- [ ] Add trusted commit policy for new saved sketches; validate before publication. Route GUI and MCP undo/redo/seek through the same history helper.
- [ ] Preserve deltas in binary project history and backups; reject malformed imported delta identities and sketches.
- [ ] Run focused history/project tests under the existing guard.

### Task 2: Native Unroll auxiliary objects

Files: `src/scan-unroll-reference.ts`, new focused roll-frame model/display helpers, `src/types.ts`, `src/io.ts`, `src/viewport.ts`, `src/automation/operations.ts`, `src/automation/catalog.json`, `docs/AGENT_GUIDE.md`, `docs/MCP_ARCHITECTURE.md`, Unroll contract tests.

- [ ] Pin observed original-frame/radius, circumference sketch and transformed source bounds in failing tests, including oblique axes, offsets and repetitions.
- [ ] Implement semantic hidden roll frame and saved sketch; publish together with the mesh using Task 1's trusted policy. Expose structured identities and data in MCP results/inspection.
- [ ] Cover repeat/replacement, validation rollback, cancellation and request retries through the existing public operation.
- [ ] Verify GUI/public SDK outcomes, undo/redo/seek and portable save/reopen against native captured cases.

### Task 3: M2 acceptance

- [ ] Record exact scoped evidence and retain failed receipts.
- [ ] Run affected tests, build, formatting and current-head CI; perform the remaining M2 acceptance gates from the parent verification plan.
- [ ] Obtain fresh whole-branch review before merging; close M2 only after all gates pass and the PR is merged.


Checkpoint: shared owned-sketch deltas, binary persistence, auxiliary objects and
independent saved-sketch visibility are implemented. Build and GUI/public-MCP
acceptance pass in [the evidence record](../../evidence/m2-unroll-ownership-20261026.json).
The retained tangent frame converts to the cylinder by cycling its basis to
(N,U,V) and moving the origin by -radius*N; the recovered rotations are each
minus 90 degrees. The generic coordinate-frame model/display foundation is reused
from M4 commit `04c7026`, with separate roll mapping data. Manifest 6 and JSON wire
4 prevent older readers from dropping owned history, mapping or saved visibility.
Main integration, remaining M2 acceptance and final review/CI/merge remain open.
