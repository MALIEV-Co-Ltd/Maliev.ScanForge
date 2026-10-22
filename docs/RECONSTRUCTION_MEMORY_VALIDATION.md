# Full original-three reconstruction memory validation

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
