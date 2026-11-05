# Folded boundary junction: QuickSurface control

QuickSurface Pro 8.0.123 imported the source and cutter as millimetres; Split Mesh used the cutter with Envelope off. The cutter's shared vertical edge meets the source at (0.0004, 0.0004, 0), with other endpoints at (0.5, 0.5, 0) and (0.6, 0.4, 0). Preview and acceptance produced three individual meshes and three source facets. The saved QSF has nine indices across three disjoint triangles, matching the exported source STL. The independent cutter export retains the input facets. The QSF has not been reopened in QuickSurface.

The second boundary point is stored as Float32 values whose sum is slightly greater than one; this observation is confined to these exact input bytes. A two-piece exact-intersection result is not the native result for this case. This does not establish general safety for association on other cuts or large scans.
