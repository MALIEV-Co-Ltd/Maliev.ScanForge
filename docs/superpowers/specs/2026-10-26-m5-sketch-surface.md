# Exact planar surfaces from editable sketches

M5 requires a real scan→sketch→surface→solid chain. Current scan fitting bypasses
the sketch stage, and From 2D sketch remains planned. Add the missing exact
planar surface creation using the existing analytic sketch extrusion profile.

Use one single-output recipe `{kind:"sketchSurface",sketch:Sketch}` through
ordinary `cad_create`/`cad_rebuild`. The embedded snapshot retains placement,
constraints and scan-reference metadata. Solve centrally, reject unconverged
constraints, and use `sketchCurveProfile` for exactly one nonconstruction closed
line/arc cycle. Reference samples alone are not a profile. Preserve analytic
curves, original sketch IDs and authoring state; do not turn them into chords or
silently close gaps. Existing finite-coordinate, edge-count, radius, area and
right-handed frame limits remain authoritative. Holes and disconnected cycles
are outside the existing closed-profile contract and reject.

Extract the validated native wire/face construction from `extrudeCurvesShape`.
Extrusion keeps its existing prism behavior; the new operation transfers the
face directly to common exact validation/registration. Explicitly distinguish
the transferred face from temporary native wrappers in cleanup. Existing job
revision/retry/cancellation/late-result and resource guards apply unchanged.

GUI From 2D sketch gets a dedicated panel using the active/current editable
sketch, including saved-sketch selection. Admission is based on sketch state,
not selectedId: saved-sketch selection clears object selection. GUI, ribbon
command discovery and repeat admission must share this source gate. Creation
submits a cloned snapshot through the same CAD job and records one model edit;
it does not publish a separate solved-authoring edit. The panel owns cancellation
and aborts when closed, unmounted or its source changes; cancellation remains
reachable outside the busy inspector.

The face is independently editable by rebuilding its embedded sketch snapshot.
Later saved-sketch edits do not silently alter an existing feature. Existing
`thicken` creates the next face→solid feature dependency, then shared exact STEP
export completes the chain. Source scan, editable sketch, frame and references
remain preserved through Undo/Redo and project reopen.

Acceptance includes analytic rectangle/two-arc circle/mixed profile areas and
edge kinds, offset/rotated frames, invalid graph/constraint/radius/frame/resource
cases, unchanged authoring on failure, shared GUI/MCP geometry/history and
cancel/cleanup, deterministic rebuild and exact project/STEP persistence.
Actual real-scan section reference→authored closed profile→surface→thicken→export
must pass; native comparison and M4 release acceptance remain independent gates.

Existing M4 native evidence provides a reusable representative analytic baseline:
`reference-native-acceptance-20261026.json` records an actual exported native
circle solid, STEP SHA256
`acc7522d082692299a49b6cb288bb94185349c6cf537610de5beac567c534cae`, radius3mm,
centerXY(0.210029929876,0.06886227428913), OXY offset5mm and positive depth1.8mm.
Its independent application-worker extrusion comparison passed volume1e-7mm³
and bounds1e-6mm tolerances. Reuse that pinned native file for the new analytic
face→thicken chain when available, preserving the distinction between native
extrusion and native thickening. This does not replace the curved scan-derived
native solid comparison or the remaining operation matrix. M4's original-scan
section evidence alone contains reference geometry; authoring and validating a
closed real-input profile remains part of the new end-to-end acceptance.

GUI integration must cover `RIBBON_ACTION_IDS`, `ribbonVerification`, actual
command admission/discovery/repeat and the relevant tool-panel/UI schema, not
just the rendered ribbon button. `surface2dSketch` currently remains planned.
The existing `ParametricTools` inspector supports recipe editing through the
shared rebuild command; exercise that GUI path for the embedded sketch and a
dependent thickened solid. An analytic sketch face has no freeform NURBS control
grid: edit its sketch recipe or use ordinary exact CAD operations.

Source-snapshot ownership must survive output selection during publication;
do not abort a successful creation simply because the new face becomes selected.
Abort on actual sketch-source changes or panel closure, and keep owned cancel
reachable while busy. Preserve current/saved authoring without publishing an
extra solve edit. Real-input acceptance must actually author a usable closed
profile against the scan reference; importing or reopening reference segments
alone is insufficient. Retain the chosen profile, measured tolerances and the
distinct GUI/public-MCP results.
