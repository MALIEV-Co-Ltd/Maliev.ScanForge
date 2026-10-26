# M2 split and segment publication implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline.

**Goal:** Match GUI/MCP cutter interpretation and complete result ownership/history behavior for M2 split and component extraction.

**Architecture:** One shared split-cutter binder and one shared segment publisher feed existing worker and model commit/selection adapters. Preserve geometry algorithms and own visibility restoration using the existing model commit policy.

**Tech Stack:** TypeScript, React, shared MCP API, Vitest, guarded owned Playwright.

**Spec:** [Split/segment publication parity](../specs/2026-10-27-split-segment-publication.md).

## Global constraints

- Continue authorized M2 autonomously; preserve primary5173 and live5174 scene.
- Heavy jobs serial under unchanged4GiB/25%CPU/finite leases/globalmutex; no native replay or acceptance waiver.
- Existing MCP schemas suffice; update discovery and agent usage for default/state changes.

## Review focus

- Plane fit geometry versus finite ordinary mesh even if it has a fit.
- Empty output, invalid cutter, cancellation/stale/locked source must publish no owners/history.
- Output ordering/classification for empty leading segments must use original part indices.
- Source visibility Undo/Redo must not overwrite unrelated later visibility.
- Independent output metadata/identities and raw source/cutter retention; preserve generic segmentation callers.

## Task 1: Shared cutter binding and segment publication

- [x] Retain actual operation REDs for plane mismatch, source visibility/selection and empty result; correct test harness cleanup assumption without dropping assertions.
- [x] Add shared split-cutter predicate/binder and use it in GUI/MCP.
- [x] Add shared segment publication/visibility ownership; use it in GUI/MCP and select first result.
- [x] Pass focused cutter/geometry/operation/history tests, update discovery/agent/architecture docs.

## Task 2: Rendered lifecycle and milestone ledger

- [ ] Reproduce actual component visibility and split-plane failures through old rendered GUI/publicMCP before application changes.
- [ ] Build immutable candidate; pass13TypeScript batches/zero warnings and retain source identities.
- [ ] Pass plane, finite/open and convex/concave closed cutter GUI/MCP geometry/state/area/cancel/history/binary lifecycle; refresh component visibility/selection/oracle checks.
- [ ] Record failure/success/source/build/driver/output/cleanup receipts, commit/push, update PR18/issue2 and clean live preview. Keep M2 native/final review/CI/merge gates open.
