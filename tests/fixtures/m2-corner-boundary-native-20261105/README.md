# Corner-to-boundary native split

QuickSurface Pro 8.0.123: import the source and cutter in millimetres, edit the source, split by cutter with Envelope off, preview, and accept. The cutter intersects the source from (0.0004, 0.0004, 0) to (0.5, 0.5, 0); the cutter plane contains the source corner (0, 0, 0). QuickSurface reports two individual meshes. The saved QSF has six indexed vertices and two disjoint triangle index sets; its expanded facets match the native STL export. The cutter export retains the input facet.
