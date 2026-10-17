# Smooth hole continuation implementation plan

Goal: avoid flat automatic caps on smooth retained collars that are not quadratic.

- Reproduce the supplied project using its final pre-fill revision and a local collar; preserve the original project.
- Add a regression with a non-quadratic smooth panel and verify failure before implementation.
- Add a bounded thin-plate interpolant using connected collar samples, retaining the angular safety gate, cancellation, fixed rim and existing triangulation limits. Keep sharp/unsupported collars on the bounded fallback.
- Expose diagnostics through the existing shared GUI/MCP fill operation and document the behavior.
- Build, run focused tests and the app suite, check formatting, then compare GUI/MCP geometry, undo/redo and screenshots using the real extracted collar.
- Commit only this slice; preserve unrelated dirty files. Helpers use finite leases and verified cleanup.
