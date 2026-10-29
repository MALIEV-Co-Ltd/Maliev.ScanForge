# M2 scan repair and processing acceptance plan

> Use `superpowers:executing-plans` to execute this plan inline, one acceptance slice at a time.

**Goal:** Complete issue #2 before starting M3; another task owns M1.

**Architecture:** Preserve the shared GUI/MCP processing operations and their existing worker ownership, history and cancellation semantics. Separate retained native numerical fixtures, current application tests and rendered integration evidence; none substitutes for the other.

**Tech stack:** TypeScript, Vitest, Three.js, processing workers, Playwright and the public MCP bridge.

**Spec:** [M2 acceptance criteria](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/2).

## Constraints

- Work in the managed M2 worktree on `codex/m2-repair-processing`, based on merged M1. Preserve the dirty primary checkout and read-only validation checkout.
- Preserve M1 changes and the existing user dev server.
- Run heavy checks serially under the existing aggregate 4 GiB / 25% CPU policy and finite leases. Build heap is 3072 MiB; test heap is 1024 MiB.
- Retained native images remain static analysis data: no executable replay or instrumentation. The user subsequently authorized operating the installed native GUI to import the manufactured fixtures and export comparison results.
- Do not close M2 from synthetic tests alone. M1 remains a dependency, independently owned.
- Application changes must reach the shared GUI/MCP operation and include contract/behavior validation and agent documentation where required by AGENTS.md.

## Review focus

- Unchanged geometry must reuse topology; edited geometry must invalidate the correct caches without detaching canonical buffers.
- Partial selections and multiple components must preserve unrelated surfaces and the documented seam policy.
- Cancellation/failure must preserve canonical geometry and history, and release owned workers and temporary resources.
- Every advertised algorithm needs equivalent native input, selection and settings; coordinate-only checks do not establish native dialog/history parity.
- Distinguish the existing voxel reconstruction from the integrated Average/Unroll corrections. The observed fixtures establish only their stated settings, frame and tolerance coverage.

## Task 1: Pin current M2 baseline and inventory

- [x] Read issue #2 and existing repair/processing evidence.
- [x] Build current application first and retain complete source identities before/after.
- [x] Run focused repair, hole, boundary, topology, smoothing, reduction, noise and transform tests; retain exact selected files/counts and resource cleanup.
- [x] Record per-mode GUI route, shared operation, MCP schema, retained fixtures and remaining native/integration gaps in `docs/M2_ACCEPTANCE.md`.

## Task 2: Close individual processing gaps

Checkpoint: Defeature and million-facet noise GUI/public-MCP replays pass on the pinned build, including Defeature cancellation/failure rollback and save/reopen. [The evidence ledger](../../M2_ACCEPTANCE.md) records the complete 2,317-test focused batch. Native GUI/export evidence now binds the Unroll +Z orientation, positive offset, swap-last seam removal and repetition behavior, plus Average largest-facet base/new-owner behavior and the 10 mm default on a manufactured three-plane input. Both corrections use shared GUI/MCP operations; difficult native frames/query cases and unrelated inventory rows remain open.

- [ ] Prioritize the first uncovered mode in the inventory; recover missing behavior from retained static/native evidence before changing its algorithm.
- [ ] Reproduce each defect with a failing regression, then fix its shared implementation. Preserve revision, retry, lock, resource, cancellation and history checks.
- [ ] Build affected code; run focused and affected suites; compare real GUI/public-MCP outcomes with identical inputs/settings, including persistence and undo.
- [ ] Record exact identity, commands, outputs, tolerances and cleanup for each completed slice.

## Task 3: Milestone acceptance

- [ ] Complete all advertised modes and the approved replacement-file Defeature coverage, topology reuse/invalidation, worker determinism and rollback acceptance.
- [ ] Confirm M1 dependency acceptance from its owning task's evidence.
- [ ] Review the complete candidate and update issue #2; close its milestone only when every acceptance gate passes.

No milestone closure or complete-domain parity is claimed by this plan.

## 2026-10-25 Unroll/Average checkpoint

