# Native Surface Approximation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the numerical core; the primary agent owns shared-flow integration and validation. Steps use checkbox syntax for tracking.

**Goal:** Make the recovered, fixture-verified surface approximation arithmetic usable through the existing Fit Surface GUI and MCP operation.

**Architecture:** Add a method to the existing surface fitting options and dispatch it through the existing worker. Preserve the projected-grid method while adding an approximation method that solves all three coordinates with the recovered basis, derivative penalties and normalized LU. Both interfaces retain the existing selected-visible extraction, cancellation, stale-source checks, preview and one accepted history transaction.

**Tech Stack:** TypeScript, React, browser Worker, existing shared application operations, Vitest and browser smoke tests.

**Spec:** The active native reconstruction goal, the existing Fit Surface flow, and the retained `mvp-surface-native-core-verification-20261017.md` evidence outside the repository. Exact core comparison currently covers 2,998 fields of the captured fixtures; it does not establish native default Method0 or the complete iterative fitting controller.

## Global Constraints

- Keep the latest application on loopback port 5173.
- No push, deployment, publication, new dependencies or unrelated dirty-file changes.
- Preserve existing options and projected-grid defaults for existing callers.
- Shared GUI/MCP capability, explicit method/options schema and agent documentation are mandatory.
- Retain original floating-point operation order and native golden fixture provenance.
- Native core uses U-outer/V-inner ordering; the saved patch uses V-outer/U-inner ordering. Transpose at the adapter boundary.
- Respect existing resource admission; serialize builds, suites, browsers and native analysis.
- No claim of full native fitting-controller parity from preset-UV arithmetic checks.

## Review Focus

- Repeated/interior knots and endpoint derivative behavior must not silently lose native arithmetic fidelity.
- Unsupported or underconstrained inputs must fail before returning a patch.
- Large sample/control combinations need bounded memory and work before matrix allocation.
- XYZ reconstruction and transposed control nets must agree across all projection choices.
- Preview, source changes, cancellation, acceptance and MCP retries must retain existing semantics.

## One coherent implementation slice

- [ ] Port the verified numerical core and exact quadrature constants into new fitting-owned modules; add native golden tests and malformed/resource-limit coverage.
- [ ] Extend `SurfaceFitOptions` with an explicit fitting method and approximation smoothing weight. Dispatch from the existing shared fitter without changing existing projected-grid callers.
- [ ] Adapt deterministic sampled XYZ and projected UV to the native core; convert native controls into the existing patch representation and compute clearly identified sample residuals.
- [ ] Add method and smoothing controls to `FitSurfaceDialog`; retain its existing preview/accept/cancel path.
- [ ] Extend `surface_fit` discovery schema and agent documentation; cover shared-worker, GUI and MCP method forwarding.
- [ ] Build first under admission, then run native-core and affected fitting tests, the relevant application suite, static checks and GUI/MCP browser verification on the exact source snapshot.
- [ ] Commit only this coherent validated slice; preserve other tasks' dirty work and do not push.

## Required follow-up within the unchanged full goal

The original iterative UV correction, complete native fitting-entry/controller behavior, default Method0, automatic orientation/tolerance and broader native fitting fixtures remain required work. This slice does not redefine the full goal around a single coefficient solve.
