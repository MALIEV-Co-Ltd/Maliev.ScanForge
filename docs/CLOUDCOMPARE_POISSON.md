# CloudCompare Poisson reconstruction

The original 2026-10-28 native sphere investigation below is retained as history.
The [2026-10-29 completion record](CLOUDCOMPARE_COMPLETION_20261029.md) supersedes
its former ScanForge implementation gap: actual shared GUI/MCP Poisson, complete
owner-scan quality and the native full-scan comparison are now validated.

Native observations and independent output analysis, 2026-10-28. This records
the installed CloudCompare 2.13.2 plugin, not a ScanForge Poisson implementation.

## Prerequisite and workflow observed

The parent investigation selected a 1,200-point synthetic sphere without normals
and invoked **PoissonRecon**. The button was enabled, but the action refused with
**“Cloud must have normals!”**. Selection eligibility therefore does not establish
that prerequisites have passed. The refusal is retained in
[text](evidence/cloudcompare-20261028/poisson-missing-normals.txt) and
[screenshot](evidence/cloudcompare-20261028/poisson-missing-normals-1.jpg).

The same sphere with authored outward normals opened the reconstruction dialog.
The radius is 10 mm and the sphere is centered at the origin. Inputs are retained
as `fixtures/sphere-no-normals.ply` and `fixtures/sphere-normals.ply` in the
investigation evidence directory; `scripts/cloudcompare-fixtures.mjs` reproduces
them. These are synthetic truth fixtures, not scanner measurements.

## Observed settings

| Setting                        | Observed default on this host | Executed sphere run |
| ------------------------------ | ----------------------------- | ------------------- |
| Resolution mode                | Octree depth                  | Octree depth        |
| Octree depth                   | 8                             | 8                   |
| Alternative resolution         | Disabled, displayed 0.173064  | Unchanged/inactive  |
| Boundary                       | Neumann                       | Neumann             |
| Samples per node               | 1.50                          | 1.50                |
| Point weight                   | 2.00                          | 2.00                |
| Threads                        | 24                            | 2                   |
| Linear fit                     | Unchecked                     | Unchecked           |
| Output density as scalar field | Unchecked                     | Unchecked           |

The thread count was reduced to two for a bounded run. The value 24 is an
observation of this host/dialog, not a universal default. Screenshots were
independently inspected for the unchecked controls and final thread value;
the text capture for the final parameter screen is empty, so its screenshot and
the result console are the supporting records.

[Density/default screen](evidence/cloudcompare-20261028/poisson-defaults-1.jpg),
[advanced defaults](evidence/cloudcompare-20261028/poisson-advanced-defaults-1.jpg),
[executed parameters](evidence/cloudcompare-20261028/poisson-run-parameters-1.jpg).

The native console reports the level-8, two-thread job and a duration of 0.1 s.
That is the application's reported duration for this tiny fixture, not a general
performance or resource benchmark. The generated mesh was saved through the
native GUI as `poisson-sphere-native.bin`; native CLI conversion produced
`poisson-sphere-native.ply`. The conversion log independently reports 7,980 faces
and 3,992 vertices.

[Native result text](evidence/cloudcompare-20261028/poisson-sphere-result.txt),
[rendered result](evidence/cloudcompare-20261028/poisson-sphere-result-0.jpg),
[conversion log](evidence/cloudcompare-20261028/poisson-convert.log).

## Independent quality on the known sphere

`scripts/analyze-cloudcompare-poisson.mjs` reads the actual native PLY with
Three's PLYLoader and measures coordinates/topology against the authored
radius-10 sphere. It imports no ScanForge reconstruction implementation.

| Check                                       |    Native output |
| ------------------------------------------- | ---------------: |
| Vertices, all used                          |            3,992 |
| Triangles                                   |            7,980 |
| Edges                                       |           11,970 |
| Connected components                        |                1 |
| Boundary edges                              |                0 |
| Edges with more than two incident triangles |                0 |
| Inconsistent shared-edge winding            |                0 |
| Degenerate / duplicate triangles            |            0 / 0 |
| Euler characteristic                        |                2 |
| Outward faces / outward vertex normals      |    7,980 / 3,992 |
| Vertex radial RMS                           |      0.006502 mm |
| Vertex absolute radial P95                  |      0.012511 mm |
| Maximum vertex absolute radial error        |      0.017024 mm |
| Face-centroid radial RMS                    |      0.008574 mm |
| Maximum continuous mesh-to-sphere distance  |      0.028311 mm |
| Surface area                                | 1,255.862185 mm² |
| Analytic sphere area                        | 1,256.637061 mm² |
| Signed enclosed volume                      | 4,182.363517 mm³ |
| Analytic sphere volume                      | 4,188.790205 mm³ |

Vertex and centroid RMS weight their respective samples equally. The continuous
distance checks filled triangle interiors: a triangle's minimum radius is its
closest point to the origin, and its maximum radius occurs at a vertex.
Distance to the true sphere is absolute radial error. The result is one-way
mesh-to-sphere distance, not symmetric Hausdorff distance. No self-intersection
test or complete vertex-link manifold certification was performed; the edge and
Euler checks alone do not establish those properties.

[Structured quality receipt](evidence/cloudcompare-20261028/poisson-sphere-quality.json)
includes exact values, settings, input/output SHA-256 hashes and limitations.
Reproduce with `node scripts/analyze-cloudcompare-poisson.mjs`.

## Guidance corroborated by documentation, not exercised here

The [official CloudCompare plugin documentation](<https://www.cloudcompare.org/doc/wiki/index.php/Poisson_Surface_Reconstruction_(plugin)>)
requires a cloud with clean, consistently oriented normals and describes octree
depth as a detail/time/memory tradeoff. It describes reconstruction as primarily
suited to closed shapes and offers density-based trimming for open scans: inspect
the density scalar field, hide low-density regions, then filter by value to
create the retained mesh. The native dialog also contains that trimming guidance.
The wiki page is older than this installed build, so its version-specific library
claims are not evidence of the plugin version shipped here.

These instructions corroborate prerequisites and an intended workflow. Density
was disabled in the observed run. Open-surface extrapolation, hole preservation,
trimming quality, noisy/flipped-normal behavior and parameter sweeps were not
tested, and the closed-sphere result does not resolve them.

## ScanForge scope recorded at 2026-10-28 (superseded)

ScanForge currently provides the shared GUI/MCP projected 2.5D route documented
in [Projected point-cloud meshing](CLOUDCOMPARE_PROJECTED_MESHING.md). It does not
provide general Poisson reconstruction. That capability still needs normals
preparation/orientation, explicit resource admission, geometry quality and failure
validation, shared application operations, discoverable MCP parameters/results,
history/cancellation and GUI/public-MCP verification before it can be advertised.
No app source or unsupported MCP discovery entry was added for Poisson here.

The continuation checked the independent [upstream PoissonRecon project](https://github.com/mkazhdan/PoissonRecon)
and its [MIT license](https://github.com/mkazhdan/PoissonRecon/blob/master/LICENSE).
This provides a possible implementation route without linking CloudCompare's
GPL adapter. It is a C++ implementation; no working browser Poisson binding or
reproducible WebAssembly build was established in this investigation. Native PCL
Poisson documentation alone does not establish support in pcl.js. A future
integration must first demonstrate a bounded, cancellable browser worker build
and validate oriented normals and output geometry before exposing a GUI/MCP
operation. This dependency feasibility check is not an implemented feature.