- [x] Retain original-to-export numeric fixtures for vertical Unroll at 0/90 degrees and one/two instances, plus a nonorigin oblique cylinder.
- [x] Retain same-input native Average three-plane and open-rim rejection exports; verify the 10 mm default.
- [x] Integrate the shared worker, public MCP schema and GUI command adapters, preserving explicit replacement and all job guards.
- [x] Reproduce and fix fresh-owner construction-key collisions and semantic-reference validation regressions.
- [x] Build an immutable candidate, pass 155 focused tests and both browser lifecycles with exact GUI/MCP output equality, and retain source/build/output/resource identities.
- [x] Record the 49,018-pass full-suite checkpoint and its 64 fixture-gated skips separately from subsequent focused validation.
- [ ] Complete the remaining inventory/native acceptance gates. The owner confirmed that the original 18,425-facet Defeature file is gone and authorized testing other files; use the exact retained replacement selection and available-scan controls, with separate provenance.

M1 issue #1 is now closed with its own acceptance/integration record. M2 closure remains pending, and no later milestone is advanced here.

## 2026-10-26 Curvature continuation rulings

The staged Curvature build `m2-curvature-stage-build-20261026-r2` passed
TypeScript, Vite and offline-manifest generation (`scanforge-8ca9c9cc78fcb0ec`).
The owned Job peaked at 1,581,072,384 bytes, exited zero and released all child
processes and handles without cleanup errors. Three alignment `Array.map`
callers now wrap the query factory so the new internal optional triangle
metadata setting cannot receive the array index. The focused numerical stage
passed 66 tests before those wrappers; the complete native comparison remains
red and this build does not close the application integration gate.

Ruling: keep the pinned application CAD kernel and the existing exact STEP
control-net path for the internal Curvature surface stage. The actual WASM
probe confirms both point-array constructors and both surface-pole array
accessors are unbound. The proposed 23 by 23 cubic control net imports and
meshes under the recovered deflection/angular profile. This is a kernel
capability check, not native hole-fill acceptance. A kernel-version difference
remains an explicit comparison risk; no count or geometry tolerance has been
relaxed on that basis.

Ruling: the visible native Fit Surface export is a separate diagnostic. Its
recorded 20 by 20 settings produce a different center height and 21 by 21
controls, so it cannot substitute for the successful whole-hole native STL.
The original 1,702-facet Curvature fixture remains the failing acceptance gate.

The next shared-worker stage must preserve the existing GUI/public-MCP request,
locks, revision/retry checks, progress, cancellation, rollback and history. Its
transient CAD objects must be owned and released by that processing request;
they must not become scene entities or reusable public kernel handles.

The next frame stage was observed red (missing frame module and missing collar
source indices), then passed 70 focused tests after implementation. Source IDs
are retained for original normal lookup; affine residuals now subtract each
ordered term separately. The private framed-grid probe's first failure at the
public 16-control limit is retained; the corrected private evaluator passes
without changing that contract. Its exact central Float32 height and bounded
66-point central comparison are recorded in the native hole-fill investigation.
General trim was observed red, then passed eight controls after correcting
finite-segment boundary marking (the first implemented attempt passed 77 tests
and failed the shared-diagonal area control). The next smoothing stage was
observed red, then passed five controls; the staged suite now passes 83 tests.
Both retain failed receipts separately. The framed actual-WASM/general-trim
probe produces a valid 1,048-facet cap, but collar stitching/collapse and the
whole native fixture still remain to integrate.

Ruling: constrain boundary marking to the finite segment, and discard zero-area
trim facets before publication. The manufactured shared-edge control otherwise
loses 25 percent of its area. This is a validity safeguard; exact native
comparison must still verify the observed annulus rather than treating these
manufactured controls as a substitute. Full application integration, whole-hole
output, browser/public-MCP acceptance and M2 closure remain open.

