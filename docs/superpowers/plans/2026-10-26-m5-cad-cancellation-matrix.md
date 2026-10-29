# M5 CAD cancellation and real-input operation matrix

The sketch workflow is verified at43f6637. The remaining release matrix needs
real-derived loft, sweep, revolve, Boolean, fillet, chamfer and shell evidence.
Existing generic GUI CAD creation/rebuild submits shared jobs but supplies no
owned AbortSignal or reachable cancel portal. Public MCP already has job_cancel.
Close that GUI recovery gap before describing the matrix as fully cancellable.

Use one App-owned controller for a GUI-started generic cad_create/cad_rebuild
job, forward its signal through runApplicationJobCommand, and show the existing
CadJobCancel portal outside the busy inspector. Detach ownership before unmount
abort; guard asynchronous state writes by owner identity. Output selection must
not abort publication. Keep API busy/revision/retry/history/native cleanup as
the sole modeling transaction; separate sketch/blend/export owners stay intact.
MCP coverage is the existing job_cancel and structured job_get/session_get state.

- [x] Observe a held GUI CAD job without reachable owned cancellation.
- [x] Implement the minimal shared-job ownership/portal wiring and document it.
- [x] Verify actual GUI create and rebuild cancellation, acknowledged late handle
      release, unchanged sources/history, recovery and normal publication.
- [ ] Replay all required CAD families using the retained real sixteen-point
      profile, independently derived masses/geometry, exact public edge/face
      discovery, matched GUI/MCP results/errors, history and exchange.
- [ ] Review the coherent patch, run affected/full hosted gates and retain scope.

Keep the existing browser180s/kernel90s deadlines, 4GiB/25% process guard and
coordinator admission. Native procedural/interoperability acceptance, seam/normal
claims, M4 dependency and final main integration remain separate open gates.
