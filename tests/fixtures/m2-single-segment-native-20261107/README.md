# Isolated cutter control

QuickSurface Pro 8.0.123 imported `source.stl` and the second triangle of the
four-triangle cutter in `m2-crossing-pivot-native-20261107`. With envelope off,
Split Mesh used the hidden cutter, then Preview and OK. The native source changed
from one to four triangles; the project was saved as `single-split.qsf` and the
visible source exported to `native-result.stl`. The ScanForge shared operation
produces the same four Float32 facets. In the prior four-cutter native result,
no output edge lies along this cutter's intersection at a 1e-6 distance
tolerance; this is an observation of these fixtures, not a general native rule.
