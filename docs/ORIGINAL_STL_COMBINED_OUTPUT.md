# Original-three STL combined-output investigation

GUI and public MCP Re-polygonize produce identical output from the full saved
aligned three-STL project at 0.5 mm point resolution. The result has 284,350
triangles and two closed components. It is an experimental combined-output
candidate, not an accepted single usable part or a native-verified result.

[Structured evidence](evidence/original-stl-combined-output-20261024.json) records
run `20261024T075034484092Z`, its source/build identity, complete buffer hashes,
independent measurements and resource receipts. The base is local commit
`e367262fc46b2fee8588c7b3c84ccd41fa7424fa` plus captured working changes, not
pushed `main`. The validation snapshot's source manifest is
`764d4421c0f27f0e9572792745b0c08a0d0298e6942765e8f8b449008e742d4c`.
No application source changed for this checkpoint. The primary checkout has
independent later edits; frozen-source results are not attributed to them.

## GUI/MCP workflow

The GUI reopens the complete 736,091,936-byte saved project. It contains all
3,121,976 indexed vertices and 6,147,452 accepted original STL triangles, with
the prior six-step history. No input is sampled or reduced. This reuses the
saved alignment; it does not run or certify a new alignment solve.

Actual GUI controls select both additional scans and 0.5 mm resolution, then
Apply dispatches one public `mesh_process` reconstruction. Undo restores all
16 original current geometry carriers; Redo restores the full reconstructed
output. A fresh MCP reconstruction from that same before-state matches all GUI
output digests, topology and diagnostics. Both reference objects stay unchanged.
Each command adds exactly one history entry, from step six to step seven.

Each disposable processing worker receives all three complete Float32 shared
inputs with an empty transfer list. Worker termination and target retirement
are observed; physical process cleanup is verified by the outer Job.

Public STL export temporarily hides the two retained references, exports the
visible reconstructed source, downloads every byte, and restores reference
visibility. Display edits add no modeling steps. The exported Float32 positions
match the complete MCP output hash. The artifact is then released.

| Measurement                                          |                         Result |
| ---------------------------------------------------- | -----------------------------: |
| Output vertices                                      |                        142,097 |
| Output triangles                                     |                        284,350 |
| Closed components                                    |                              2 |
| Boundary/nonmanifold edges and vertices              |                              0 |
| Winding conflicts, duplicate or degenerate triangles |                              0 |
| STL bytes                                            |                     14,217,584 |
| Peak aggregate validation Job bytes                  | 2,501,636,096 (about 2.33 GiB) |
| Job limit / CPU limit                                |                    4 GiB / 25% |

All owned processes exit, the final active count is zero, normal identity
coverage passes, handles and completion port close, and capture/cleanup errors
are empty. This is Job memory, not total machine or GPU memory. Native binaries
were not executed or instrumented. No commit, push or GitHub mutation occurred.

## Independent component and distance checks

A separate binary-STL checker imports no application geometry code. It examines
every output triangle using exact Float32-coordinate welding, edge incidence,
vertex links, connected components, signed volume and area. Its canonical
position hash matches the public geometry digest. All topology counts agree
with the application, and the stored facet normals are consistently oriented.

| Component | Triangles |   Surface area |  Signed volume | Area fraction |
| --------- | --------: | -------------: | -------------: | ------------: |
| Main      |   283,768 | 28,290.988 mm² | 10,449.332 mm³ |      99.8188% |
| Smaller   |       582 |     51.359 mm² |     10.120 mm³ |       0.1812% |

The smaller component spans approximately 14 × 4 × 1.5 mm. It was retained;
small size does not establish that a component is unwanted scan noise.

The independent distance evaluator checks complete source hashes and uses
point-to-triangle distances. Exact duplicate-coordinate memoization preserves
the weighting of every input and output triangle corner; no point or face is
sampled or discarded. All expanded input corners map exactly to their stored
indexed coordinates in this dataset.

| Direction                                | Corners covered |     Mean |      RMS |  Maximum |
| ---------------------------------------- | --------------: | -------: | -------: | -------: |
| Original inputs → reconstructed surface  |      18,442,356 | 0.329 mm | 0.344 mm | 0.742 mm |
| Reconstructed output → original surfaces |         853,050 | 0.374 mm | 0.392 mm | 0.650 mm |

The smaller component's reverse RMS is 0.394 mm, similar to the main component's
0.392 mm. These finite point measurements are not a continuous surface
Hausdorff bound. The application reports an approximate 0.375 mm surface offset
at this resolution; point resolution is not a maximum-deviation tolerance. No
geometric acceptance threshold was invented to pass these results.

The topology checker passes eight analytic/adversarial controls covering closed
and disconnected tetrahedra, open edges, duplicate faces, vertex-only contact,
degeneracy, truncation and nonfinite data. The distance evaluator passes five
analytic cases, a weighted-statistics control and three exhaustive
284,350-triangle audits with zero measured disagreement. Its checker and 104
library files remain unchanged across the bounded run. The snapshot's prior
build and 96 focused tests remain applicable to that unchanged snapshot; full
unit/CAD suites were not rerun for this checkpoint.

## Review artifact and live preview

Candidate STL SHA-256:
`13a7c09ecf659877b5423dd1e6e9da2297037161c9c745f693ff7945b9c63e6c`.
The local review copy is named
`ScanForge-combined-STL-candidate-20261024T075034.stl`.

The candidate was imported through the current primary app's actual GUI in a
new Codex browser tab at `http://127.0.0.1:5173/`, with Millimeter selected. The
visible result has one object, 284,350 facets, units mm and one import-history
step. Console warnings/errors were empty and no framework overlay was observed.
The tab is retained for review. This current-primary smoke check is separate
from the frozen-source GUI/MCP acceptance run. No existing backup was restored
or deleted. The STL is geometry-only; it does not carry the seven-step parent
project history.

## Remaining acceptance

Self-intersections, native reconstruction comparison and the interpretation of
the smaller component remain open. This result does not establish a single
usable part, strict alignment convergence, point-cloud reconstruction, a
reconstructed `.scanforge` save/reopen, backup restoration or complete
STL/PLY/ASC lifecycle coverage. M1, M3 and the broader reconstruction objective
remain open. Preserve both components and the original scans while resolving
these gates.

The [native static-path investigation](NATIVE_REPOLYGONIZE_STATIC_PATH.md)
identifies candidate resolution, source-encoding and output-extraction stages.
It does not yet establish the native surface offset or accept this candidate.
