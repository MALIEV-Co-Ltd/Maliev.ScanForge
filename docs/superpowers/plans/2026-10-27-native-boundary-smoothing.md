# Native Boundary Smoothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct M2 boundary smoothing against observed native geometry through the shared GUI/MCP operation.

**Architecture:** Reuse the existing native-style vertex kernels and add only the missing bounded curve-fitting stage. Keep mutation and publication in the shared scan-edit pipeline; keep CAD ownership request-scoped when exact kernel evaluation is required.

**Tech Stack:** TypeScript, Vitest, existing pinned OpenCascade WASM, React and shared MCP executor.

**Spec:** `docs/superpowers/specs/2026-10-27-native-boundary-smoothing.md`

## Global Constraints

- Computational validation retains the 4 GiB job limit and 25 percent CPU limit.
- Keep the pinned open-source CAD kernel; never execute a retained proprietary analysis image.
- Preserve source data, resource admission, protected-object checks, cancellation, request retry behavior, revision checks, atomic publication and history/save/reopen.
- Keep M2 open until its remaining acceptance gates pass and merge is verified.

## Review Focus

- Open or anchored boundaries must not acquire closed-curve constraints.
- Zero strength and repeated operations must use verified native units and defaults.
- Nonmanifold, degenerate and oversized inputs must reject without partial publication.
- Cancellation and failed fitting must release owned workers and leave source/history intact.
- Whole-loop ordering and selected-boundary dispatch must agree with native observations.

### Task 1: Bind the native operation and retain the regression

**Files:** `tests/scan-boundary-native-smooth.test.ts`, `tests/fixtures/boundary-smooth-observed-annulus.json`, `docs/evidence/native-boundary-smoothing-20261027.json`.

- [x] Capture the original native input/output and observe command/settings/counts.
- [x] Run the exact output-digest comparison and confirm the current implementation fails after source/count assertions pass.
- [ ] Verify slider units, loop heads, whole-loop projection indexing and selected dispatch against bounded static evidence and independent native controls.
- [ ] Publish sanitized identity-bound findings and preserve failed receipts; remove temporary diagnostic code from the regression test.

### Task 2: Implement the bounded fitted boundary operation

**Files:** `src/scan-edit.ts`, `src/scan-smoothing-kernel.ts`, `src/scan-native-noise.ts`, `src/scan-boundary-fit.ts`, `tests/scan-boundary-fit.test.ts`.

**Interfaces:** `fitBoundaryCurve(points: Float64Array, closed: boolean, tolerance: number, options?: MeshProcessingOptions): BoundaryCurveFit` returns cubic poles, expanded knots, parameters, maximum error, refinement count and tolerance status. `evaluateBoundaryCurve(curve: BoundaryCurveFit, parameter: number, derivative?: 0 | 1 | 2): Vec3` supplies geometry and Newton derivatives. Reuse `nativeFactor` plus `nativeSubstitute` with pivot tolerance `1e-20`; `nativeSolve` adds column scaling that this native path does not perform. Keep fitting independent of unresolved projection/admission bindings until the full operation is ready.

- [ ] Write failing independent cubic-fit, open/closed/anchor, ordering and cancellation cases using the verified interfaces from Task 1.
- [ ] Implement the verified constrained fit and parameter-refinement arithmetic, reusing the existing kernels and request-owned CAD transport where required.
- [ ] Pass the captured native regression and independent controls without runtime fixture data, changed evidence or relaxed acceptance.
- [ ] Check degenerate/nonmanifold/oversized input rejection and owned-resource cleanup.

### Task 3: Verify shared publication and integrate

**Files:** `src/ui/ScanTopologyPanels.tsx`, `src/automation/catalog.json`, shared executor/adapter only as required, `docs/AGENT_GUIDE.md`, affected contract/browser tests.

- [ ] Update shared parameters/defaults and GUI/MCP discovery together when Task 1 establishes a contract change.
- [ ] Verify same-input GUI/public-MCP geometry, lock/revision/cancel/retry behavior, Undo/Redo and save/reopen with the latest build.
- [ ] Run focused tests, TypeScript/build/CAD checks and formatting under the existing guard; retain exact receipts.
- [ ] Obtain fresh whole-change review, commit/push passing changes, update the live checkout to the exact SHA, and verify CI.
- [ ] Continue remaining M2 acceptance gates before requesting the authorized main merge; verify main, milestone and issue status afterward.
