# Coplanar shared-edge native control

On 2026-11-06, QUICKSURFACE Pro 8.0.123 imported the source and cutter in millimetres. With the source in Edit, Split Mesh selected the cutter, Envelope was unchecked, and Preview and OK were applied. The source changed from two to four triangles; Edit reported two individual meshes. The project was saved and the visible source and cutter were exported separately. Reopening the saved project showed the source with four triangles, the cutter with one, and two individual source meshes in Edit. This reopening observation does not independently re-export or compare geometry bytes.

| File                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `source.stl`                      | `1f062fa356f8cf9145d9d9fdfc236031c23acb0f2c416444db20555d063d5ac5` |
| `cutter.stl`                      | `d1520467d19d1aed82ff52d74218fd773f557ad36c4ada1eb1b99ecc5bb098b0` |
| `native-source-split.stl`         | `fd467c80acc748d993bf1a4cfffb77a872a1c476d9a8dad8bf528b81f20b7883` |
| `native-cutter.stl`               | `f1cae3c8bbb9b9a376312509876ad88d4b25757d65018e74f59493431596833c` |
| `coplanar-shared-edge-native.qsf` | `af5ebaaa346b469c5c8c6d3417bf50abbe6f0f23c9de5c8a994facbe38ab84fd` |

The QSF source block contains eight indexed vertices and four faces; its expanded facets match the native source STL. One source face is split at approximately 0.3 and 0.7 along the shared edge; the adjacent face retains the complete edge with separately indexed endpoints. Thus the native result has a disconnected, nonconforming shared edge. The cutter export retains the input triangle's coordinates.

On the same Float32 STL inputs, the current shared ScanForge operation returns eight faces with three matching intervals on both sides of the shared edge. A production-browser run imported the exact hashed STL files through public MCP and exercised GUI and public MCP Split, geometry equality, undo/redo, binary reopening and cancellation. Its independent area check was 1, it reported no page errors, and its Job peak was 891,867,136 bytes with owned processes and ports cleaned up. The [bounded receipt](C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-native-ui-tools/coplanar-stl-replay-fixed-20261106.json) has SHA-256 `aa4b2a5f529f9fb6ac6544bc9a2c5dbab93222e1434f2e7200ba4eed8234853b`. A separate run of the default JSON-loading path also passed. The browser plugin was unavailable; the repository's isolated Playwright workflow was used.

This is a native difference, not a parity pass. The user directed preservation of safety checks for prior native Split differences; no unsafe native topology is adopted here. This one fixture does not establish general Split behavior or milestone acceptance.

## Boundary projection control

On 2026-11-07 the saved QSF was reopened, the cutter hidden, and the source selected. In Edit Scan, a single click on the additional tool whose tooltip is `Project the mesh boundaries on OXY plane` flattened the visible vertical face without creating a visible sketch. The source export is `native-after-boundary-projection.stl`, SHA-256 `d09992b1cf2596a3147a5a9dd427060949ffc51d6e10f36f78835b4dcecbc1b7`. Its four face records retain the baseline vertex triples except that the fourth face's first vertex moves from `(0,0,1)` to `(0,0,0)`, coinciding with its second vertex. A previous sequence involving triangle and boundary selection yielded an identical export; the single-click replay used neither selection. The original QSF hash remained unchanged, and the duplicate export was removed.

This is evidence of an in-place mesh change on one fixture, including a degenerate face. It does not establish the general native algorithm or the behavior of selected boundaries. The existing ScanForge `boundaryProject` contract produces projected curve artifacts and optional sketches; the native action above is not established as equivalent. Retain safety checks and do not claim native parity based on this control.

A second control uses `projection-interior-control.stl` (SHA-256 `01557778e9cd095a62c89bd570b11f5ccffaa146af835a9c3a850af8426d70b7`): four triangles join a square boundary at Z=1 to one interior vertex at Z=2. QuickSurface imported it in millimetres, reported one individual mesh and one hole, and ran the same additional tool once without selecting triangles or boundaries. Export `projection-interior-native.stl` (SHA-256 `46079db65546aa2a08c4981a166d24fb948633178b809330335f5e9bbee5231a`) preserves all four face vertex orders and XY coordinates; the boundary vertices move to Z=0 while the interior vertex stays at Z=2. These two controls do not establish behavior for transformations, selected boundaries, nonmanifold meshes, or other orientations.

Reimporting that control, disabling connected-triangle selection, and painting one visible triangle red before projection produced an export with the same SHA-256 as the no-selection output. The selected face remained visibly red after projection. The screenshot does not establish an independent numerical selection count; this one selection does not prove behavior for all selection masks.
