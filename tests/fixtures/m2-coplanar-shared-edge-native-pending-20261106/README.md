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

On the same Float32 STL inputs, the current shared ScanForge operation returns eight faces with three matching intervals on both sides of the shared edge. This is a native difference, not a parity pass. Existing browser tests exercise GUI and public MCP lifecycle on the related JSON-number control; those tests do not establish native parity for these imported bytes. The user directed preservation of safety checks for prior native Split differences; no unsafe native topology is adopted here. This one fixture does not establish general Split behavior or milestone acceptance.
