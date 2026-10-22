# Sketch paint-trim evidence and implementation

The retained reference manual (SHA-256 `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`), printed pages 74–75, describes holding the left mouse button and painting unwanted primitive portions, including concentric circles intersected by a line. This establishes the documented workflow. It does not establish brush radius, numeric tolerances, coincident/tangent ambiguity or constraint deletion/transfer.

The application uses one analytic helper for transient GUI preview and the guarded `sketch_trim_stroke` operation. It computes finite-domain line/line, line/circle and circle/circle intersections, partitions the original geometry and tests the stroke's capsule union analytically. Rendering samples do not choose intersection coordinates or erased intervals. Logical circles represented by compatible arc pairs are periodic; artificial seams are not trim stops. Retained arcs preserve their center and direction; untouched records retain source order. Affected constraints and ambiguous overlaps are rejected explicitly, with bounded work and cancellation before publication.

This implements the documented interaction with stated application policies. It does not prove native numerical equivalence or undocumented native policies. Actual validation commands, GUI/MCP evidence and source/build identity belong in the candidate report; the broader construction/sketch milestone remains open. Two-line Corner Trim remains a separate operation, and corner arc intersections and fillets are still independent requirements.

The [application validation record](SKETCH_PAINT_TRIM_VALIDATION.md) records the accepted production build, full suite and public GUI/MCP browser workflow.
