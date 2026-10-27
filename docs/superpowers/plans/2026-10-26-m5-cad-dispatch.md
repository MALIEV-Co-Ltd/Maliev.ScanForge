# M5 shared CAD GUI dispatch

Review found that recipe-based GUI CAD creation/rebuilding, Boolean, revolve
and split call domain helpers or the kernel and publish directly. MCP uses
guarded application jobs. Both must use the same validation, revision fence,
retry semantics, cancellation and late-result cleanup before M5 acceptance.

Route existing GUI operations through `runApplicationJobCommand` with
`cad_create`/`cad_rebuild`. Resolve dependency references by existing feature ID
or imported entity alias without pre-publishing bindings. Preserve names, input
visibility, result selection, split output grouping and one history entry.
Retain the existing action busy/error presentation. No new modeling operation
or geometry algorithm is needed. Do not broaden ribbon verification claims
from the handler refactor alone.

- [x] Add a red built-browser check that GUI loft produces a discoverable shared
      application job, one history entry and the same exact result as public MCP.
- [x] Route recipe-based CAD creation, Boolean, revolve, split and rebuild.
- [x] Replay affected GUI/MCP paths, invalid inputs, exact inspection and history;
      build, affected tests and review. Add broader matrix evidence separately.
      48,983 tests pass, 64 skipped; standard build and CAD smoke pass. Review
      corrections preserve split names and unused sibling output visibility.
- [x] Reconcile command discovery with deliberate ribbon availability without
      silently removing useful existing agent modeling operations.
      Shared selection/busy/verification gates; actual core CAD ribbon matrix
      passes. Fillet/chamfer remain explicit experimental checks pending edges.

Separate acceptance gaps: usable edge identities for edge treatments; compatible
join input contracts; real scan/sketch workflow; native operation matrix and M4.
