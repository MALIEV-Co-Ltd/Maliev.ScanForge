# Mesh processing parallelism

Screen selection uses two reusable workers for meshes with at least 100,000 triangles on devices reporting at least four logical CPUs. Devices reporting less than 8 GB memory use one worker. The pool is capped at two and a conservative 128 MiB geometry/BVH budget; very large meshes fall back to one. Preparation starts while choosing the selection tool. Workers expire after 60 seconds idle, are cancelled together on supersession or disposal, and queries have a 120-second timeout.

Each worker retains the whole visible mesh for cross-partition occlusion, but projects and tests only its assigned facet range. Masks are merged in original facet order after all workers finish. Partitioning changes neither visibility nor selection semantics. Small meshes retain one worker to avoid parallel startup overhead.

A local benchmark used the actual selection worker implementation in Node worker threads, 300,000 planar triangles, orthographic full-viewport rectangle, visibility enabled, four warm queries per configuration. Single-worker query times were 429, 460, 435 and 413 ms; two-worker times were 294, 257, 255 and 290 ms. Median latency decreased about 37%, with identical masks in every run. Initialization was 135 versus 261 ms. This is a synthetic benchmark on the current machine, not a guarantee for imported scans or browser hardware. The raw harness and results remain outside the repository.

The retained mesh-processing worker now receives source coordinates only on its first request. Subsequent requests reference its geometry key and send changing masks/targets; successful edits adopt the successor coordinates. Geometry replacement, cancellation and worker failure force a fresh transfer. This avoids a full source copy and transfer on every cached operation.

Topology analysis, connectivity-dependent editing, hole filling and defeature remain single-threaded within their dedicated worker. Their native numerical parity tests remain required. Further acceleration needs independent profiling and deterministic partitioning of each algorithm; separate workers for separate jobs are not multicore execution of one job.
