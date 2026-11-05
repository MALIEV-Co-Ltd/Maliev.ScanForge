# Subdivided boundary-to-interior native Split fixture

QuickSurface Pro 8.0.123, millimetres, split source using cutter, Envelope off, Preview then OK. Source began as one triangle; cutter consists of two triangles whose contiguous on-plane edges run from (0.5, 1, 0) through (0.5, 1.15, 0) to (0.5, 1.3, 0). After Split, the UI reported six source triangles, one individual mesh and one hole. The cutter was hidden before exporting the visible source to STL; the saved native project retains both objects.

In this synthetic QSF, the source has six vertices and six faces. Both successive edges along the cut are shared by two indexed faces. The native STL facets match the expanded indexed QSF facets. The current ScanForge result does not preserve those shared indexed edges; the expected-failure test records that unresolved mismatch. This observation is specific to this fixture and does not establish general behavior for branching or separating cuts.
