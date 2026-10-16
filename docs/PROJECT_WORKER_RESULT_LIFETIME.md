# Project worker result lifetime

The encoder and decoder serialize jobs through a module-level promise. Previously
that promise was assigned `result.catch(...)`. Successful completion propagated
the result into the queue tail, retaining the last encoded Blob or decoded
project, including history, even after its caller released it.

The queue tail now resolves to `undefined` for both outcomes. The returned job
promise still carries its original result or rejection. Ordering, cancellation,
worker leases, project bytes and authored geometry are unchanged. GUI project
loading/saving, backups and MCP `project_import`/`project_export` continue through
the same shared project-file operations; no discovery/schema change is required.

`node tests/project-lane-memory-browser.mjs` exercises the actual client modules
with controlled worker responses in a disposable Chrome context. It releases
the returned values, requests collection through CDP and checks weak references
while the queues remain idle. Before the change, the encoder check failed because
its completed Blob remained reachable. With the change both encoder and decoder
results are collectable. This checks retention, not total memory or peak loading
allocations. The test requires 3072 MiB free and closes its browser in `finally`.

`node tests/project-encoding-browser.mjs` separately checks real workers and
lossless file bytes, authored-buffer ownership, cloud placement, rejection,
cancellation and queue recovery. Its helper resolves dependencies through one
Vite import graph so HMR query variants cannot duplicate private placement state.

This change does not establish that the reported temporary 3 GB peak is fixed.
Expanded mesh coordinates, display preparation, picking indexes, historical
geometry and backup encoding still require an allocation trace with the reported
loading scenario before attributing the remaining peak or claiming a reduction.
