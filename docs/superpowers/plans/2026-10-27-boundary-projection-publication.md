# M2 boundary projection publication implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline, one acceptance slice at a time.

**Goal:** Give GUI and public MCP boundary sketch projection the same complete publication/history lifecycle.

**Architecture:** Reuse the projection worker, existing boundary sketch converter and identity-scoped model-sketch commit policy. Keep read-only curve reports as the default and add explicit saved-sketch publication.

**Tech Stack:** TypeScript, React, shared application API, Vitest, public MCP, owned Playwright.

**Spec:** [Boundary projection publication](../specs/2026-10-27-boundary-projection-publication.md).

## Global constraints

- Remain in M2 managed checkout; preserve live5174 scene and primary5173.
- No dependency/kernel change, guard increase, or native acceptance waiver. Heavy jobs serial under existing4GiB/25%CPU mutex policy.
- Owner instruction is to fix M2 autonomously; use the compatibility-preserving explicit publication design above. No new permission gate for an already-authorized parity repair.

## Review focus

- Read-only requests must remain nonmutating; only boundary projection accepts the publication option.
- Projection may create sketches without changing mesh ownership or active authoring state.
- Undo/Redo/Seek changes only the new sketch identities; preserve unrelated/later sketches and edits.
- Cancellation/stale/locked/empty/invalid output must publish no partial result/history.
- Discovery, returned identities, GUI visibility and binary reopening must agree through the real app.

## Task 1: Shared publication and model history

- [x] Reproduce missing public schema/publication and GUI model-history behavior; retain actual REDs.
- [x] Extend `src/scan-boundary-sketch.ts` with one validated publication conversion, used in `src/automation/operations.ts` and `src/ui/App.tsx`.
- [x] Add `createSketches` to the scanEdit catalog; validate/action-bind and strip it before worker execution. Return saved `sketchIds` and curve artifact.
- [x] Permit validated sketch-only model commits using existing identity-scoped history; do not fabricate geometry changes.
- [x] Add focused schema/operation/plane/empty/lock/cancel/history ownership tests and pass them; update agent/API docs.

## Task 2: Rendered lifecycle and integration

- [x] Build immutable candidate, all13TypeScript batches, no warnings, source identities unchanged.
- [x] Verify selected/all projection through GUI/publicMCP, default read-only report, identical sketches/frames/IDs ownership, source isolation, active/unrelated sketches, undo/redo/seek, job cancellation and binary reopening.
- [x] Record exact receipts, output/build/source/driver digests, screenshots and cleanup, retaining failed attempts.
- [x] Commit/push coherent repair, update PR18/issue2, fast-forward clean live preview and preserve scene/history. Native comparisons and full-M2 final review/CI/merge remain separate gates.

Task 2 completion applies to this projection repair only. M2 and PR #18 remain open/draft/unmerged pending native inventory comparisons, remaining processing lifecycles, full-candidate review and final integrated CI.
