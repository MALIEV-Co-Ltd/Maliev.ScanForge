# Reference Geometry Numerical Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish shared numerical helpers for the recovered reference-construction paths while preserving existing datum alignment exactly.

**Architecture:** Keep arithmetic in a small pure module. Existing datum alignment delegates its closest-line calculation to that module; later reference-point/line construction uses the same helpers. This is a dependency of the full construction capability, not completion of M4 or a replacement for GUI/MCP construction and native numerical acceptance.

**Tech Stack:** TypeScript, Vitest, existing shared application executor and native datum fixtures.

**Spec:** `docs/NATIVE_REFERENCE_GEOMETRY.md`; private digest-bound function records at `0x140211e90`, `0x1404100b0` and `0x140154070`.

## Global constraints

- Preserve existing working-tree changes and use the current checkout.
- Never add native binaries, pseudocode, manual assets or the reference product's name to the repository.
- Keep the 4 GiB owned Job memory limit, 25% CPU quota, finite lease and existing free-resource guards.
- No new creation tools or enabled ribbon actions until the shared persistent geometry, GUI and MCP implementation is coherent.
- Existing datum alignment GUI and MCP operations must retain the same numerical results, validation, revision/retry/cancellation and history behavior.
- Static comparisons and analytic unit cases are not original-code numerical replay. Keep those evidence scopes distinct.
- No commit or completion claim before required rendered GUI/MCP acceptance.

## Review focus

- Exact threshold equality must preserve strict closest-line rejection and inclusive plane-intersection admission.
- Dominant-axis ties in the plane intersection must preserve X, then Y, then Z ordering.
- Signed zero in returned coordinates must survive the helper boundary.
- Skew lines need two distinct closest points; returning only an intersection loses information.
- Refactoring must preserve all existing native datum fixtures and input immutability.

### Task 1: Shared closest-line calculation

**Files:** create `src/reference-geometry-numerics.ts`; modify `src/scan-native-datum-plane.ts`; create `tests/reference-geometry-numerics.test.ts`.

**Interface:** `nativeReferenceClosestLines(a, u, b, v, tolerance): { first: number[]; second: number[] } | undefined`, taking readonly numeric vectors and an explicit determinant tolerance. Callers retain their existing validation. The existing datum helper delegates with `2 ** -23` and returns `first`.

- [x] Write analytic tests for skew/non-unit directions, parallel rejection, strict determinant equality, adjacent tolerance and unchanged inputs.
- [x] Run the focused tests and observe the missing implementation failure.
- [x] Implement the recovered arithmetic order, returning both points. Refactor the existing datum helper to use it without changing its callers.
- [x] Run the new tests plus the existing native datum direction/plane/point fixtures and shared datum API tests.

### Task 2: Plane intersection and vector normalization

**Interface:** `nativeReferenceNormalize(vector): number[]` copies its input and normalizes only when its length is at least `Number.EPSILON`. `nativeReferencePlaneIntersection(n1, d1, n2, d2, tolerance): { point: number[]; direction: number[] } | undefined` retains the native cross-product, dominant-axis anchor, arithmetic order, inclusive cross-squared threshold and inclusive `2 ** -23` determinant threshold.

- [x] Add failing tests for normalization equality/below-threshold, parallel planes, non-unit normals, cross-squared equality, dominant-axis ties, signed zero and unchanged inputs.
- [x] Implement both helpers from the corroborated instructions and constants. Do not replace the plane anchor with a generic minimum-norm solver.
- [x] Run the focused numerical tests and native datum regressions under the unchanged owned limits.

### Task 3: Evidence and integration boundary

- [x] Export sanitized instruction/constant/import-binding evidence, retaining hashes and cleanup receipts without raw native code.
- [x] Update the reconstruction contract with verified static rules, current runtime code binding and the outstanding numerical/GUI/MCP acceptance.
- [x] Run formatting and `git diff --check`; inspect the exact patch for unintended application/API changes.
- [x] Keep reference-construction publication, semantic entities, persistence, viewport interaction, downstream consumers and public MCP access outstanding. Do not advertise this foundation as that capability.

## Verification commands

Invoke Vitest through a fresh owned validation plan with one worker and `--no-file-parallelism`, selecting the new test and the discovered native datum suites. Keep the runner, report and source identities. Run formatting only for the touched files; preserve concurrent work. The existing datum operations remain the MCP coverage for the refactored path. Reference construction has no public MCP capability yet and remains incomplete.
