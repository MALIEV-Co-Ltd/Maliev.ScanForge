# Full original-three reconstruction memory validation

## Current-build revalidation: 2026-10-23

The original three PLY scans passed the complete GUI/MCP workflow on tested base
`e405b17f3134c992b8f48f007390a41aeae70836`, including the five preserved viewport
revision edits in the working tree. The build and replay used 1,864 pinned
compiler inputs, unchanged before and after validation. This is a workflow and
memory regression pass; alignment/native acceptance remains open.

| Measurement                     |                     Current result |
| ------------------------------- | ---------------------------------: |
| Original vertices               |                          3,381,455 |
| Original triangles              |                          6,663,164 |
| Reconstruction resolution       |                             0.5 mm |
| Output triangles                |                            334,240 |
| Closed components               |                                  4 |
| Job peak committed memory       | 3,033,473,024 bytes (2,892.95 MiB) |
| Job memory cap                  |        4,294,967,296 bytes (4 GiB) |
| Owned processes, all exited     |                                 17 |
| Controller reported convergence |                                 No |

GUI Global Fine Align Preview, cached MCP Apply, full geometry digests, model
history/Undo/Redo and GUI versus MCP reconstruction passed. Both target objects
stayed unchanged; Undo restored all 15 aligned authored buffers and Redo restored
the output. Reconstruction borrowed all three shared Float32 inputs with no
input transfer, retained full input resolution and committed one history entry.
No fixture downsampling, geometry JSON export or history clearing was used.

The current run is `20261022T202205185896Z` (20:22–20:27 UTC). All 17 owned
processes exited, the Job became empty, three validation ports closed, retained
handles closed, and capture/cleanup errors were empty. The 4 GiB/25% CPU resource
policy and existing free-memory admission gates were unchanged.

The controller did not report convergence. Four closed output components do not
prove a single usable part; self-intersections were not checked. The earlier
seven-component result below used a different clock-driven alignment pose; GUI
and MCP are compared on the same cached aligned input within each run. Peak Job
commit does not include all GPU or machine memory. Full native numerical replay,
independent registration quality, complete backup/restore and soak acceptance
remain open. Unit/CAD suites were not repeated for this verification-only update.

See [current structured results](evidence/reconstruction-current-three.json).
The fresh Codex browser workspace separately contains all three original scans.
Foreground Preview at 0.5 mm also reported no convergence and preserved originals
and history; no alignment was applied there. Cached previews expire normally.

## Earlier memory-fix baseline

The full original three-scan workflow passed under a 4 GiB Windows Job cap on
2026-10-22. All 6,663,164 original input faces were retained. GUI Global Fine Align
Preview and cached Apply preceded GUI reconstruction at 0.5 mm, full canonical
geometry digests, Undo, Redo, Undo and identical MCP reconstruction. No sampling,
resolution coarsening, geometry JSON export or history clearing was used.

GUI and MCP produced identical full geometry hashes, topology and diagnostics.
Both target objects remained unchanged. Undo restored all 15 aligned authored
buffers exactly; Redo restored the reconstruction exactly. Each reconstruction
used one disposable worker, three borrowed Float32 shared-buffer inputs, no
transferred input buffers and one history commit.

| Measurement                    |                             Result |
| ------------------------------ | ---------------------------------: |
| Original input triangles       |                          6,663,164 |
| Output triangles               |                            328,210 |
| Closed components              |                                  7 |
| Grid points                    |                          7,420,720 |
| Sampling candidates            |                         28,615,509 |
| Job peak committed memory      | 3,067,162,624 bytes (2,925.07 MiB) |
| Job memory cap                 |        4,294,967,296 bytes (4 GiB) |
| Observed processes, all exited |                                 17 |

Boundary edges, nonmanifold edges/vertices, winding conflicts, duplicate faces
and degenerate triangles were zero. The Job became empty, retained handles
closed, and capture/cleanup errors were empty. Job commit is distinct from total
machine RAM, GPU memory and per-process RSS. The private-payload admission limit
is not a process memory guarantee.

The change removes reconstruction input copies for immutable shared buffers,
directly allocates shared final global-alignment streams, replaces the old
aggregate three-million-face reconstruction gate with coordinate-work and
private-payload admission, and counts output before one exact allocation.
Ordinary buffers retain private-copy fallbacks. ShrinkWrap retains its early
three-million-face limit. GUI and MCP share the existing `mesh_process` contract.

Build passed with 1,844 unchanged compiler inputs and offline manifest
`scanforge-2852b9c60ab23736`. Focused checks: 1,197 passed in seven files. Full
suite: 47,505 passed, 61 existing skips; 573 passing and 17 skipped files. A
separate small browser regression passed geometry/history/save/reopen,
cancellation and atomic worker-failure checks under 4 GiB. The accepted small
run is `20261022T122552410364Z`; full original-three run is
`20261022T122925272047Z`. Original input hashes were pinned before launch:

| File        | SHA-256                                                            |
| ----------- | ------------------------------------------------------------------ |
| `ply-1.ply` | `e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05` |
| `ply-2.ply` | `3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f` |
| `ply-3.ply` | `bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2` |

The independent voxel algorithm does not establish native numerical equivalence.
Seven closed components do not establish one solid or accepted alignment
quality. The global controller did not converge; its quality
receipt is separate from this workflow pass. Self-intersections were not
certified. Native GUI capture and full numerical comparison remain unresolved;
the MVP alignment/combine milestone remains open.
See [native import findings](NATIVE_PLY_IMPORT.md) for the separate preparation
boundary.
