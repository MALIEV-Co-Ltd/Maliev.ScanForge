# M5 surfacing and CAD verification plan

**Goal:** Complete issue #5 and milestone 6, verify application/public MCP/native acceptance, merge the verified candidate into main, then close both trackers.

**Authority:** GitHub issue #5 and AGENTS.md. Candidate starts at e367262fc46b2fee8588c7b3c84ccd41fa7424fa in isolated branch codex/m5-surfaces-cad. Other checkouts contain concurrent work and must remain untouched.

## Required work

- [x] Read the live issue, dependencies, implementation inventory and shared contracts.
- [x] Build the isolated baseline before tests; preserve the build receipt.
- [x] Run focused baseline tests (49 tests in five files).
- [ ] Reconcile the release operation matrix: scan fit, patch/control edits, joins/continuity, loft/sweep, trim/blend, extrusion/revolution, Boolean, fillet/chamfer, shell, exact conversion and exchange. Disabled planned commands are explicit gaps, not validated operations.
- [ ] Close GUI/shared-operation inconsistencies and prepared sketch/surfacing defects with regression evidence. Preserve exact CAD via cad_rebuild, not mesh edits.
- [ ] Run matched real scan-to-sketch-to-surface-to-solid-to-export GUI and public MCP workflows, including preview/cancel, invalid input, lock/revision/retry guards, Undo/Redo and save/reopen.
- [ ] Verify analytic geometry, seam/normal/continuity tolerances, exact topology and STEP/BREP round-trips against equivalent real native inputs/settings. Synthetic kernel smoke alone cannot establish this gate.
- [ ] Verify success/failure/timeout/cancellation resource ownership and cleanup without reducing guards or disturbing existing apps.
- [ ] Build final code, run focused/affected/full suites, CAD smoke, formatting and browser boundary checks; record counts and candidate/source/build identities.
- [ ] Review the complete acceptance evidence and M1/M4 dependency state; resolve remaining requirements before merging.
- [ ] Push, create/attach PR, verify exact-head CI, merge into main, verify remote merge, then close issue #5 and milestone 6.

## Evidence ledger

2026-10-25: Baseline build passed, manifest scanforge-137c079968291db3. Focused baseline passed 49/49. Logs live in ignored .resources/m5. GitHub issue #4 is open; dependency acceptance is unproven. Browser plugin is not available; use the repository's Playwright/public SDK harness with a separate loopback port and disposable profile. GitHub connector reads work; gh CLI authentication failed, so use connector APIs where supported.

Completion remains unproven until every issue acceptance item passes. Do not close trackers or claim M5 complete from partial evidence.
