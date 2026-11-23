# Complete same-run numerical alignment replay

The source-mask correction candidate reproduces the complete numerical path of
the captured original-three native run at 0.500 mm. It starts with the captured
pre-alignment indexed meshes, derives normals and zero source flags through the
actual shared input core, prepares samples and targets, runs the actual local
and outer solvers, and applies their computed matrices through the shared datum
transform core. Captured query poses, correspondences and final matrices are
comparison oracles only; none is supplied as a solver or transform input.

The replay consumes the run's 3,901 sampler clock inputs and one outer clock
input. All 96 angular sample counts match. It generates all 45 query poses and
31,463 ordered correspondence records bit for bit. All six local results match
their native poses, diagnostics, flags and statuses. The two generated outer
passes reproduce the final source order and all three final controller states.

The computed descriptor transforms and common inverse-gauge transforms then
reproduce all nine complete after-state buffers: positions, vertex normals and
facet normals for each scan. All **40,278,222 Float32 values match byte for
byte**, including signed zeros. Triangle indices remain unchanged. The three
meshes contain 3,381,455 vertices and 6,663,164 facets.

Those exact normal streams are derived native geometry normals. The subsequent
[original-file and shared-staging comparison](NATIVE_GLOBAL_ORIGINAL_PLY_STAGING.md)
first confirmed all actual application positions and identified a discrepancy in
the display-normal cache. The stored-normal candidate now retains a separate
`geometryNormals` field and compares its staged/display buffers against the
native geometry-normal bytes. Authored scanner normals remain separate and
unchanged. Neither numerical comparison establishes visible rendering parity.

The earlier [evidence record](evidence/global-fine-complete-numerical-replay-20261023.json)
pins the source and tool inputs, original native trace, before/after capture
manifests, compiled core, private replay and resource receipt. The replay took
16,298 ms with an aggregate peak of 654,581,760 bytes under the unchanged 4 GiB
Job limit and 25% CPU quota. All owned child processes exited and handles closed
without cleanup errors. The candidate's scene estimate is 513,981,160 bytes,
below its unchanged 512 MiB admission limit. The earlier replay supplied captured
labels and exceeded that estimate; the connected candidate uses no captured
labels.

This verifies the shared numerical cores with the recorded environmental clocks
and captured indexed geometry. It does not invoke the public coordinator,
browser workers, GUI or MCP operation. PLY import, rendering, cancellation,
history and save/reopen remain outside the comparison. Owner setter entry was
not captured in this run; the final geometry oracle is the independent same-run
after capture. Both geometry snapshots are repeated, non-atomic reads.

The native result is stable for all three sources and converged for none.
Reproducing that result does not independently certify alignment quality. The
combined application change remains an uncommitted candidate pending the
required rendered GUI/MCP comparison. The earlier browser-target access denial
has not been bypassed. Source-pinned numerical evidence, application tests and
rendered workflow acceptance are recorded separately.

The [final candidate replay](evidence/global-fine-complete-numerical-replay-final-20261023.json)
refreshes source pins after stored-normal integration and the standalone module
loading correction. It again matches all 45 queries, six local solves, two outer
passes and 40,278,222 final Float32 values, in 16,246 ms under the same 4 GiB cap.
