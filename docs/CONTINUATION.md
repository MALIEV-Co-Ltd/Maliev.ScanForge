# ScanForge handoff checkpoint: 2026-10-22

The owner requested a complete source checkpoint on `main` to continue on another
computer before further work on this memory-constrained machine. This checkpoint
preserves unfinished work; it does not declare the MVP or a milestone complete.
The first actual release remains **v0.1.0**. No deployment or release is requested.
Release publication now requires a manual workflow dispatch after exact-commit CI.

## Start on the next computer

1. Clone `https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge.git`, check out `main`
   and read `AGENTS.md`, `docs/AGENT_GUIDE.md` and this guide.
2. Use Node 22 and `npm ci --ignore-scripts`. Check available RAM and existing jobs
   before starting builds, browsers or workers. Keep resource limits unchanged.
3. Run `npm run build`, then `npm test`, `npm run test:cad` and
   `npm run format:check` sequentially. Check the GitHub validation run on the
   handoff commit first; record any failures rather than assuming prior results
   validate this entire checkpoint.
4. Run `npm run dev -- --port 5173 --strictPort`. Keep the latest app on loopback
   port 5173. Record exact process ownership, start time and a finite cleanup lease.
5. Resume M3 alignment and M8 performance below, then move through the remaining
   MVP milestones. GUI and MCP must use the same operations and verified outputs.

The current computer keeps its existing app on port 5173. Its PID and lease must
not be reused as ownership authority on another machine.

## What is preserved

- All previously committed application work and the pending main-checkout source,
  UI, import, grid, noise/reduction, surfacing, shortcut and regression-test work.
- Sixteen missing source/test files copied unchanged from `codex/bounded-scan`.
  These contain allocation leases, paged samples/comparison and source adapters.
  Main already had the resident corrections and newer overlapping implementations;
  they were preserved. The paged foundations are not an enabled out-of-core path.
- Prepared analysis sources under `tools/continuation/reference`, with a hash
  manifest. They require fresh paths, source/build receipts and runtime bindings.
  Do not run old plans with obsolete process identities or relax their guards.

The clean `codex/bounded-scan` branch also retains its original seven commits for
provenance. Its missing files are included on `main`, so development does not
require switching to the older branch. The bounded-processing status document
describes the earlier local layout; this checkpoint supersedes that layout.

## Evidence and remaining alignment work

The last isolated validated application commit before this checkpoint was
`ba4804435ede15040a3d4198f7c4ff65ba055757` (compact indexed display buffers).
Its isolated build passed with zero warnings/errors; focused checks passed 55
tests; the suite passed 47,055 tests with 54 skipped. These results do not validate
the pending changes included in this checkpoint. The initial handoff commit
`1b6f691` subsequently passed its hosted build, 47,161 tests (54 skipped) and CAD
smoke tests. Its formatting check found seven files; the handoff follow-up fixes
project formatting and preserves upstream vendor bytes. Review the final pushed
commit's CI separately. Native browser comparison remains outstanding.

The R5 actual full three-PLY browser attempt exceeded its unchanged 2 GiB Job
limit before alignment. All 24 children exited and cleanup completed. The R6
observation-only harness passed syntax, 16 observer contracts, four GUI import
fixtures and its import-attribution fixture. **The actual R6 browser replay and
the complete native three-scan final-transform comparison remain unverified.**

Next sequence:

1. Rebind the R6 diagnostics to a fresh verified checkout/build. Observe all three
   original GUI imports with bounded stage/counter and worker records. Require
   5376 MiB free at the parent check, retaining wrapper entry 5120 MiB,
   immediate-child 4608 MiB and the 2 GiB browser Job limit. The outer 5376 MiB
   check is required even though the runner itself admits at a lower threshold.
2. Inspect memory attribution before another product change. Full-file PLY buffers,
   picking/BVH copies and speculative topology warmup are source-derived suspects;
   their actual overlap was not established by R5. Do not describe them as a
   measured allocation root cause.
3. On successful actual capture, derive fresh native input/controller/setter
   bindings. Compare every controller callback/scalar, final transforms and six
   position/normal fields against the same original GUI-imported/recentered data.
   Native producer/controller admission is 4096 MiB; setter admission is 5376 MiB.
   Seeded or subsampled fixtures are not substitutes for this comparison.
4. Verify GUI and MCP Preview, Apply, Cancel, one undo entry, undo/redo and timeline;
   measure preparation, peak memory, cleanup and orbit/pan/zoom responsiveness.
5. Cover original STL, PLY and ASC alignment and combining into one mesh. Keep
   point-cloud selection/editing and point counts correct. Then continue M4.

## External files to transfer separately

Git contains application sources, tests and curated analysis scripts. It excludes
large user scans, native binary images, raw analysis outputs, dependencies,
builds, temporary ledgers, browser profiles and local project data.

- **Scans:** `B:/temp/alignment-example-files`, including original STL, PLY and ASC
  sets and the combined reference mesh. Preserve originals and import units.
- **Frozen analysis and native replay dependencies:**
  `B:/codex/artifacts/native-scan-analysis/rea-inventory-fix`. Copy through a private
  file transfer when the exact replay is needed. Preserve reports and failed runs.
  The next prepared package is
  `alignment-original-three-ply-public-r6-import-diagnostic-r2-20261021/capture`;
  `public-profile-plan.ACTUAL.json` is historical, not executable authority on the
  new machine. Recreate diagnostic snapshots from the appropriate commit rather
  than copying `node_modules` or treating a different tree as the validated one.
- **Reference runtime:** install the licensed native reference application and
  isolated REA/Ghidra/JDK tools as needed. Native image SHA-256:
  `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
  The binary is deliberately outside source control.
- **SpaceMouse:** install 3DxWare for official driver access. Repository vendor
  assets retain their existing license/notices; the separately downloaded SDK is
  at `Z:/spacemouse-sdk` on the original computer. Do not commit SDK archives,
  credentials or developer-account material. Default translation/rotation
  sensitivities are 1; the owner confirmed physical Gamepad navigation stays
  connected after the range correction.

Original PLY checksums:

| File      |    Bytes | SHA-256                                                          |
| --------- | -------: | ---------------------------------------------------------------- |
| ply-1.ply |  6926970 | e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05 |
| ply-2.ply | 68084515 | 3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f |
| ply-3.ply | 92765339 | bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2 |

## Milestones

All release-readiness milestones must close before release. Component tests alone
do not close a milestone. Track progress in the existing repository issues:

| Milestone                              | Issue |
| -------------------------------------- | ----- |
| M1 Scan import and point clouds        | #1    |
| M2 Scan repair and tools               | #2    |
| M3 Native alignment and combine        | #3    |
| M4 Construction, primitives and sketch | #4    |
| M5 Surfaces, freeform and CAD          | #5    |
| M6 Measurement and deviation           | #6    |
| M7 GUI, MCP and workspace              | #7    |
| M8 Performance and resources           | #8    |
| M9 Release readiness                   | #9    |

The owner rejected the Plasticity 2026.2 workflow milestone for now. It is
closed as not planned, not completed. Continue the QuickSurface reference path
for construction, sketch and CAD workflows, preserving the M4 and M5 acceptance
gates and shared GUI/MCP operations. Retain the closed Plasticity evidence as
historical context; do not use it as a current implementation plan.
