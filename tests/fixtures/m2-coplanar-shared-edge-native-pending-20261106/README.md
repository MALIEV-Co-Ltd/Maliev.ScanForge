# Coplanar shared-edge native control — pending

These binary STL inputs prepare the manufactured `coplanar-shared-edge` browser control for a QuickSurface comparison. They have not yet been imported or evaluated in QuickSurface, and no native result is claimed.

- `source.stl`: two triangles sharing the edge from (0, 0, 0) to (0, 1, 0); SHA-256 `1f062fa356f8cf9145d9d9fdfc236031c23acb0f2c416444db20555d063d5ac5`.
- `cutter.stl`: triangle (0, 0.1, -1), (0, 0.9, -1), (0, 0.5, 1); SHA-256 `d1520467d19d1aed82ff52d74218fd773f557ad36c4ada1eb1b99ecc5bb098b0`.

STL stores the coordinates as Float32, including rounded representations of 0.1 and 0.9; the existing browser fixture supplies JSON numbers. Compare ScanForge and QuickSurface using the same imported bytes, millimetres and Split Mesh settings, retain the native source and cutter exports plus saved project, and inspect shared-edge incidence and source coverage. A native result on these bytes does not by itself settle behavior for the JSON-number input or establish general coplanar overlap support.

The existing application control has three shared intervals for the Float32 input. An older browser run of the JSON-number input recorded four, including a midpoint. The current browser assertion still expects that older observation; neither observation is native evidence. See [the regression record](../../../docs/evidence/m2-browser-inventory-regression-20261106.json).
