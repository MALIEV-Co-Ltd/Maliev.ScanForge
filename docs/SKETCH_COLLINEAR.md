# Collinear sketch segments

Choose **collinear** in the sketch Constraint menu, select two different straight
segments and add the relation. Their infinite supporting lines coincide. The
segments may be separated, overlap, point in opposite directions or be
construction geometry. Endpoint IDs and lengths remain independent; this does
not trim, extend or weld the sketch.

Agents use the same `sketch_set` operation with `solve:true`, adding
`{id:"relation-id",kind:"collinear",first:"segment-a",second:"segment-b"}` to
the Sketch v1 constraints. Send the usual `expectedRevision` and `requestId`.
`sketch_get` returns the relation and solved points; the response also contains
convergence, conflicting IDs, maximum residual and local degrees of freedom.
Unsolved constraints leave the active sketch and project revision unchanged.
The existing sketch Undo/Redo and project save/reopen paths retain the relation.
Model history remains separate.

Both references must be straight segments with distinct IDs, finite geometry
and lengths at least 1e-10 mm. Invalid references and zero-length segments fail
validation even with `solve:false`. Arcs are not accepted. The shared solver adds
two signed distances from the second segment's endpoints to the first segment's
supporting line, in local UV millimetres. It retains the existing 1e-6 solver
residual tolerance; extrapolation against the other reference can amplify that
error. Degenerate trial lines cannot become successful solutions. Placement,
unrelated records and existing constraints remain authored data.

Native command **Make Colinear**, `0x84c3`, inserts relation kind 19. The recovered
duplication controller copies this kind when both curve references have copies;
see [the native duplication evidence](NATIVE_SKETCH_DUPLICATION.md). That static
mapping establishes the missing capability, not native solver equations or
numerical equivalence. The residual formulation and degeneracy threshold above
are application policies. Native numerical comparison and complete duplication
remain open acceptance gates.

Validation passed: 16 new tests, 148 focused tests, the production build, CAD
smoke checks and the full suite (47,683 passed, 64 skipped). A source-pinned
rendered browser/public-stdio-MCP run produced exactly matching solved points
on offset OXY, OYZ and OXZ planes, preserving IDs and placement. Retry protection,
one sketch Undo/Redo, separate model history, GUI/MCP conflict atomicity and
project save/reopen passed. The browser job peaked at 580.3 MiB under a 4 GiB
limit and 25% CPU cap; all 17 owned processes exited, handles and three ports
closed, and cleanup reported no errors. GPU readback warnings and bridge teardown
errors were recorded; no workflow page exceptions occurred. Offline caching was
not validated. A read-only independent review found no remaining actionable
issues after checking the executed private harness.

The fresh user-facing app also imported the exported three-plane project and
successfully reapplied this constraint through the GUI. See
[the structured evidence](evidence/sketch-collinear.json).
