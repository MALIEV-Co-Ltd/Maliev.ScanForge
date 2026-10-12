# Large-scan polygon reduction

Reduce polygons no longer rejects input above 500,000 triangles. Inputs above the working-set size use spatial Morton ordering and sequential patches of at most 8,192 facets. This is a topology working-set bound, not an input limit. Sorting uses two typed arrays (eight bytes per facet). Input, output and final packing buffers still scale with scan size; this is not disk-backed or unlimited-memory processing.

Each patch uses exact Float32 coordinate indexing and pins its open perimeter. Adjacent patches retain identical shared coordinates and edges. Existing manifold-link, sharp-crease, non-inversion and conservative original-coordinate deviation checks apply inside each patch. Collapses are now checked after Float32 rounding, preventing an otherwise valid double-precision collapse from creating a degenerate stored triangle.

Unsafe patches are retained unchanged and counted in the result. Spatial cuts can create disconnected vertex fans, which are conservatively protected. Fixed seams and topology can prevent the requested triangle count or percentage; the summary explicitly reports that rather than dropping faces or claiming the target was reached. This can reduce less aggressively than a global reducer. Deviation mode retains the existing conservative constraints rather than introducing a lossy preliminary downsample.

Progress covers scan extent, spatial ordering, patch reduction and output packing. Cancellation checkpoints run during input traversal and patch processing; the browser client's AbortSignal terminates an active worker, including a sort. Allocation RangeErrors produce a resource-specific failure and retain the source. No partial output is published on failure or cancellation.

## Validation

The actual reduction implementation was benchmarked in a Node process with a 384 MiB heap on synthetic connected planar grids, requesting 50% retained triangles:

| Input facets | Output facets | Time    | Sampled peak heap | Sampled array buffers |
| ------------ | ------------- | ------- | ----------------- | --------------------- |
| 502,002      | 312,442       | 3.25 s  | 138 MiB           | 50 MiB                |
| 2,004,002    | 1,346,066     | 13.14 s | 143 MiB           | 200 MiB               |

The larger run has four times the input with similar heap consumption. Measurements sample at progress callbacks and are not a process-wide peak or browser latency guarantee. Results include protected patches; these figures do not imply arbitrary scans reach 50%. Harness and raw results are outside the repository.

Regression tests cover actual reduction beyond the old limit, nondegenerate Float32 output, a real large-input worker request/result, bounded per-patch topology, cancellation, finite-coordinate validation, planar deviation mode, unchanged source, and full-mesh boundary/component/manifold checks across patch seams.
