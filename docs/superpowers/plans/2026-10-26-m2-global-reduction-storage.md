# M2 Global Reduction Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Work stays inline in the existing M2 worktree; independent review precedes production integration.

**Goal:** Replace object-heavy global reduction working records with bounded typed storage while preserving the recovered native collapse sequence and GUI/MCP behavior.

**Architecture:** Keep the recovered candidate arithmetic as the shared mathematical primitive. Store vertex/face columns in typed arrays and incidence references as encoded corner IDs in a chunked vector. Retain face iteration order, both incidence snapshots, twenty-pass rebuild order and original-index export order. Change production admission only after golden and differential evidence passes.

**Tech Stack:** Existing TypeScript, typed arrays, Vitest, current public-MCP/Playwright driver; no dependencies.

**Spec:** `docs/NATIVE_POLYGON_REDUCTION.md`, `docs/M2_ACCEPTANCE.md`, repository `AGENTS.md`.

## Global constraints

- Existing owned validation ceiling remains 4 GiB aggregate, 25% CPU and finite serialized Jobs; no guard/lease/heap increases.
- Internal compact working admission is 1,536 MiB, including input copies, records, incidence capacity, temporary snapshots and worst-case export buffers. It is a bounded algorithm allocation budget within the external 4 GiB ceiling, not a new process cap.
- Preserve all Float64 operation grouping, Float32 caller widening/narrowing, native tie writes, fixed normals, threshold schedule, boundary flags, source ownership, cancellation and below-four target behavior.
- Preserve the existing effective count/percentage weld tolerance of 0.000001 mm and all application topology rejection checks: degenerate/duplicate facets, nonmanifold edges/vertex fans, inconsistent winding. A weld-only shortcut is insufficient.
- Budget welding before its first allocation and every growth: full corner indices, simultaneous old/new vertex/link buffers, simultaneous head/tail rehash buffers and final vertex slice.
- GUI and MCP continue through the same operation. No new user parameter or advertised unsupported mode.
- Deviation reduction has a separate known algorithm gap. This storage work cannot close that gate or arbitrary native import-order acceptance.
- Oversized global work retains the existing spatial fallback with accurate scope; never label its result globally native-equivalent. Keep its existing agent capability.

## Review focus

1. High-valence/degenerate meshes can grow incidence scratch beyond static estimates: enforce capacity before every growth and temporary allocation; test rejection/rollback.
2. Twenty-pass rebuilds renumber legacy face records: preserve stable survivor order and rebuild reference traversal in that order; compare long-running cases.
3. Native equal-cost ties depend on exact expression grouping and last-write order: reuse `reductionCandidate`; retain golden Float64 bytes and face/corner order.
4. Snapshot aliasing can corrupt the second endpoint while updating the first: copy both incidence ranges before any updates; differential tests include shared fans.
5. GUI source/history and cancellation must remain atomic while larger global requests are admitted: verify original buffers, preview, cancel, undo/redo and binary reopen through public MCP and GUI.

## Files and interfaces

- Create `src/scan-reduction-storage.ts`: `CompactReductionState`, typed column allocation/accounting, chunked `ReductionReferences` (`length`, `get`, `push`, `snapshot`, `reset`, `dispose`) and `compactReductionBytes(vertices, faces)`.
- Storage interfaces: `ReductionMemoryBudget(capacityBytes)` exposes `usedBytes` and idempotent-release `reserve(bytes)`; `ReductionReferences(memory, chunkEntries = 65536)` exposes encoded `get/push`, `snapshot(start,end) -> {values: Uint32Array, release()}`, capacity-reusing `reset()` and `dispose()`. `CompactReductionState(coordinates, triangles, checkpoint?, limitBytes=1536*1024*1024)` owns points/quadrics/offsets/counts/boundary/triangles/normals/errors/best/flags/order/references/memory/minimum/originalFaces/faceCount plus `vertex(id)` candidate views and `dispose()`.
- Create `src/scan-reduction-compact-preparation.ts`: `prepareCompactReduction(coordinates, triangles, checkpoint)` with native normal/quadric/error/incidence/boundary initialization order.
- Create `src/scan-reduction-compact.ts`: `nativeCompactReductionMesh(coordinates, triangles, target, options = {})`, returning `{vertices: Float64Array, triangles: Uint32Array}`. Same validation/progress contract as `nativeReductionMesh`.
- Modify `src/scan-native-reduction.ts`: delegate to the compact kernel after complete differential/golden verification; preserve public signature.
- Modify `src/scan-reduction-adapter.ts` and `src/scan-tools-reduction.ts`: accurate compact admission and shared whole-input preparation through existing `weldMeshPositions` without constructing unnecessary diagnostic topology only after equivalent validation is proved. Use existing compatible cached/indexed source when available.
- Create `src/scan-reduction-source.ts` only if replacing full diagnostic preparation: preserve the existing invalid-topology error and validate against `analyzeMesh` on every rejected class. Retain full preparation until that equivalence is proved. Optional internal admission callbacks in `src/mesh-weld.ts` must not change representative traversal/order for other callers.
- Existing `src/scan-reduction-candidate.ts` stays the arithmetic primitive. Existing validity/update/preparation/final fixtures remain independent evidence; keep their existing APIs until callers are audited.
- Tests: new `tests/scan-reduction-storage.test.ts`, `tests/scan-reduction-compact.test.ts`, `tests/scan-reduction-global.test.ts`; existing native/adapter/large-reduction suites and browser driver.
- Documentation: native reduction record, agent limits/recovery guide and M2 inventory/evidence.

