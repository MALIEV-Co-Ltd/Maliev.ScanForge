# M5 shared compatible patch joins

GUI joins currently compute against a panel-local imported patch, then publish
through a generic setter/rebuild. MCP `surface_operation` requires a workspace
reference ID and rejects exact targets. Route both through the same join branch.

Extend existing `surface_operation` join with exactly one of `referenceId` or
bounded `referencePatch`. Require a target and the existing C0/C1 options. Permit
unlocked mesh patches and exact targets authored by a `surface` recipe; preserve
other operations' mesh-only guard. Compute `joinPatchBoundary` once. Raw reference
input and workspace reference geometry stay unchanged. Locked references are
readable; target/affected dependent locks reject before native work. Reject
self-reference and exact-target downstream references that rebuilding would move.

Extract the existing context-aware `cad_rebuild` handler for reuse by the exact
join, including signal, revision fence, normalized publication and late-created
handle cleanup. Do not nest API jobs. Mesh joins retain source association and
existing derived-cache invalidation. One accepted join adds one history entry.

Return representation, applied options, reference source, changed control indices
and exact rebuild/cleanup results. This materializes a patch; it does not create
a persistent seam dependency. C1 means the helper's normalized transverse
homogeneous derivative match, not a general blend/G2/native equivalence claim.

GUI passes its imported reference/options to an async shared callback and reports
success only after completion. Bound repeated submission and own cancellation;
retain the existing tool and kernel leases. Agents can supply the same raw input
or use a workspace reference.

- [x] Red→green mesh/raw-reference and exact joins, reference preservation,
      changed-control output, source association, locks, self/downstream guards.
- [x] Share the existing guarded rebuild publication path and extend schema.
- [x] Route GUI join through shared operation with owned cancellation.
- [x] Built GUI/public MCP parity on mesh/exact targets, both reference forms,
      incompatibility/errors, Undo/Redo, exact BREP and project/STEP persistence.
- [x] Update agent/architecture/acceptance docs, build, affected/full checks,
      review and retain receipts before pushing.

Native operation/continuity/blend acceptance, the sketch chain and M4 dependency
remain independent milestone gates.
