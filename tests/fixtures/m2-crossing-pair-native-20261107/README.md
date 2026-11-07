# Crossing-pair control

QuickSurface Pro 8.0.123 imported the source triangle and cutter triangles 2
and 4 from `m2-crossing-pivot-native-20261107`. With envelope off, Split Mesh
used the hidden cutter, then Preview and OK. The native source changed from one
to eight triangles, the scene was saved to `crossing-pair.qsf`, and the visible
source was exported to `native-result.stl`.

The shared ScanForge operation returns ten triangles. At a 1e-6 distance
tolerance, native output has no edge along the first cutter's intersection;
ScanForge retains that intersection, and both outputs contain edges along the
second intersection. Six Float32 facets match. This finite control does not
establish general native behavior or full GUI/MCP acceptance.
