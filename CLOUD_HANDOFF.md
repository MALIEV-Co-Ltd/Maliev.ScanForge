# ScanForge cloud handoff (2026-11-23)

The purpose of this branch is preservation and cloud continuation, not an M2 release. It is based on the M2 integration workspace snapshot and adds the ten original scan inputs in `cloud-inputs/alignment-example-files/` through Git LFS. Install Git LFS and run `git lfs pull` after checkout. The inputs were downloaded from GitHub into a separate empty storage area and all ten SHA-256 hashes verified.

## Starting points

- M2 integration snapshot, including the uncommitted native smoothing mismatch evidence: `codex/cloud-handoff/20261123-m2-junction-integration`.
- Main checkout working state: `codex/cloud-handoff/20261123-main-workspace`; its original base is `e367262f`, older than remote main. Do not assume this snapshot is safely mergeable without review.
- All 21 dirty worktrees were captured separately in `codex/cloud-handoff/20261123-*` branches. Their working-state trees were checked against their respective snapshots. Where a worktree had staged changes, its snapshot has a parent commit preserving the staged state. `20261123-m4-local-branch` also preserves the only local branch tip that was not otherwise reachable from a remote branch.
- The worktrees remain unchanged and may still report uncommitted changes locally. These are archival snapshots; experimental code and generated files may need cleanup and review before integration.

## M2 status

The M2 draft PR is https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/pull/18 and the acceptance tracker is issue #2. Exact-head hosted build, tests, CAD and formatting passed at `47973f9e` on 2026-11-08. They do not prove milestone completion. Native comparisons, the expected unindexed connectivity failure, GUI/MCP validation for outstanding cases, integrated review and merge remain open. Preserve the owner's instruction to retain safety checks even where native geometry is unsafe.

The native whole-scan smoothing diagnostic found 219 different scalar coordinates (maximum 0.1699676513671875 mm) versus ScanForge; see `docs/evidence/m2-original-scan-native-smooth-mismatch-20261108.json`. The native action was reported by the user, not directly observed. Its raw temporary STL was removed after recording its hash and differing coordinates. Do not treat this as a fully reproduced native test or GUI/MCP acceptance.

## Environment and exclusions

Paths in historical scripts may refer to `C:/repo/alignment-example-files`; adapt those paths to the LFS input directory in cloud. QuickSurface comparisons depend on an installed, licensed native Windows application and interactive desktop; a cloud Linux environment does not supply it. Continue using retained native evidence when direct comparison is unavailable, without claiming native validation that has not occurred.

Git-ignored local runtime data (`.resources`, `.superpowers`, dependency directories, build output and `public/kernel`) was not generally archived; much of it is generated caches or historical test output. The original source scans are included, but generated `.qsfbak` backups are not. Some non-ignored old generated files were intentionally preserved in the archival worktree snapshots. The user authorized publication of scan files and evidence to this public repository.
