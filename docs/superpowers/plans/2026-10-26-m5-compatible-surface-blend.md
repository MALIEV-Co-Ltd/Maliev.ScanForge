# Compatible Surface Blend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. No heavy/native job without the coordinator's explicit lane grant.

**Goal:** Create an editable exact transition patch between compatible NURBS boundaries through identical GUI/MCP behavior.

**Architecture:** A pure bridge helper constructs bounded homogeneous C0/C1 control strips. The existing surface operation calls the shared CAD creation transaction. The editor submits that same asynchronous operation and owns cancellation.

**Tech Stack:** Existing TypeScript/React, rational NURBS helpers, OpenCascade worker, shared application/MCP API; no dependency changes.

**Spec:** `docs/superpowers/specs/2026-10-26-m5-compatible-surface-blend.md`.

## Global constraints

- Preserve GUI/MCP parity, saved exact geometry and source buffers.
- Existing controls2–16/degree1–5, kernel90s lease and4GiB resource guard remain.
- Only explicitly reserved numerical/test/build/browser/native work may run.
- New blend is materialized, independently editable, without persistent seams or G2 claims.

## Review focus

- Rational/non-unit knot derivatives and reversed seam orientation.
- Nonpositive homogeneous weights and degenerate geometric output.
- Cancellation after native result creation but before publication.
- Both source objects and history/undo-owned native handles remain unchanged.
- Changing selection or closing the panel never publishes a stale result.

## Task 1: Pure compatible bridge

**Files:** `src/surfaces.ts`, `tests/surface-blend.test.ts`.
**Produces:** `blendPatchBoundaries(reference:NurbsPatch,target:NurbsPatch,options:PatchJoinOptions):NurbsPatch`.

- [x] Write position/derivative/weight/immutability/error tests first; stop source preparation until an explicit lane permits observing RED.
- [x] Observe RED, then implement linear C0 or cubic C1 transverse homogeneous strips using existing boundary descriptors and compatible normalized along-knots.
- [x] Observe GREEN and review every edge/reversal/non-unit/rational case.

## Task 2: Shared creation and MCP contract

**Files:** `src/automation/operations.ts`, `src/automation/authoring-operations.ts`, `src/automation/catalog.json`, `tests/surface-blend-api.test.ts`, agent/architecture docs.
**Consumes:** pure helper above.
**Produces:** `createCadCreateOperation(host):Handler`, reused by ordinary cad_create and operation:blend.

- [x] Prepare RED contract tests for exactly-one reference, new exact entity, immutable sources, one retry/history step, locks, cancellation/failure/late cleanup.
- [x] Extract the ordinary CAD-create handler without altering semantics, then use it directly with the same job context (no nested API job).
- [x] Add operation:blend discovery/schema/docs with all parameters and materialized-output semantics; no unsupported general-blend advertisement.
- [x] Observe GREEN and static review; preserve ordinary CAD creation tests.

## Task 3: GUI, exact kernel and public-MCP acceptance

**Files:** `src/ui/SurfaceTools.tsx`, `src/ui/App.tsx`, relevant component fixtures, `tests/helpers/surface-blend-browser.mjs`, `tests/surface-fit-browser.mjs`, CAD smoke, evidence/ledger.

- [x] Add an owned async onBlend callback/button reusing reference/options and existing edit/cancel lifecycle. Keep the target selected until settlement.
- [x] Verify actual exact face validity and rational boundary geometry in the kernel.
- [x] Build before browser replay; compare GUI and public-MCP new output geometry, history, source preservation, cancellation/errors and project/STEP persistence.
- [x] Review the complete change, run focused/affected/full checks through reserved local work or exact-head hosted CI, and commit only the coherent parity-complete feature.
- [x] Keep real scan/native seam/normal/solid and complete sketch-chain gates open until their actual evidence passes.
