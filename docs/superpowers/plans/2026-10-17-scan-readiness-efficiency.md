# Scan readiness efficiency

The owner approved the remaining performance work on 2026-10-17. Preserve scan
coordinates, tolerance semantics, facet identity, ordered boundaries and the shared
GUI/MCP processing path.

1. Replace resident edge objects/string keys with an insertion-ordered numeric
   edge directory. Keep Map compatibility for editing consumers. Differentially
   test manifold/nonmanifold meshes, diagnostics, cancellation and mutations.
2. Compact derived persistent topology records so large scans fit the existing
   128 MiB record admission limit. Version the encoding; validate corrupt data
   fail-closed and preserve source hashing, quotas and expiry.
3. Classify preparation dependencies so operations that do not consume topology
   can proceed without unnecessary preparation. Preserve preview ownership,
   bounded worker leases, cancellation and immutable-source revision checks.
4. Evaluate deterministic parallelism only where measurements justify its extra
   memory. Never parallelize first-representative welding by changing its result,
   bypass resource admission, or create duplicate unbounded workers.

Build, focused tests, affected suite, static checks, same-STL cold/cache benchmarks
and GUI/MCP browser validation precede each coherent commit. Use an isolated source
snapshot to exclude concurrent unrelated work. Report measured improvements and
any unvalidated or deferred portions explicitly.
