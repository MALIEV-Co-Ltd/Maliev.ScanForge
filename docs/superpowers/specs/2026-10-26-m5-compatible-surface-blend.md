# M5 compatible transition surfaces

Issue #5 requires supported surface blends. Existing boundary joining modifies
one patch and creates no transition surface. Supply a separate editable exact
patch between two compatible NURBS boundaries using the existing rational
surface representation and exact CAD publication path.

Ruling: use a materialized NURBS bridge between compatible boundaries, matching
the existing join representation and normalized derivative convention. This
keeps source geometry immutable and uses the existing kernel face converter.
General CAD-edge blending and persistent multi-patch constraints would require
different topology/dependency contracts; this feature does not certify them.
G2 is outside this supported case and remains explicitly unimplemented.

Inputs are two validated bounded patches, boundary names u0/u1/v0/v1, C0 or C1,
and optional reversal of reference seam order. Along-boundary degree, control
count and normalized knots must match. Existing 2–16 control/degree1–5 limits
remain. C0 uses a linear transverse bridge; C1 uses cubic homogeneous Hermite
strips with outward reference and inward target normalized derivatives. Reject
nonpositive/nonfinite generated weights and invalid resulting geometry. Preserve
both input objects and their arrays, metadata, history-owned native handles and
saved BREP. Native validity remains mandatory before publication.

Extend shared `surface_operation` with `operation:"blend"`. It accepts the same
target and exactly-one workspace referenceId/raw referencePatch contract as
joining. The result is a NEW exact CAD entity authored by a surface recipe,
not a replacement for either input. It returns entityId/featureId,
representation, applied options and reference source; surface_get and cad_inspect
expose editable geometry and exact diagnostics. It adds one retry-safe history
step, preserves revision/lock/admission/cancellation/late-cleanup guards and does
not select a new entity while the panel's owned job is pending. Current target
lock restrictions remain; locked references are read-only inputs.

The GUI NURBS editor reuses the imported reference, boundary, reversal and
continuity controls and adds Create transition surface. Its operation and cancel
control use the existing shared job adapter. Existing join behavior is unchanged.
The created patch is materialized and independently editable; no persistent seam
or source dependency is promised. State/agent documentation must say this.

Acceptance: pure rational seam position/derivative tests across boundary choices,
reversed order and non-unit knot domains; incompatible/invalid-weight rejection;
input immutability; actual kernel face validity; shared API retries/history,
locks, failure/cancellation/cleanup; built GUI/public-MCP identical geometry;
project/STEP persistence and source preservation. Representative scan-derived
continuity and native comparison remain part of M5 acceptance rather than being
inferred from synthetic tests. No new dependency or resource-limit changes.
