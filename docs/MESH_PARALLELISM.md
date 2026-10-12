# Mesh processing parallelism

Screen selection uses two reusable workers for meshes with at least 100,000 triangles on devices reporting at least four logical CPUs. Devices reporting less than 8 GB memory use one worker. The pool is capped at two and a conservative 128 MiB geometry/BVH budget; very large meshes fall back to one. Preparation starts while choosing the selection tool. Workers expire after 60 seconds idle, are cancelled together on supersession or disposal, and queries have a 120-second timeout.

Each worker retains the whole visible mesh for cross-partition occlusion, but projects and tests only its assigned facet range. Masks are merged in original facet order after all workers finish. Partitioning changes neither visibility nor selection semantics. Small meshes retain one worker to avoid parallel startup overhead.

A local benchmark used the actual selection worker implementation in Node worker threads, 300,000 planar triangles, orthographic full-viewport rectangle, visibility enabled, four warm queries per configuration. Single-worker query times were 429, 460, 435 and 413 ms; two-worker times were 294, 257, 255 and 290 ms. Median latency decreased about 37%, with identical masks in every run. Initialization was 135 versus 261 ms. This is a synthetic benchmark on the current machine, not a guarantee for imported scans or browser hardware. The raw harness and results remain outside the repository.

The retained mesh-processing worker now receives source coordinates only on its first request. Subsequent requests reference its geometry key and send changing masks/targets; successful edits adopt the successor coordinates. Geometry replacement, cancellation and worker failure force a fresh transfer. This avoids a full source copy and transfer on every cached operation.

Topology analysis, connectivity-dependent editing, hole filling and defeature remain single-threaded within their dedicated worker. Their native numerical parity tests remain required. Further acceleration needs independent profiling and deterministic partitioning of each algorithm; separate workers for separate jobs are not multicore execution of one job.

## Avoiding repeated preparation

Scan Tools now forwards the geometry cache into noise and polygon reduction. Weld tolerances must match exactly before reuse. Noise reduction retains indexed connectivity and adopts its successor coordinates, so repeated edits avoid welding and adjacency construction. Restored selection seams with differing coordinates invalidate indexed identity and require another weld. Polygon reduction changes connectivity and cannot retain the old adjacency as its successor. Scan Edit also constructs component/boundary inventory only when requested and expands smoothing output directly into a typed array.

A local 20,000-triangle sinusoidal grid benchmark measured 273 ms cold topology preparation, 117 ms cached noise reduction versus 256 ms uncached, and 74 ms for the next cached edit. Cached and uncached outputs were identical; warm edits emitted no welding stage. These measurements cover the current conservative noise algorithm and do not establish native Reduce Noise parity. Raw input, harness and results stay outside the repository.

## Acceleration acceptance gates

Measure cold preparation, warm kernel, diagnostics/output assembly, transfers and browser highlight latency independently. Record mesh size, selection size, hardware, worker count, repeated timings and correctness alongside every claimed gain. A warm synthetic result is not an imported-scan latency guarantee.

The next CPU candidate is verified selected smoothing: partition vertices, preserve ordered one-ring sums within each vertex, and synchronize every iteration before publishing coordinates. Compare single-worker and multicore output byte-for-byte across boundary, disconnected-fan, high-valence and sparse-selection fixtures. Retain cancellation, bounded memory, size thresholds and a single-worker fallback. Do not duplicate object-rich topology in every worker.

Native Reduce Noise tracing identified a distinct correction-based kernel and a CPU task partition/join in its weight preparation. The captured default is one iteration on the whole mesh with boundary smoothing enabled. Its deviation control is a separate comparison display. An external reconstruction matches every output coordinate exactly on the captured 96-triangle default fixture. Float32 normal storage with a double-precision reciprocal is essential to this match. Selection-only, other iteration counts and deviation handling still need independent comparisons before integration; the application currently retains its conservative algorithm. Immediate Smooth and defeature retain their existing native fixture gates.

GPU processing is not enabled. Any GPU experiment must pass native geometry comparison, device-loss/cancellation tests and end-to-end upload/readback benchmarks before producing committed geometry. The native correction kernel mixes double accumulation with Float32 storage; ordinary [WGSL floating-point types](https://www.w3.org/TR/WGSL/) are f32/f16, so equivalent output cannot be assumed. Sequential edge collapse and advancing-front repatching remain CPU operations pending separate algorithm verification.
