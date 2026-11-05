# Folded near-corner junction: QuickSurface control

QuickSurface Pro 8.0.123, millimetres, Split Mesh using cutter, Envelope off: the source is one triangle and the cutter has two folded triangles sharing the vertical edge at (0.0004, 0.0004). Preview and OK produced one individual mesh with five source facets. The saved QSF and exported STL contain both cutter branches associated with source vertex (0, 0, 0); the original shared junction is absent. The independently exported cutter matches the input facets. After reopening the saved QSF in QuickSurface, the source still reported five triangles and one individual mesh.

This fixture establishes this small case only. It does not establish general corner tolerances, the safety of collapsing other segments, or large-scan behavior.
