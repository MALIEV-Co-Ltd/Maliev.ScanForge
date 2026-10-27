# M5 exact CAD edge discovery

Fillet/chamfer currently require unexplained kernel edge indices. Add bounded
paged edge references to existing read-only `cad_inspect`, then consume them in
the GUI edge-treatment panel. Keep omission backward compatible. Return the
inspected revision so references can be used with guarded modeling commands.

Use the first unique `IsSame` EDGE encounter order of `edgeShape`, including
degenerate edges. Extend the existing diagnostic topology pass, preserving the
64 MiB BREP, 200,000 visit and kernel lease limits. Maximum page size 128; return
index, curve type/kind, degeneracy, parameter-order endpoints and kernel bounds
including tolerance. Expose exact length only after validating a bound API on
straight and curved edges; endpoint distance is not curve length.

Inspection remains in its disposable worker without registering or meshing
native shapes. Delete duplicate traversal wrappers immediately and retire all
per-edge adaptors, points, bounds and property handles on every exit. No mutation
or history entry. A rebuild invalidates prior references.

- [x] Probe length/curve bindings and retain actual-kernel straight/circular tests.
- [x] Red→green worker pagination and saved-BREP/live index equivalence for box,
      cylinder/seam and Boolean/split results; use a discovered edge in actual
      fillet/chamfer and verify intended geometry changed.
- [x] Extend typed client, optional catalog fields and read-only inspection
      operation; test bounds, stale/cancel/failure cleanup and unchanged defaults.
- [x] GUI discovery/page selection through shared job; guard stale source/revision
      and provide meaningful geometric identification. Replay GUI/public MCP.
- [x] Update agent guide/architecture/acceptance, run affected checks and review.
      Standard build, 49,031 unit tests (64 skipped), CAD smoke and built public
      MCP/GUI edge/ribbon/paging/stale/cancel checks pass. Two static reviews pass.

Broader native, compatible joins, supported blends, sketch chain and M4 gates
remain open. This plan does not authorize closing M5 from index discovery alone.