## Task 1: Capture routing failure and add bounded compact storage/preparation

- [ ] Under the unchanged guard, capture a deterministic 40,960-facet curved grid through the current whole-input recovered kernel and current production path. Retain source/output digests, counts, source immutability, peak memory and cleanup. A current spatial/global mismatch is evidence of the routing defect, not new native UI truth.
- [ ] Add a frozen global-output digest regression for that deterministic input, plus a check that the route reports whole-input preparation rather than patch processing. Run RED before production changes.
- [ ] Add storage tests: fixed column byte accounting, encoded corner references, chunk-boundary slice/reset, bounded growth failure, malformed sizes/overflow, cancellation during preparation.
- [ ] Implement columns: Float64 points/quadrics/normals/errors; Uint32 face corners/order/incidence offsets/counts; byte boundary/best-edge/dirty/deleted flags. Encode references as `face * 3 + corner` only after bounds checking.
- [ ] Implement compact preparation in the exact existing order, using short-lived candidate views rather than permanent objects per record. Compare every field with retained preparation fixtures and the existing preparer on deterministic meshes.
- [ ] Run focused storage/preparation/native-candidate tests. Self-review before the next task; commit the complete tested storage/preparation slice.

## Task 2: Preserve the complete global loop and export

- [ ] Add compact-kernel assertions for every `reduction-whole.json` case: exact Float64 bytes, output indices/counts, source ownership, progress and each cancellation phase. Run RED.
- [ ] Implement ordered global passes with unchanged threshold/cost/tie expressions. Copy both endpoint incidence ranges before updates. Keep fixed original face normals and the same deletion-mask visitation semantics.
- [ ] Use stable face IDs plus an in-place survivor order vector; regenerate incidence in that order every twenty passes. Do not sort by geometry or introduce parallel collapse.
- [ ] Preserve original-index vertex compaction and oriented surviving face/corner order. Charge compaction/export buffers and temporary incidence snapshots to admission before allocation.
- [ ] Differential-check compact versus the current loop on disconnected, open-boundary, degenerate, high-valence, equal-cost, repeated and multi-rebuild cases. Freeze hashes before replacing the reference loop; retain the native golden fixtures.
- [ ] Run complete affected kernel/adapter tests and targeted TypeScript. Self-review; commit only after all byte-level comparisons pass.

## Task 3: Integrate compact global admission through the shared operation

- [ ] Add routing/admission tests above the old object budget, including the frozen global digest from Task 1. Prove that an admitted global request never calls spatial patch reduction.
- [ ] Replace the legacy whole-loop body with the compact kernel. Retain its signature, validation, native below-four shortcut, defaults and shared GUI/MCP binding.
- [ ] Add invalid-input shared API/MCP tests for duplicate/degenerate faces, inconsistent edges, nonmanifold edges and disconnected vertex fans, below and above the former admission boundary. Preserve explicit errors and source/history atomicity; compare the replacement validator with full topology preparation.
- [ ] Before object-rich diagnostic topology is built, use existing weld preparation to obtain the identical first-encounter indexed source for global reduction. Preserve cancellation/progress and source-array ownership. Keep patch-only exact indexing semantics unchanged.
- [ ] Add bounded weld-stage admission before initial allocation, each simultaneous growth/rehash and the final slice; include source/adapter widening and output arrays in peak estimates. Test rejection before allocation and cancellation.
- [ ] Replace object estimates with exact compact array/capacity accounting. Check overflow/nonfinite dimensions; charge growing incidence and export peaks. On a dedicated compact budget-exhaustion error, unwind all compact references/temporary leases before the existing explicit spatial fallback; keep source/history unchanged. Cancellation and invalid topology errors propagate and never trigger spatial retry. A fallback cannot silently claim global-native output.
- [ ] Verify small adapter/native byte fixtures are unchanged; run larger count/percentage controls with source/history rollback and no guard changes. Update agent documentation if result diagnostics/limits/recovery change.
- [ ] Build all thirteen TypeScript batches and production assets without warnings. Independent whole-slice review before committing/pushing.

## Task 4: Rendered and real-input acceptance

- [ ] Freeze the compiled source/build identity and run the current resident reduction GUI/public-MCP comparison on that exact build. Assert the same global geometry digest in both paths, preview source/history isolation and accurate progress.
- [ ] Extend current reduction replay with GUI Cancel-before-Accept, public preview discard/job cancellation, undo/redo and binary save/reopen checks. Do not reuse a subset as complete lifecycle evidence.
- [ ] Run guarded available production-scan and larger manufactured count/percentage probes. Report actual input/output identities, runtime, peak owned memory, source buffers and all helper/port cleanup. Failed or out-of-budget attempts remain retained.
- [ ] Obtain/compare equivalent original installed-native large-input exports when the native UI is operable. Existing kernel fixtures do not establish arbitrary imported-scan order or native deviation-dialog parity.
- [ ] Update M2 acceptance/PR tracker accurately, push, keep the existing live scene on the latest accepted checkpoint, and wait for exact-head CI. Native deviation and other M2 gates remain required before milestone closure/main merge.
