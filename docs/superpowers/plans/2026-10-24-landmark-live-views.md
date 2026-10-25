# Live N-point Alignment Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Three alignment views with unlimited ordered pairs and automatic previews from three pairs.

**Architecture:** Reuse Viewport for isolated original-pose picking. Share editable landmark state and preview scheduling between GUI and MCP; cancel superseded work. Extend existing viewport tools with a view selector.

**Tech Stack:** React, TypeScript, Three.js, existing native processing workers, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-24-landmark-live-views-design.md

## Global Constraints

- Mandatory GUI/MCP parity; retain resource, revision, retry, lock and history protections.
- No new dependencies; preserve unrelated working-tree edits.

## Review Focus

- Incomplete pairs must invalidate acceptance.
- Superseded worker results must never publish.
- Original-pose points must remain stable across previews.
- Cancel and unmount must release extra renderers and active workers.
- Reference selection and viewport routing must not expose other objects in isolated views.

## Task 1: Editable shared session

Files: src/landmark-alignment.ts, tests/landmark-preview-controls.test.ts, tests/landmark-alignment.test.ts.

- [x] Add failing tests for post-preview picks/removal, arbitrary pair counts and original-pose markers.
- [x] Run targeted Vitest tests; observe failures, then implement edit invalidation and state metadata.
- [x] Re-run tests and update obsolete preview-lock assertions.

## Task 2: Views and live preview

Files: src/ui/LandmarkPickingViews.tsx, src/ui/LandmarkAlignmentDialog.tsx, src/ui/App.tsx, src/ui/styles.css.

- [x] Verify live instructions and continued editing through browser assertions.
- [x] Implement two isolated Viewport instances, fit/navigation and disposal.
- [x] Route every GUI/MCP edit through editLandmarkSession; abort stale work and schedule complete-pair previews without blocking picking. Publish pending/ready/error status; reject stale acceptance.

## Task 3: MCP and verification

Files: src/automation/api.ts, src/automation/workflow-operations.ts, src/automation/catalog.json, docs/AGENT_GUIDE.md, docs/MCP_ARCHITECTURE.md, tests/landmark-canvas-browser.mjs.

- [x] Extend viewport get/control/pick with optional main/moving/fixed view selection; test forwarding and unavailable views.
- [x] Update discovery and documentation for editable live sessions and structured status.
- [x] Run typecheck, focused session/API/UI tests and production build.
- [x] Exercise real three-view picking, 3-to-4 pair preview updates, GUI/MCP equality, cancellation and acceptance in browser; inspect screenshot.
- [x] Review diff and record actual validation results. Leave unrelated existing changes intact.

Execution authorized by owner: "approve, verify and finish it". Continue inline without another approval round.

## Execution record

- Shared editable state, original-pose isolated renderers, automatic preview and MCP view routing implemented.
- Regression tests were observed failing before changing preview locks, view routing, reference filtering/markers and pending Reset controls; all now pass.
- `npm run build`: passed including TypeScript, Vite and offline manifest.
- Focused Vitest run: 24 files, 256 tests passed.
- Real stdio MCP/browser run: meshes and point clouds, three-to-four automatic pairs, original-pose GUI/MCP ray equality, explicit preview equality, acceptance/undo, pending worker cancellation and renderer cleanup passed.
- Independent read-only review: no actionable findings. Full repository suite and million-point performance benchmarks were not run.
- Existing unrelated working-tree changes retained; no commit or push performed.

Final recheck: full TypeScript check passed after the concurrent project-decoding change settled. Application-only TypeScript, final Vite bundle, offline manifest and final mesh/cloud browser run passed. Light and dark screenshots inspected; evidence is in docs/evidence/landmark-live-views-20261024.json.

## Follow-up: adjustable divider and caption overlap

Requested directly by owner after screenshot review. Add a draggable, keyboard
accessible divider with configured picking-column width 20-50 percent, default
32, and responsive 220/360 px picking/result minima. Use shared landmark_edit
view-layout and landmark_get.layout. Retain points, cameras, previews and history
through resizing, including pending solves; avoid geometry work on each pointer
move. Remove the redundant result caption behind the floating panel while
retaining the accessible result region. Verify shared clamping and retry
contracts, real drag/keyboard/MCP dimensions, pending result publication,
three-to-four-pair alignment and accept/cancel regression.

Follow-up completed: `npm run build` passed; 16 focused Vitest files / 154 tests
passed; real mesh/cloud browser checks passed for divider drag, Home/End and
arrow limits, shared MCP layout, unchanged camera/pick/preview/history state,
and resized pending-result publication. Browser test explicitly holds Worker
onmessage delivery, including retained worker reuse, rather than relying on
network interception timing. Light/dark screenshots inspected; no caption behind
the panel. Read-only follow-up review found no actionable issues. Full repository
suite and million-point benchmarks were not rerun. Evidence:
docs/evidence/landmark-divider-20261024.json.

## Follow-up: direct picking and view-local deselection

Owner requested removal of pick-side buttons and point lists, top-right Fixed
and bottom-right Moving, plus deselection in each canvas. Implement direct role
routing, numbered marker removal buttons, per-view Undo/Clear, shared remove-point
(entityId + zero-based entity-local pointIndex), and optional entityId scoping
for existing remove-last/clear. Preserve agent access to original point data and
unscoped commands. Verify targeted shared/UI/API tests and real mesh/cloud
click/undo/marker removal/clear with unchanged opposite-side points and history.

Direct-picking follow-up verification: shared/UI/API/guidance tests passed
(24 files, 233 tests). Actual mesh/cloud browser checks passed for fixed-above-
moving layout, no pick-mode controls, view-local Undo/Clear and numbered marker
deselection without click-through, original-pose GUI/MCP ray equality, automatic
preview, divider, pending cancellation and accept/undo regression. Independent
read-only review reported no actionable findings. Full repository suite and
million-point performance benchmark were not rerun.
