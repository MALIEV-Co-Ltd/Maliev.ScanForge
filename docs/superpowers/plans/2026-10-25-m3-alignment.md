# M3 alignment and scan combination acceptance plan

> Execute inline with `superpowers:executing-plans`, one acceptance slice at a time.

**Goal:** Complete tracking issue #3 and GitHub milestone #4, verify GUI/MCP/native acceptance, merge the verified candidate into main, and close the milestone.

**Architecture:** Keep GUI and MCP on the existing shared coordinate, landmark, fine and global alignment operations. Use actual original geometry and retained native captures to verify numerical behavior separately from registration quality and lifecycle behavior.

**Tech stack:** TypeScript, browser workers, Vitest, Playwright, public MCP bridge, retained native numerical captures.

**Spec:** https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/3

## Constraints

- Start from the verified M1 source candidate `9958d8f3d00ce23440acc5efc1a3f8dc5f5249ca` in an isolated worktree. Preserve the dirty primary checkout and other tasks.
- Original inputs are mirrored at `C:/repo/alignment-example-files`; preserve bytes and millimetre units. No sampled, synthetic or seeded substitute for full original native acceptance.
- Keep memory admission, finite leases, cancellation, worker cleanup, locks, revision checks, retry receipts and single-transaction history intact.
- Every application change must use shared GUI/MCP operations and include contract/behavior tests. Update catalog, adapter and agent documentation when their contracts change.
- Build first, then focused/affected tests, rendered GUI/public-MCP workflows and native comparison. Preserve the existing 4 GiB aggregate Job limit and 25 percent CPU policy.
- Numerical equivalence and useful final registration are independent gates. Do not close from stable-but-unconverged diagnostics alone.

## Review focus

- Raw STL poses can fail refinement; verify coarse placement and final full-geometry accuracy independently.
- ASC point clouds must have an explicit supported alignment/reconstruction route; never silently treat point slots as triangles.
- Cached Apply must accept the exact preview without solving again; mismatched jobs, stale sources and cancelled work must not publish.
- Authored scanner normals, derived normals, point placements and indexed topology must survive history and persistence correctly.
- Native clocks, imported geometry and final ordered transform commands must describe the same candidate/run; stale retained reports do not prove current integration.

## Task 1: Pin baseline and acceptance inventory

- [x] Resolve M3 versus GitHub numbering with the owner: M3 is issue #3 / milestone #4.
- [x] Verify M1 issue #1 is closed and inspect its pinned source candidate.
- [x] Create isolated `codex/m3-alignment` from that source.
- [x] Build the baseline under resource limits and retain source/build identity and cleanup receipt.
- [x] Run focused alignment, normal ownership, preview/history and MCP regressions.
- [x] Map each GUI route to its shared operation, catalog schema, agent documentation, native fixture and missing acceptance evidence.

## Task 2: Complete shared alignment and combination gaps

Checkpoint: integrated the primary checkout's Fine Align accuracy slice and added exact bounded nearest-point search plus referenced indexed-target binding. Final build, 48,987 tests (64 skipped), CAD smoke, formatting and synthetic mesh/cloud GUI/public-MCP replay pass. The review's GUI error-guard defect is fixed RED then GREEN. Original-three ASC supporting replay passes workflow parity but retains an explicit insufficient-overlap quality finding and predates the final UI/cache guards. Full M3 acceptance remains incomplete. See `docs/M3_ACCEPTANCE.md`.

- [ ] Reproduce each identified gap with a failing regression before changing production code.
- [ ] Implement the shared operation, preserving native input semantics and all ownership/history guards.
- [ ] Build and pass focused and affected tests for every coherent change.
- [ ] Verify origin/reference, landmarks, fine/global alignment and combination on original mesh/cloud inputs through GUI and public MCP.

## Task 3: Full native and original-file acceptance

- [ ] Compare complete native controller/setter behavior on all three original scans using equivalent imported geometry/settings/clocks: final transforms, ordered commands, positions and normals.
- [ ] Establish successful registration and usable combined output with independent full-geometry accuracy measurements.
- [ ] Replay STL/PLY/ASC preview, retry/mismatched jobs, cached Apply, in-flight cancel, Undo/Redo/timeline and persistence with complete output comparisons.
- [ ] Verify bounded memory and owned cleanup on success, failure, timeout and cancellation.

## Task 4: Review, merge and closure

- [ ] Pin the final source commit and retain reproducible commands, counts, hashes, artifacts and evidence boundaries.
- [ ] Pass required build, full suite, CAD, formatting/static checks and rendered GUI/MCP/native gates on that candidate.
- [ ] Review the complete diff and resolve blocking defects; confirm M1 evidence remains applicable.
- [ ] Create and attach a PR, verify exact-head hosted checks, merge into main and verify the merge result.
- [ ] Close issue #3 and milestone #4 only with all acceptance evidence satisfied; mark the goal complete only after checking remote state.
