# Full-size final native scan proximity

This measures the retained final native PLY geometry, independently of whether
the application controller reproduces that run. It uses all 3,381,455 captured
vertices and all six directed scan pairs: **6,762,910 nearest-vertex queries**.
There is no resampling, cropping, geometry filtering or additional registration.
The earlier [complete post-state comparison](NATIVE_GLOBAL_FINE_ALIGNMENT.md)
binds these buffers to the original scan counts and every ordered triangle.

## Results

Distances are millimetres. Coverage uses strict `distance < 0.5 mm` over every
source vertex. Conditional RMS includes only those accepted vertices and must
be read alongside coverage. Median uses the exact nearest-rank rule. The
[structured report](evidence/global-fine-native-final-proximity-20261023.json)
also retains unconditional RMS, p90/p95/p99, maxima, accepted counts and the
separate 0.05, 0.1 and 1 mm thresholds.

| Source → target | Source vertices | Median (mm) | Within 0.5 mm | Conditional RMS (mm) |
| --------------- | --------------: | ----------: | ------------: | -------------------: |
| PLY 1 → PLY 2   |         140,113 |     1.73182 |        26.45% |              0.19301 |
| PLY 1 → PLY 3   |         140,113 |     1.49941 |        32.18% |              0.17307 |
| PLY 2 → PLY 1   |       1,375,494 |     1.30040 |        31.14% |              0.19774 |
| PLY 2 → PLY 3   |       1,375,494 |     0.03463 |        94.70% |              0.06813 |
| PLY 3 → PLY 1   |       1,865,848 |     1.13531 |        36.81% |              0.19331 |
| PLY 3 → PLY 2   |       1,865,848 |     0.03774 |        88.76% |              0.08327 |

Scans 2 and 3 have substantially closer vertex proximity to each other than
either has to scan 1 in this captured final state. Partial overlap and unequal
sampling density can contribute to that difference. These numbers do not
identify its cause or establish correct correspondence, physical accuracy or
successful registration. A small conditional RMS alone cannot establish quality
when most source vertices fall outside the threshold.

## Reproducibility and validation

The measurement uses the application's unchanged `NativeGlobalPointIndex.closest`
implementation. Each target index is built over its complete captured vertices;
every vertex of each other source is queried with a finite radius strictly
larger than every possible pair distance. Missing results fail the run. The
reported source checkpoint is `6b72447`; the exact index source, metric source,
bundle and Node 22.22.0 identities are pinned separately. The pending trim edits
do not change this index or these inputs.

The capture manifest and each Float32 payload were checked by byte length and
SHA-256. Copied input files are explicitly resolved by owner/basename inside the
retained support folder, rather than following the manifest's old absolute
paths. Original vertex order is preserved. All six source-order residual vectors
are retained privately as little-endian Float64: **54,103,280 bytes** total.
Twenty-four additional queries were compared against exhaustive searches over
their complete target scans. Small control fixtures verify strict cutoff,
duplicate points, quantile order, missing matches and empty accepted sets.

An independent Python checker read every saved residual and reproduced all
counts, quantiles, RMS values and thresholds. It rejected deliberately false
RMS and median reports. This checks the complete residual/statistic record;
it is not a second exhaustive nearest-search oracle for every source vertex.

Measurement completed in 14.03 seconds with a **180.80 MiB** aggregate Job peak.
The independent audit completed in 3.56 seconds with a **132.73 MiB** Job peak.
Both preserved the 4 GiB cap, 25% CPU quota, 3072 MiB admission guard and finite
leases, with clean owned-process cleanup. No native process was opened or
executed. The analysis provider from the separate static preparation check
closed with no cleanup pending and its owned Java process exited.

## Acceptance boundary

Vertex proximity is sensitive to sampling density and partial overlap; nearby
unrelated surfaces can also produce small values. It measures neither
point-to-triangle deviation nor dimensional accuracy. The captured geometry is
Float32 and the original snapshot was non-atomic despite two identical full
reads. No native before-state was captured, so this report makes no improvement
claim. Native controller correspondence coverage at approximately 0.05 mm is a
different metric and must not be equated with this all-vertex coverage.

Tracking issue #3 remains open: equivalent full-controller inputs/settings/clocks,
individual setter matrices, successful final registration and the remaining
real-input public GUI/MCP workflows still require acceptance evidence. This
update changes no application behavior, operation or schema and advertises no
new GUI-only or agent-only capability. The application build and unit/CAD suites
were not rerun for this evidence-only work; their exact previous candidate
results remain separately recorded.
