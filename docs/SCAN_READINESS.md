# Staged scan readiness

Geometry remains an immutable, identity-scoped source. Display buffers and
bounded sample preparation can become ready before full welded adjacency.
Topology is prepared speculatively after paint/idle for the selected source;
foreground tools that consume it continue through the geometry queue and reuse
the same worker index.

A topology-free foreground tool may cancel only an explicitly registered
speculative diagnostic for the same source. The old worker must terminate before
the queued foreground request starts. This avoids a second concurrent worker and
duplicate source buffers. It does not interrupt diagnostics requested by a visible
panel, queued topology consumers, or stateful preview create/compare/release work.
An already cancelled foreground request must not cancel useful preparation.

The implementation belongs to the shared processing client used by GUI and MCP;
no new agent operation or schema is needed. Both entry points retain operation
validation, revision checks, immutable source identity, cancellation and finite
worker leases. Preview sessions stay on their owning retained worker.

Resource ledger for this change: no process, container, browser tab or persistent
data store was created. Worker ownership tests use in-process doubles and verify
termination before a successor starts. Build and test admission is controlled by
the existing resource guard; no thresholds are lowered.
