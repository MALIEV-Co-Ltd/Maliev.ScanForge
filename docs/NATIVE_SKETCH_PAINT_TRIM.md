# Sketch paint-trim evidence and implementation

The retained reference manual (SHA-256 `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`), printed pages 74–75, describes holding the left mouse button and painting unwanted primitive portions, including concentric circles intersected by a line. This establishes the documented workflow. It does not establish brush radius, numeric tolerances, coincident/tangent ambiguity or constraint deletion/transfer.

The application uses one analytic helper for transient GUI preview and the guarded `sketch_trim_stroke` operation. It computes finite-domain line/line, line/circle and circle/circle intersections, partitions the original geometry and tests the stroke's capsule union analytically. Rendering samples do not choose intersection coordinates or erased intervals. Logical circles represented by compatible arc pairs are periodic; artificial seams are not trim stops. Retained arcs preserve their center and direction; untouched records retain source order. Affected constraints and ambiguous overlaps are rejected explicitly, with bounded work and cancellation before publication.

This implements the documented interaction with stated application policies. It does not prove native numerical equivalence or undocumented native policies. Actual validation commands, GUI/MCP evidence and source/build identity belong in the candidate report; the broader construction/sketch milestone remains open. Two-line Corner Trim remains a separate operation, and corner arc intersections and fillets are still independent requirements.

The [application validation record](SKETCH_PAINT_TRIM_VALIDATION.md) records the accepted production build, full suite and public GUI/MCP browser workflow.

## Native ordinary arc replacement follow-up

Static menu resources bind **Trim (T)** and **SketchTrim** to command `0x82fc`.
Its selector branch `0x14070ae05` activates mode 7. The motion dispatch table
connects that mode to `0x14071ad23`, which reaches trim dispatcher
`0x1403a43d0` through call `0x14071aed6`. This binds the investigation to paint
trim; it does not establish complete brush admission or intersection-cache rules.

The ordinary arc branch tests virtual `+0x38`. It extracts original start,
through, end and center as four consecutive XYZ triples through `+0x180`.
That vector has stride `0x18`, unlike the `0x50`-byte control records used by
duplication's anchor calculation.

For the removed parameter interval bounded by L and U, the retained side before
it is constructed from `oldStart, evaluate(L/2), evaluate(L)`. The retained side
after it uses `evaluate(U), evaluate((U+1)/2), oldEnd`. Both arc branches call the
known three-point setter `0x1401e4d70`, with the supplied frame and final flag
false. Evaluation follows the concrete inner delegate's normalized curve
parameter conversion, `first + (last-first)*clamp01(t)`. These are parameter
midpoints. The original through point influences the original arc geometry but
its authored point identity is not carried into the replacement pieces.

For ordinary nondegenerate chords around the evaluated midpoint, an absolute
direction dot product strictly above `cos(0.0008726646259971648)` selects a line
replacement instead. Ordered equality takes the arc branch. Normalization is
guarded by length `>=2^-52`; shorter chords skip it, so this description is not
a general degenerate/NaN policy. The cosine attribution uses the earlier static
CRT import inference; no native cosine output or fresh live binding was captured.
The line setters are called at `0x1403a5487` and `0x1403a57b3`. Helper
`0x1403a4180` remaps relations; it is not a geometry constructor. Complete
relation transfer and constructor-success handling remain unestablished.

REA retained a 13,594-byte noncontiguous dispatcher body. Its high-P-code is
truncated, 94 call references or decoded calls lack resolved destinations, and two reported
terminal calls have unknown no-return bases. A transport-budget error affected
delivery, not record retention: the record was exported without repeating the
analysis. Selected menu templates, 50 instruction anchors, four constants,
eight synthetic cases and three redecoded instruction mutations passed the
independent checker. The checker peaked at 104.32 MiB under its existing 4 GiB
Job policy and cleaned up. The analysis provider closed with no cleanup pending;
its owned Java process exited. Independent review found no blocking issue in
the scoped ordinary nondegenerate arc reconstruction.

This establishes a replacement-state rule needed by the pending through-point
model correction. That evidence-only checkpoint did not change application/MCP
behavior or rerun a build, unit/CAD suite or browser workflow.
See [the structured arc trim contract](evidence/sketch-paint-trim-arc-contract.json).

## Shared ordinary-arc classification candidate

The pending application change applies the chord-direction line fallback to
retained nonperiodic arcs in the shared trim helper. It uses evaluated start,
parameter midpoint and end positions, guarded reciprocal normalization and
the strict threshold `0.9999996192282494`. Small and nearly full sweeps can
both qualify. The installed system CRT cosine component returned this exact
Float64 value (little-endian `0c219333ffffef3f`) for the angle above. The
component capture verified the installed DLL hash, export RVA and loaded entry
bytes before calling it; this does not establish a live reference-process
binding or native trim numerical equivalence.

GUI preview and the guarded `sketch_trim_stroke` executor share the helper;
`sketch_get` exposes the resulting segment, curve ID and construction flag.
Periodic circles retain their existing policy. Centers are pruned only when
unreferenced, and existing constraint rejection, cancellation, resource bounds,
revision checks and retry semantics remain in the shared operation.

This candidate still requires rendered GUI/MCP boundary verification before
acceptance. The earlier application validation record describes its own
checkpoint, not this candidate. Native through-point reconstruction, complete
trim numerical equivalence and relation-transfer parity remain open.
