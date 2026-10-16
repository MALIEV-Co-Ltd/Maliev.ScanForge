# ShrinkWrap Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent tasks below. Steps use checkbox syntax for tracking.

**Goal:** Add a high-fidelity ShrinkWrap operation with independent sampling, gap, smoothing, thickness and local scope controls through GUI and MCP.

**Architecture:** A shared geometry operation handles reconstruction and source constraints. Application adapters resolve mesh references and selection masks; local processing keeps a fixed seam and preserves the rest of the parent. Existing Re-polygonize remains unchanged.

**Tech Stack:** TypeScript, Three.js, existing worker, React, Vitest, Playwright and MCP.

**Spec:** ../specs/2026-10-16-shrinkwrap-design.md (approved by owner, including proceeding with plan and implementation).

## Global Constraints

- No silent coarsening; bounded memory/work admission and cancellation.
- Sample interval is sampling spacing, not a maximum-deviation guarantee.
- Thickness is additional outward offset; local offset tapers at the fixed seam.
- Local selection must not change unselected geometry or claim unrelated holes closed.
- Preserve unrelated dirty work. Commit only after integrated build and tests.
- Resource-intensive validation runs serially under the unchanged admission guard.

## Shared interfaces

`ShrinkwrapOptions` in `src/scan-shrinkwrap.ts`: optional sampleInterval (default 0.5), gapFill (default 0), organicShape (default false), extraThickness (default 0), maxDeviation (default 0.1), scope (whole|selected|isolated, default whole), selection (Uint8Array resolved by adapters), targets (Positions[] for whole scope), plus MeshProcessingOptions signal/onProgress. Export `shrinkwrapScanMesh(positions:Positions, options?:ShrinkwrapOptions):ScanToolResult`.

`shrinkwrapLocalMesh(positions:Positions, options:ShrinkwrapOptions):ScanToolResult` in `src/scan-shrinkwrap-local.ts`. Selected and isolated scope use the explicit resolved mask. Whole-scope multi-mesh references follow reconstructionTargets rules. No arbitrary internal arrays in public MCP requests.

## Review Focus

- Close parallel sheets and opposite-side projection must not fuse unintentionally beyond configured gap scale.
- Fixed local seams and hidden triangles must remain unchanged.
- Zero added thickness must not make two sides collapse to duplicate faces.
- Invalid/empty masks and resource/deviation failures must preserve source and history.
- Generated missing regions must be distinguished from supported captured surfaces in diagnostics.

## Task 1: Whole-mesh reconstruction kernel

Files: create src/scan-shrinkwrap.ts and focused helper modules/tests. Avoid edits to existing Re-polygonize kernel unless an optional extraction hook can preserve old behavior exactly.

- [x] Write and run failing tests for independent controls, fine planar/curved fidelity, sharp features, thin walls, gap behavior, invalid settings and cancellation.
- [x] Implement continuous surface extraction/source fitting rather than final binary midpoint geometry. Use bounded storage, normals and feature constraints; generated-region fairing for organic mode. Report actual settings, topology and measured source-fit diagnostics; fail unachievable fit rather than relax it.
- [x] Run focused tests and prototype acceptance before integration; report exact numerical limits and measurement method.

## Task 2: Local wrapping and fixed-seam repair

Files: create src/scan-shrinkwrap-local.ts and tests/scan-shrinkwrap-local.test.ts. Own no GUI files.

- [x] Write and observe failing tests for empty masks, unchanged outside geometry, fixed seam, selected-hole repair, hidden scope and offset taper.
- [x] Implement local reconstruction/repair with selected patch topology and source constraints, exact seam and bitwise outside preservation. Sample interval controls generated density; gap scale controls attempted repair; organic mode affects generated continuation. Report local versus whole closure honestly.
- [x] Run focused tests including disconnected selection and source-preserving errors.

## Task 3: GUI and MCP integration

Files: scan-tools.ts, processing-worker.ts, scan-preview.ts, ui/ScanToolsPanel.tsx, ui/scan-tool-request.ts, ui/App.tsx, ribbon registry, automation/catalog.json, automation/operations.ts and relevant focused tests. Preserve concurrent edits using minimal hunks.

- [x] Write failing discovery, operation, selection/isolation binding, panel and preview/history tests.
- [x] Add scanTools/shrinkwrap through the shared kernel. Resolve selected/isolated masks identically; reject conflicting scope/targets. Expose all parameters and usable defaults/errors.
- [x] Provide preview/accept/cancel/create-new and source comparison without introducing a second implementation; keep undo/redo, revision/lock/retry semantics.
- [x] Run focused tests; report touched files/hunks and unrun integration dependencies.

## Task 4: Integration, actual STL validation and delivery

Files: new browser validation, docs/AGENT_GUIDE.md scoped paragraph, docs/MCP_ARCHITECTURE.md, new docs/SHRINKWRAP.md, plan/spec status.

- [x] Review each task for spec compliance and correctness, fix findings with regression coverage.
- [x] Production build, focused tests, affected full suite, formatting and whitespace checks.
- [x] Browser GUI/MCP parity for whole and local modes, preview/source preservation, accept/cancel/create-new, errors and history.
- [x] Read-only 0.5 mm full-STL and selected-region validation on Z:/scanforge (2).stl; independent topology and two-way sampled fidelity against input and earlier voxel output, plus visual comparison. Record skipped guarantees explicitly.
- [x] Fresh whole-change review, scoped staging, validated commit, owned-process cleanup and concise completion report. No push.

Execution ruling: the owner explicitly approved proceeding with plan and implementation, so no additional approval checkpoint is required. Independent implementers may work on disjoint files; heavy validation is serialized by the primary agent. Keep the existing checkout to preserve the ongoing application's dirty dependencies; stage only intentional hunks.
