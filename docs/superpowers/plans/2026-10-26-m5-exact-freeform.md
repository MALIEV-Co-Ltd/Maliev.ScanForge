# Exact freeform operation admission

GUI grid, quad import, knot/crease and snapping compute existing shared pure
surface helpers and submit `cad_rebuild` for authored exact surface targets.
`surface_operation` currently admits those operations only on mesh patches.
Use the same exact target guard and extracted rebuild handler already used by
joins for every patch operation. Preserve point-cloud rejection, source patches,
locks, dependent rebuilds, revision/retry/cancellation and late-handle cleanup.
Snapping without scanId uses the associated source when present, otherwise the
target display positions, matching the panel. Explicit source IDs retain their
existing validation. Mesh publication/cache invalidation stays unchanged.

- [x] Red/green API tests compare each result with the GUI's existing pure helper,
      preserve exact BREP/source data and one retry-safe history entry, and cover
      source defaults and exact guard/lock/cancellation failures.
- [x] Built actual GUI controls vs public MCP patch/BREP geometry, Undo/Redo and
      project persistence on exact targets, with invalid-input equivalence.
- [x] Agent/discovery docs, build, affected/full checks, review and receipts.

This is shared existing operation admission, not a new surface algorithm or
native continuity equivalence claim. Native/M4/sketch-chain/resource gates remain.
