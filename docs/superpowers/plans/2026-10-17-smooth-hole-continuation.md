# Smooth hole continuation implementation plan

Goal: avoid flat automatic caps on smooth retained collars that are not quadratic.

- Reproduce the supplied project using its final pre-fill revision and a local collar; preserve the original project.
- Add a regression with a non-quadratic smooth panel and verify failure before implementation.
- Add a bounded thin-plate interpolant using connected collar samples, retaining the angular safety gate, cancellation, fixed rim and existing triangulation limits. Keep sharp/unsupported collars on the bounded fallback.
- Expose diagnostics through the existing shared GUI/MCP fill operation and document the behavior.
- Build, run focused tests and the app suite, check formatting, then compare GUI/MCP geometry, undo/redo and screenshots using the real extracted collar.
- Commit only this slice; preserve unrelated dirty files. Helpers use finite leases and verified cleanup.

Follow-up acceptance: collar RMS and closed topology did not establish visual
continuity. The supplied repaired patch still had an 18.48-degree p95 seam angle.
Continue retained facet slopes with a screened correction that preserves fitted interior curvature, leave source
vertices fixed, and require a p95 seam angle below 8 degrees in both the varying
curvature regression and real-project GUI/MCP browser replay. Compare rendered
results before claiming the visible patch is resolved.

Fill reliability follow-up: an optional blending failure must not prevent an
otherwise valid refined patch from closing a hole. Restore the fitted candidate
on numeric/limit failure, retain cancellation, and pass the candidate through
normal winding and topology validation. Limit finite overshoots against the full
retained-support envelope instead of the narrower immediate-rim envelope. Expose
fallback and limiting counts through the shared GUI/MCP diagnostics, counting
only accepted fills. Test fallback recovery and cancellation explicitly.

Visual acceptance is separate from successful closure: the close-ups show a
substantial improvement, but a faint faceted strip remains in the default oblique
view. Do not describe the entire visual-continuity issue as fully resolved.
