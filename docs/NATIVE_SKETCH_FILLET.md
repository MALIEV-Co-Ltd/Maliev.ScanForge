# Fixed-radius sketch fillets

The retained reference manual (SHA-256 `acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`), printed pages 68–69, distinguishes Corner Trim, Auto Fillet and Fixed Size Fillet. Its example enters a 2 mm fixed radius, creates the fillet and undoes it. Pages 71–72 separately describe automatic corner/fillet recognition. This establishes the fixed-radius capability and undo workflow, not native numerical tolerances or relation-transfer rules.

The application implements an analytic internal fillet for two explicitly selected straight-line ends. Retained rays run from their infinite-line intersection toward the opposite endpoints. Tangent setback is `r*cot(theta/2)`; the circle center lies on the internal bisector. Stable half-angle expressions and local precision checks reject unresolved or collapsed results. The output preserves line IDs and unrelated records, splitting a shared selected corner point where necessary and adding one analytic arc. One shared guarded GUI/MCP operation publishes one sketch edit.

Affected constraints, unrelated endpoint sharing and mixed construction policies are rejected explicitly. Automatic radius fitting, native area-selection gestures, automatic dimension creation, line/arc fillet combinations and native numerical/constraint-transfer equivalence remain open requirements. This bounded implementation does not complete the broader sketch milestone.

The public CAD reference inspector exposes actual kernel cylinder radii so an extrusion can be checked independently of its sketch recipe. Exact kernel mass is not exposed; mesh volume remains approximate. Actual validation results must be recorded separately after execution.

The [validation record](SKETCH_FILLET_VALIDATION.md) records the accepted build, full suite, physical-radius kernel regression and public GUI/MCP workflow.
