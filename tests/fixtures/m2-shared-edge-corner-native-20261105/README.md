# Shared-edge near-corner split

QuickSurface Pro 8.0.123, millimetres: import `source.stl` and `cutter.stl`, edit the source, split with the cutter and Envelope disabled, preview, and accept. Save `session.qsf` and export each mesh. The cutter round trip preserves its input facets.

The source has two triangles sharing the edge from (0, 0, 0) to (1, 0, 0). The cutter meets that edge at (0.0004, 0, 0) and terminates inside the upper face at (0.4, 0.3, 0). Native produces four source facets: the untouched lower face and three upper-face facets using the original corner, with one indexed shared edge from the corner to the interior endpoint. The QSF indexed source and STL export agree. ScanForge currently retains the near-corner edge contact and produces six facets, including a subdivision of the lower face.

Reopening the saved QSF in QuickSurface retains both meshes and reports four source triangles and one cutter triangle. The saved indexed block and exported facets, rather than that tree count alone, support the geometry comparison.

This fixture demonstrates one shared-edge case; it does not establish behavior for every corner, scale, source topology, or selection boundary, and it does not justify relaxing source-coverage checks.
