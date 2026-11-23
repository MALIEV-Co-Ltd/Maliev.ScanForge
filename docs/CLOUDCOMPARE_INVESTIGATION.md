# CloudCompare investigation

**Current completion record:** [2026-10-29 implementation and acceptance](CLOUDCOMPARE_COMPLETION_20261029.md).
General 3D Poisson reconstruction, complete owner-scan mesh quality and the
bounded native convergence comparison now have application/native receipts.
The dated status below is retained as investigation history.

Investigation and focused implementation started 2026-10-28. Findings distinguish native
observations, shipped-artifact inspection, official documentation/source
corroboration, ScanForge tests, browser validation and public MCP verification.
No stage alone establishes application equivalence.

## Stages and acceptance questions

1. Identify any installed CloudCompare before acquiring the official stable
   Windows distribution. Retain download URL, version, hashes and signature
   status; inventory shipped binaries/plugins and REA provider limitations.
2. Point-pair registration: establish moving/reference selection, paired point
   creation/editing, minimum/degenerate inputs, rigid/scale choices, residuals,
   preview/apply/cancel and undo from native observations.
3. Fine registration: establish native defaults and parameter meanings, roles,
   overlap/outliers, sampling, constraints, stopping and failure reporting. Use
   synthetic known transforms and representative available real scans.
4. Reconstruction: inventory native routes/plugins, normals prerequisites,
   supported geometry, settings, holes/boundaries and failures.
5. Compare against the current ScanForge checkout. Map each change through GUI,
   shared operation, MCP contract/catalog, results and agent documentation before
   editing. Preserve unrelated local changes and the live browser scene.
6. Implement focused improvements justified by evidence. Verify transforms,
   residuals, stopping, history and mesh quality using focused tests, browser
   interactions and public MCP. Record failures and unresolved gates separately.

## Evidence ledger

| ID     | Type                       | Finding                                                                                                          | Boundary / open questions                                                                                                              |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CC-001 | Official distribution page | The release page lists 2.13.2 as stable; its Windows installer publishes MD5 `2819B430C9ECF640F3CA0491C75EBE8F`. | https://www.cloudcompare.org/release/; fetched 2026-10-28. Verified against the published digest; see provenance below.                |
| CC-002 | Local inventory            | No CloudCompare process, standard Program Files installation or uninstall registry entry was found.              | Standard machine/user uninstall keys and Program Files paths only; not an exhaustive disk search.                                      |
| CC-003 | REA session                | REA 6.7.0 advertises an available Ghidra 12.1.4 Windows provider. Its native UI scenario tool is macOS-only.     | Use Windows Computer Use for native GUI observation; do not claim REA native UI capture on Windows. No configuration repair performed. |

The installer was verified against the published MD5 and Windows reports a valid
Authenticode signature. Installer SHA-256 is
`2384faaabdc10ba11d64652b324724481cba6e2634ce5d1d95b2f9ac457dc163`.
Installation at `C:/tools/CloudCompare-2.13.2` exited successfully; the bundled
Visual C++ redistributable returned 1638 (existing version), and the native GUI
and CLI both ran. [Provenance and plugin inventory](evidence/cloudcompare-20261028/provenance.json)
and [installation log](evidence/cloudcompare-20261028/install.log) retain details.
The CC-001 acquisition-verification question is resolved by those receipts.

| ID     | Evidence                                                                                              | Verified finding and limit                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-004 | [REA bundle](evidence/cloudcompare-20261028/rea-core-bundle.json)                                     | Shipped core exports Horn registration, ICP and projected Delaunay. Derived pseudocode of `computeTriangulation` and edge pruning shows coordinate projection followed by full 3D edge tests. Not original source or execution.                 |
| CC-005 | [Alignment report](CLOUDCOMPARE_ALIGNMENT.md)                                                         | Native GUI point-pair numeric entry, count checks, collinear refusal, paired removal, three-pair residuals, rigid preview/reset/apply and matrix report observed. Nonunit scale and preview/cancel remain open.                                 |
| CC-006 | [Alignment report](CLOUDCOMPARE_ALIGNMENT.md)                                                         | Native ICP GUI roles/defaults/Research controls and GUI/CLI result verified. GUI and CLI defaults differ; ScanForge retains its own documented defaults.                                                                                        |
| CC-007 | [Synthetic comparison](evidence/cloudcompare-20261028/synthetic-alignment-comparison.json)            | Independent 437-pair RMS goes from 0.525443 mm to approximately 1.394e-6 native and 8.026e-7 ScanForge. Known truth, Float32 precision and transform errors retained. Not real scanner accuracy.                                                |
| CC-008 | [Bounded real comparison](evidence/cloudcompare-20261028/owner-ply-sampled-comparison.json)           | Native 85% fit reduces broad RMS but worsens close-overlap RMS on 5,000 deterministic real vertices. ScanForge 15% retains the close fit; 85% refuses unchanged. No real-scan ground truth.                                                     |
| CC-009 | [Meshing report](CLOUDCOMPARE_PROJECTED_MESHING.md)                                                   | Native and ScanForge match all 437 Float32 vertices and 772 triangle vertex sets on the projected curved-surface fixture. Shared GUI/public MCP output, Undo/Redo and cutoff refusal verified. General 3D reconstruction is outside this route. |
| CC-010 | Native `poisson-*` captures and output in the evidence folder                                         | Normal-free input is rejected; outward-normal sphere reconstructs to 3,992 vertices and 7,980 triangles at depth 8. General scan/open-surface quality and density trimming remain open.                                                         |
| CC-011 | [Full-source timeout](evidence/cloudcompare-20261028/full-ply-test-timeout.txt), native owner receipt | The existing ScanForge full PLY test failed its 300-second timeout; native 15% real ICP also timed out at 120 seconds. Smaller passing checks do not close either gate.                                                                         |

