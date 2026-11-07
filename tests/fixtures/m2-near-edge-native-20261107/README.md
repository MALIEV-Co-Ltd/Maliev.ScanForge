# Near-edge native component control

`source.stl` is a binary STL with SHA-256 `e3a21262309a84818cb473cefaf93c6d4ee4d57924f452ccb1be8dc0cf2ab0f5`. Its two triangles are `[(0,0,0),(1,0,0),(0,1,0)]` and `[(1,0.0005,0),(0,0.0005,0),(1,-1,0)]` before Float32 encoding. Two pairs of edge endpoints are separated by approximately 0.0005 mm.

QuickSurface Pro 8.0.123 imported this file in millimetres into the existing scene. Its object information showed six points and two triangles; Edit Scan showed two individual meshes and two holes. The test object was hidden afterward and the original scan's visibility restored. Import automatically changed the view; no native output was exported.

ScanForge's native-indexed STL input reports six vertices and two one-triangle components. When the same Float32 coordinates are supplied without source topology and an explicit 0.001 mm weld tolerance, the shared inventory reports one two-triangle component; `tests/m2-near-edge-native.test.ts` retains that native comparison as an expected failure. This does not identify QuickSurface's general vertex-merging threshold or establish how it handles unindexed application geometry. ScanForge currently documents tolerance-based welding for unindexed input; changing that contract requires a separately verified connectivity policy.

Two additional binary STL controls put the near-edge coordinates on opposite sides of the recovered optimized reader's 1e-6 coordinate-key rounding boundary. The source triangles are `[(0,0,0),(1,0,0),(0,4,0)]` and `[(1,d,0),(0,d,0),(1,-1,0)]` before Float32 encoding. Their shared edge is positioned away from the fixture's spatial subdivision boundaries.

| File                    |  `d` (mm) | SHA-256                                                            | QuickSurface points / components / holes |
| ----------------------- | --------: | ------------------------------------------------------------------ | ---------------------------------------- |
| `key-boundary-low.stl`  | 0.0000004 | `453163693730696daee6ba369e5120885cc80ce04aeb467e64a48ea24cab2dc8` | 4 / 1 / 1                                |
| `key-boundary-high.stl` | 0.0000006 | `5806b2e9b2d8133755bc4a4d61c038c1fca4d4129dd7549b237686e7710005f6` | 6 / 2 / 2                                |

Both were imported in millimetres into the same QuickSurface session and then hidden; the original scan remained visible. ScanForge's recovered reader, GUI and public MCP match the recorded vertex and component counts for both controls. This behavior is consistent with the previously recovered coordinate-key rule in `src/scan-native-stl-vertices.ts`, but these two observations do not prove the rule for all coordinate ranges, subdivision boundaries, input formats or unindexed geometry.