The join helper's six controls pass (89 focused tests total). Its private whole
probe matches 1,702 facets, 884 used vertices, 176 inserted seam vertices and
17 collapsed edges, but the maximum nearest native vertex difference remains
0.11093 mm (RMS 0.02074 mm), with correspondence collisions and connectivity
differences. Matching counts do not close the native gate. A private stage
observer is prepared to separate seam construction from smoothing without
changing production behavior. The helper remains outside the application path.

The stage observer localized a mismatch before smoothing. Native construction
uses a local CAD face followed by a rigid placement; the private correction
improves central matches from 54/66 to 61/66 within 1e-6 mm, but whole geometry
still differs (maximum nearest distance 0.09897 mm). The exact Ax3 and zero-face-
tolerance controls do not resolve the remainder. All-selected smoothing was
tested privately and rejected because it worsens RMS and moves the observed
center. Static selection/compaction findings and failed scopes are retained in
the hole-fill investigation. The independent private CAD diagnostic package is
hash-pinned and does not change application dependencies. The shared exact CAD
restore dependency is integrated and pushed; its 94-test focused regression
batch passes. Exact pushed commit `e0581fc1f8c7bec7a45762aef9d42c3f3aaafa55`
also passes hosted build, full tests, CAD smoke and formatting; this does not
cover the uncommitted Curvature helper/integration work.

Integration follow-up from the static compactor: remove newly allocated,
unreferenced cap vertices before publishing indexed geometry, while preserving
original source identities and unrelated source records. The private candidate
currently allocates 2,040 records for 884 referenced vertices; its unused probe
records must not leak into application bounds, caches or serialized geometry.
Add an observed failing ownership/bounds regression before that implementation.

The independent interpolation diagnostic isolates the remaining central mismatch
in endpoint fitting: nine-point Bernstein fits use the original global parameters,
followed by the constrained cubic normal-equation solve. The rewritten TypeScript
grid passes the independent control-net comparison. The independent affine-plane
control reproduces a 3.7992e-7 mm departure from ideal linear UV speed while staying
on the plane within 1.1e-12 mm; its regression retains the 1e-9 mm tolerance against
measured kernel samples and independently checks plane membership.

Using the independent correct controls in the existing pinned application WASM
produces 1,529 vertices and 2,984 facets, with all 66 central reference vertices
within 1e-6 mm. The independent mesh plus shared trim/join also yields all 884
reference correspondences and no missing or extra oriented facets (maximum
nearest distance 6.89e-17 mm). Neither replay establishes integrated application
acceptance. A fresh replay of the current TypeScript controls and the async
worker, GUI and public-MCP acceptance remain required.

The unused-cap ownership control was observed failing with one unused temporary
vertex and collapsed seam records retained. Compaction now preserves every source
record and removes only unreferenced new cap records; its green run is pending.

The fresh current-TypeScript/pinned-WASM replay remains geometrically failed:
1,702 facets and 884 compacted records, but only 816 distinct nearest native
matches, maximum distance 0.10373 mm and 353 missing oriented facets. Its controls
differ from independent interpolation by only 1.24e-10 mm, demonstrating that the
previous 1e-8 control-net assertion was insufficient for adaptive meshing.
The stricter 1e-12 control comparison and the full oriented-connectivity comparison
must pass. Source inspection identifies a specific hypothesis: the right endpoint
Bezier derivative is evaluated through the full forward-difference polynomial;
shortcut endpoint subtraction discards its floating-point evaluation order.
No integrated acceptance or kernel upgrade is inferred from these diagnostics.

The endpoint forward-difference hypothesis is now verified: the corrected control
net matches the independent kernel exactly, and actual pinned CAD D0 evaluation
removes the diagnostic near-zero center difference as well. Shared async native
geometry passes the original strict oriented-coordinate digest. The integrated
GUI/public-MCP, history, binary persistence and actual nested-worker cancellation
checks pass on frozen build `scanforge-5ac679fa9d720305`. The affected suite passes
202 and the worker/native follow-up passes 80 after correcting three direct-worker
tests to await async dispatch. Initial full-suite 49,133/3/64 remains a failed
receipt until exact-head CI reruns. See the dedicated Curvature evidence; the
broader inventory and final review/merge gates remain open.
