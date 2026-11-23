# Adaptive Point Display Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce point-cloud crowding on zoom-out without modifying scan data.

**Architecture:** A small Three.js display controller computes a camera-dependent
sampling fraction from projected bounds and updates a GPU uniform. Shared entity
metadata and `object_update` drive both GUI and MCP; camera inspection exposes diagnostics.

**Tech Stack:** TypeScript, Three.js/WebGL2, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-adaptive-point-display-design.md`

## Global constraints

- Mandatory GUI/MCP parity, no destructive sampling, no new dependencies.
- Preserve source buffers, RGB slots, hidden indices, history and retry/revision checks.
- Auto density true; density 10–100, default 50; size stays 1–10 px.

## Review focus

- Orthographic/perspective zoom and near-plane intersections.
- Hidden indices, object poses and sparse/degenerate clouds.
- Stable samples and unchanged source data under repeated camera changes.
- Save/load and modeling undo preserve display settings.
- GUI/MCP outcomes match and shader compilation errors fail browser verification.

## Tasks

- [x] Add failing adaptive display tests for zoom, density, full mode, poses and near planes.
- [x] Implement `src/adaptive-point-display.ts` and integrate with point materials and camera inspection in `src/viewport.ts`.
- [x] Extend failing API/project tests for `pointAutoDensity` and `pointDensity`; add shared validation, codecs, revision keys and history preservation.
- [x] Add GUI controls through `object_update`; extend discovery and agent documentation.
- [x] Run targeted Vitest tests, production build and browser screenshot/pixel checks comparing auto/full/zoom states and MCP diagnostics.
- [x] Review this change against the spec and record actual validation.

## Execution ledger

Ruling: continue in the existing workspace because this feature depends on the
previous turn's uncommitted display controls; a fresh HEAD checkout would omit them.
Keep all unrelated changes. Do not commit unrelated work.

Validation: 49 targeted tests passed across ten files. Production build (including
TypeScript) passed. `node tests/point-cloud-browser-smoke.mjs` passed with zero
page/shader errors. A 10,000-point cloud at the same camera pose rendered 633 green
pixels in Auto density at 10%, versus 10,826 in full display; zooming in restored
full detail. Chunked geometry readback exactly matched all original source points.
GUI changes were visible through MCP and MCP updates changed the GUI controls.
Fresh independent review found no blocking defects. Validation used synthetic
clouds, not the user's full-size scans. Details are in
`docs/evidence/adaptive-point-display-20261024.json`.
