# Spatial Boundary Sketch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish native-fitted spatial boundary curves as a persistent, visible, agent-accessible 3D sketch.

**Architecture:** A discriminated saved-sketch representation keeps planar and spatial content distinct. One sketch owns ordered cubic curves. The shared scan worker fits selected native boundary walks; one shared publication path commits the sketch and owned history for GUI and MCP. Rendering samples, never mutates, the authoritative curves. Project decoding validates and preserves the new variant and rejects unsupported versions.

**Tech Stack:** TypeScript, React, Three.js, Vitest, existing worker and project codecs.

**Spec:** docs/superpowers/specs/2026-10-27-spatial-boundary-sketch-design.md

## Global Constraints

- Both GUI and public MCP use one operation and expose matching state, errors and history.
- Keep the existing 4 GiB bounded validation policy and all unrelated project/session state.
- Preserve native finite-control scope; do not advertise spatial editing before it exists.

## Review Focus

- Malformed poles, knots, nonfinite values and too-large sketches reject before publication.
- Open, degenerate, missing, duplicate or out-of-range boundary references never publish partial sketches.
- Undo, redo, seek and binary reopen preserve other sketches and active drafts.
- A spatial sketch must not be passed into planar editing or silently flattened.
- Cancellation, lock/revision conflicts and readback failures leave source geometry and history unchanged.

### Task 1: Native fitted curve extraction

**Files:** create `src/scan-boundary-spatial.ts` and `tests/scan-boundary-spatial.test.ts`; modify `src/scan-edit.ts` and worker request/response definitions.

- [x] Write tests for native selected/all annulus poles and knots, preserved ordering, rejection and cancellation.
- [x] Run tests red under the bounded validation Job.
- [x] Implement bounded native-order boundary fitting and structured diagnostics without publishing a GUI-only feature.
- [x] Run focused tests and review finite control scope.

### Task 2: Saved representation and owned lifecycle

**Files:** `src/types.ts`, `src/model-sketch-history.ts`, `src/history.ts`, `src/io.ts`, `src/project-file-codec.ts`, `src/saved-sketch-display.ts`, associated project/history tests.

- [x] Add tests for explicit spatial data validation, sampling, owned history, incompatible versions and full project reopen.
- [x] Implement the discriminated representation and versioned codec; keep planar editing restricted to planar variants.
- [x] Verify atomic failure, noninterference and bounded rendering.

### Task 3: Shared publication and both interfaces

**Files:** `src/automation/operations.ts`, `src/automation/catalog.json`, `src/automation/authoring-operations.ts`, `src/ui/ScanTopologyPanels.tsx`, `src/ui/App.tsx`, `docs/AGENT_GUIDE.md`, relevant worker and browser tests.

- [x] Write behavior/contract tests for selected/all creation, discovery, inspection, visibility, history and rejections.
- [x] Connect GUI and public MCP to the shared worker and transaction; keep source locked/revision checks.
- [ ] Validate against native controls and compare GUI/MCP results, persistence and history. Preserve exact scope and any missing desktop validation.
- [ ] Run focused and required build/CI checks, request independent review, and commit only after parity is complete.