REA's process capture also explicitly rejects native Windows because descendant
cleanup is not yet verified by its adapter. Native runtime evidence here comes
from direct Windows GUI observations and CLI output, separately identified from
REA shipped-artifact records. No REA configuration was repaired or replaced.
Ghidra's retained ICP dossier has partial indirect-call/value-flow coverage;
its 90,493-character pseudocode was paged after a transport-size rejection,
without repeating the analysis. The exported bundle retains the full record.

The core evidence IDs are
`ev_1ec95206cb72dd1fdb8eb1a007980bddc7a473b02ee13fced15c11cf9cb5b00c`
(exported procedure inventory),
`ev_9cffe8eddc073689a052eef219560919d9cdb35c4e8716786a2e1d002b33652d`
(projected triangulation),
`ev_78e6ab616e3bdb8815860617dfaf41f2d7d6abb0d3cd0475c062d98c513550bb`
(3D edge pruning), and
`ev_f2605b43f2af482033e3fd679ea82bc8afa54612234440b7c180b4365ef5a74c`
(ICP dossier with the stated coverage limits). Native GUI/CLI receipts have
their own file identities and are not assigned invented REA Evidence IDs.

The [Poisson report](CLOUDCOMPARE_POISSON.md) and its
[independent quality receipt](evidence/cloudcompare-20261028/poisson-sphere-quality.json)
record a closed one-component sphere mesh with no boundary edges, vertex radial
RMS of 0.006502 mm and a one-way continuous mesh-to-sphere maximum error of
0.028311 mm. This is native CloudCompare output, not a ScanForge Poisson feature.

## Implementation and MCP coverage

The shared fine-alignment solver now refuses publication when final coverage
misses the requested overlap, including clouds without normals. It reports
`insufficientOverlap`, `converged:false`, `applied:false` and leaves history
unchanged. Initial distance-gated coverage may still improve during fitting.
Self-alignment is rejected by the shared trusted-input layer. The GUI separates
advanced ICP settings and indexed refinement controls and labels moving/fixed
roles. Public MCP accepts a minimal `icp` operation with the same 10 mm shared
search-distance default; old explicit requests remain valid.

Projected point-cloud meshing is a new `mesh_process` operation through the same
application executor/worker used by the GUI. It preserves the source and creates
one mesh/history entry. Its projection, edge limit, results, limits and failure
states are discoverable in the catalog and [agent guide](AGENT_GUIDE.md).
The [architecture](MCP_ARCHITECTURE.md) documents both paths. Delaunator is ISC
licensed; no GPL CloudCompare implementation was copied or linked.

Production build passed. Focused tests, actual isolated WebGL GUI interactions
and public MCP checks passed; receipts distinguish real worker execution from
mocked worker-transport tests. The existing browser/server at port 5173 serves a
different checkout and was preserved. Browser validation used the verified
current checkout on port 5187 and disposable profiles. Its first stale-server
failure and meshing harness failures remain recorded.
The [validation receipt](evidence/cloudcompare-20261028/validation.json) links
the checks, source-input hashes, production build output and failed gates.

## Existing ScanForge evidence

The current checkout contains `ORIGINAL_STL_GLOBAL_CURRENT_QUALITY.md` and its
structured receipt. They report GUI preview/public MCP cached apply and improved
fixed-support RMS, while explicitly retaining false convergence and open native
comparison gates. They are historical evidence for that recorded candidate,
not measurements of changes from this investigation.

## Status at 2026-10-28 (superseded by the completion record)

The focused alignment and 2.5D meshing changes are implemented and validated
within the recorded scopes. The continuation removed repeated triangle-distance
evaluations from the shared alignment query without changing traversal winners,
normals or boundary classification. The original full-source real PLY regression
passed in 122.96 seconds with its unchanged 300-second deadline and input hashes.
Per-face visit memory is included in the existing 128 MiB worker-pool admission.
The [query performance receipt](evidence/cloudcompare-20261028/query-performance/receipt.json)
retains the exact 10,000-hit oracle, profiles, focused tests and reproduction driver.

The [meshing continuation receipt](evidence/cloudcompare-20261028/meshing-continuation/evidence.json)
records three in-worker cancellations without mutation, actual worker closure,
a successful 500,000-point successor and pre-worker rejection of 500,001 points.
GUI/public-MCP geometry, preserved source normals and Undo/Redo matched on a
333-point real scan patch. Independent topology analysis found 11 components and
193 boundary edges: this remains sparse, coverage-limited meshing evidence.
A browser regression also caught a successful commit being misreported as
cancelled after output selection; the GUI adapter now uses the existing commit
guard and reports the shared operation's successful result.

This is not full CloudCompare equivalence or closure of native/global-alignment
milestone gates. General 3D/Poisson implementation, physical convergence, native
nonunit scaling and preview/cancel comparison remain open. The native 15% owner
scan timeout remains recorded. Unrelated working changes are preserved; no
commit or merge was made.
