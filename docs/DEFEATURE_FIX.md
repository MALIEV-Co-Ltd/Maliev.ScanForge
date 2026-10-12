# Defeature and repeated topology setup

## Cause and change

Defeature previously forced a flat fill. A noisy scanned rim is generally not
planar within the weld tolerance, so the filler skipped it and the parent
operation rejected the patch. The nested filler nevertheless emitted “Hole
filling complete · 100%” before the parent checked that all seams were filled.
Defeature now chooses flat/tangent filling automatically. It reports monotonic
operation-specific progress below 100% until repatching passes its checks.
Failures retain the source and replace the status with an explicit failure.
Folded, self-intersecting or overlapping seams still fail safely, with guidance
to use a smaller contiguous selection.

Each action previously created and terminated its own worker, discarding its
welded topology. Diagnostics, connected selection, selection morphology and
Scan Edit now share one geometry-scoped worker. Its read-only source topology
is reused at the same weld tolerance. Geometry array replacement or a changed
tolerance rebuilds topology. Defeature must still build topology for the changed
remainder before checking its new seams; that work is necessary.

The reusable worker expires after 60 seconds idle. Cancellation, decode/crash
errors and page exit release it. Valid operation rejections retain the cache
for another selection attempt. Concurrent work uses a separate disposable
worker; no unbounded worker pool was introduced. Active requests retain the
existing two-minute inactivity and fifteen-minute hard leases.

The error banner now wraps long text, limits its width and appears above
floating viewport tools. Existing unrelated stylesheet edits were preserved.

## Validation

- Build passed with zero warnings/errors. Focused scan-edit, client, diagnostics
  and panel tests passed; full suite passed 7,301 tests in 150 files.
- Regression recreates a non-planar annular selection around an existing hole.
  Explicit flat filling reproduces the old failure. Automatic defeature removes
  the hole, preserves unselected coordinates and produces consistent manifold
  edges. Rejected patch progress stays monotonic and below 100%.
- Real worker dispatch confirms warmed selection reuses topology without welding,
  and changed geometry rebuilds it. Client tests cover reuse through rejection,
  changed geometry, idle expiry, concurrent isolation and cancellation cleanup.
- Browser fixture: 16 selected triangles around a noisy rim; defeature reduced
  holes/boundaries from two to one. Selecting the entire mesh then correctly
  failed without changing geometry. Its banner was fully readable above the
  viewport toolbar at 1280 × 720; console warnings/errors were empty.
- Local proof: `.resources/defeature-error-verified.png`. QA tab 41 was closed;
  server PID 37760 exited gracefully and its lease ledger records cleanup.

The user's original STL and its 18,425-triangle selection were not available as
a reproducible fixture. Its exact timing and repatching result remain unverified;
the screenshot's failure path is reproduced with manufactured noisy geometry.
