# M5 exact surface retained-region trimming

## Requirement and evidence

Issue #5 explicitly includes trimming/joining. FEATURE_EVIDENCE.md records the
reference workflow as selecting retained regions from intersecting surfaces
(manual pages 110-118 and 132-136). Existing `split` requires source/cutter solids;
it does not satisfy open-surface trimming. Do not close M5 by relabeling it.

The installed OpenCascade 1.1.1 bindings include BRepAlgoAPI_Splitter,
BRepBuilderAPI_Copy and BRepExtrema_DistShapeShape. The private probe at
`.resources/m5/kernel-bindings-probe.mjs` split a 100 mm2 XY face with a crossing
YZ face into two valid 50 mm2 faces. SetNonDestructive alone changed the source's
serialized BREP representation (geometric mutation was not established). Deep
geometry copies of both inputs preserved the original BREP exactly. A vertex-to-
fragment distance query is available. No native QuickSurface parity is claimed.

## Design

Add a single-output `trimSurfaces` CAD recipe with `source`, `cutters`,
`keepPoints` in world millimetres and `toleranceMm`. The splitter uses deep copies,
and each keep point identifies the uniquely nearest resulting face region within
tolerance. Multiple points can retain multiple regions; duplicates deduplicate.
Points on a shared cut boundary are ambiguous and reject. Nonintersecting/touching
cutters, off-surface points, invalid inputs and resource exhaustion reject before
publication. Results are exact selected face geometry, not a solid-volume split
or a tessellation replacement. Source solids remain original inputs; surface
trim returns selected surface regions. Solid cutting retains the existing split
operation. Keep-point references are explicit world coordinates; dependency edits
that invalidate them fail atomically rather than silently choosing another region.

The feature DAG keeps source/cutter refs and all parameters. Existing cad_create
and cad_rebuild expose the full contract. One accepted action adds one history
entry; default GUI presentation hides inputs and selects the new result through
existing options. Original BREP, arrays, IDs and Undo handles are preserved.

A dedicated Trim surfaces panel selects CAD cutters and retained points. Reuse
the existing one-shot point-pick callback, which preserves selected source during
the gesture. Numeric points remain editable; MCP uses viewport_pick or explicit
coordinates. Escape/closing cancels an uncommitted point-pick/draft. The Apply
button dispatches the shared CAD recipe, with existing revision/retry/job cancel
semantics. Do not advertise a separate unsupported preview contract.

Bound source/cutter face counts, estimated pair work, split output count and
point-to-face query work before allocations/queries. Retain the kernel lease and
all existing process/resource guards. Register only BRepCheck-valid output.

## Implementation and verification

- [ ] Add failing actual-kernel cases: plane/plane retained halves, multiple kept
      regions, curved surface/cutter, ambiguous and off-surface seeds, no intersection,
      exact input BREP preservation, invalid result rejection and native cleanup.
- [ ] Implement bounded copied-input splitting and typed CadClient request.
- [ ] Add recipe dependencies/validation/evaluation and both catalog recipe
      schemas; test deterministic rebuild, lock/revision/retry/error atomicity.
- [ ] Add discoverable GUI command/panel and point-pick lifecycle, using the
      shared operation. Update agent guide, architecture and capability matrix.
- [ ] Replay GUI/public MCP with actual point clicks and exact area/topology
      comparison, Undo/Redo, dependency rebuild, STEP/project persistence and failure
      recovery. Run affected build/checks and review before pushing.
- [ ] Compare approved native workflow/settings using matched real input once
      native ownership and computer-use initialization are available. Keep this gate
      explicit; synthetic/OC tests cannot establish QuickSurface equivalence.

M4 dependency acceptance and broader M5 operation-matrix gates remain unchanged.
