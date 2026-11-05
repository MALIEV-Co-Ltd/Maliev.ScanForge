# Thin-face near-corner split

In QuickSurface Pro 8.0.123, import both STLs in millimetres, edit `source`, split by `cutter` with Envelope off, preview, and accept. The saved session contains five indexed source vertices and four faces, matching the exported STL. The exported cutter retains its input facet.

The edge contact (0.0004, 0, 0) is within 0.001 mm of both (0, 0, 0), an endpoint of its shared source edge, and (0, 0.0008, 0), the third corner of the upper source face. QuickSurface's result removes the contact vertex and joins the interior endpoint (0.3, 0.0002, 0) to all three upper-face corners. Both possible corner-to-interior edges are shared by two faces, so these saved facets and indexed topology cannot identify which corner, if either, the operation associated with the cut. An earlier ScanForge implementation preserved the edge contact and produced six facets.

An experimental first-matching-corner rewrite reproduced these four facets but destroyed an exact source-edge witness in an existing large-coordinate collector test; it was removed. This observation alone does not justify that rewrite or weaken the coverage checks.
