# M2 scan repair and processing acceptance plan

> Use `superpowers:executing-plans` to execute this plan inline, one acceptance slice at a time.

**Goal:** Complete issue #2 before starting M3; another task owns M1.

**Architecture:** Preserve the shared GUI/MCP processing operations and their existing worker ownership, history and cancellation semantics. Separate retained native numerical fixtures, current application tests and rendered integration evidence; none substitutes for the other.

**Tech stack:** TypeScript, Vitest, Three.js, processing workers, Playwright and the public MCP bridge.

**Spec:** [M2 acceptance criteria](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/2).

## Constraints

- Work in the managed M2 worktree on `codex/m2-repair-processing`, based on merged M1. Preserve the dirty primary checkout and read-only validation checkout.
- Preserve M1 changes and the existing user dev server.
- Run heavy checks serially under the existing aggregate 4 GiB / 25% CPU policy and finite leases. Build heap is 3072 MiB; test heap is 1024 MiB.
- Retained native images remain static analysis data: no executable replay or instrumentation. The user subsequently authorized operating the installed native GUI to import the manufactured fixtures and export comparison results.
- Do not close M2 from synthetic tests alone. M1 remains a dependency, independently owned.
- Application changes must reach the shared GUI/MCP operation and include contract/behavior validation and agent documentation where required by AGENTS.md.

## Review focus

- Unchanged geometry must reuse topology; edited geometry must invalidate the correct caches without detaching canonical buffers.
- Partial selections and multiple components must preserve unrelated surfaces and the documented seam policy.
- Cancellation/failure must preserve canonical geometry and history, and release owned workers and temporary resources.
- Every advertised algorithm needs equivalent native input, selection and settings; coordinate-only checks do not establish native dialog/history parity.
- Distinguish the existing voxel reconstruction from the integrated Average/Unroll corrections. The observed fixtures establish only their stated settings, frame and tolerance coverage.

## Task 1: Pin current M2 baseline and inventory

- [x] Read issue #2 and existing repair/processing evidence.
- [x] Build current application first and retain complete source identities before/after.
- [x] Run focused repair, hole, boundary, topology, smoothing, reduction, noise and transform tests; retain exact selected files/counts and resource cleanup.
- [x] Record per-mode GUI route, shared operation, MCP schema, retained fixtures and remaining native/integration gaps in `docs/M2_ACCEPTANCE.md`.

## Task 2: Close individual processing gaps

Checkpoint: Defeature and million-facet noise GUI/public-MCP replays pass on the pinned build, including Defeature cancellation/failure rollback and save/reopen. [The evidence ledger](../../M2_ACCEPTANCE.md) records the complete 2,317-test focused batch. Native GUI/export evidence now binds the Unroll +Z orientation, positive offset, swap-last seam removal and repetition behavior, plus Average largest-facet base/new-owner behavior and the 10 mm default on a manufactured three-plane input. Both corrections use shared GUI/MCP operations; difficult native frames/query cases and unrelated inventory rows remain open.

- [ ] Prioritize the first uncovered mode in the inventory; recover missing behavior from retained static/native evidence before changing its algorithm.
- [ ] Reproduce each defect with a failing regression, then fix its shared implementation. Preserve revision, retry, lock, resource, cancellation and history checks.
- [ ] Build affected code; run focused and affected suites; compare real GUI/public-MCP outcomes with identical inputs/settings, including persistence and undo.
- [ ] Record exact identity, commands, outputs, tolerances and cleanup for each completed slice.

## Task 3: Milestone acceptance

- [ ] Complete all advertised modes and the reported defeature reproduction, topology reuse/invalidation, worker determinism and rollback acceptance.
- [ ] Confirm M1 dependency acceptance from its owning task's evidence.
- [ ] Review the complete candidate and update issue #2; close its milestone only when every acceptance gate passes.

No milestone closure or complete-domain parity is claimed by this plan.

## 2026-10-25 Unroll/Average checkpoint

- [x] Retain original-to-export numeric fixtures for vertical Unroll at 0/90 degrees and one/two instances, plus a nonorigin oblique cylinder.
- [x] Retain same-input native Average three-plane and open-rim rejection exports; verify the 10 mm default.
- [x] Integrate the shared worker, public MCP schema and GUI command adapters, preserving explicit replacement and all job guards.
- [x] Reproduce and fix fresh-owner construction-key collisions and semantic-reference validation regressions.
- [x] Build an immutable candidate, pass 155 focused tests and both browser lifecycles with exact GUI/MCP output equality, and retain source/build/output/resource identities.
- [x] Record the 49,018-pass full-suite checkpoint and its 64 fixture-gated skips separately from subsequent focused validation.
- [ ] Complete the remaining inventory/native acceptance gates. The owner no longer remembers a project/mask path for the reported 18,425-facet defeature failure; its exact reproduction is unavailable.

M1 issue #1 is now closed with its own acceptance/integration record. M2 closure remains pending, and no later milestone is advanced here.
