# Original STL global alignment: independent geometric assessment

The retained three-STL workflow after coarse placement completed GUI Global
Fine Align Preview, cached MCP Apply, exact geometry/history checks and project
save. Its controller reported all three scans stable and none converged. A new
independent assessment finds geometric improvement on the same overlap vertices;
it does not turn that result into a native convergence or milestone pass.

This assessment reads the retained projects from the 2026-10-23 run. It is not a
fresh replay of the current working tree. The historical candidate was
`7bbd3e8e79d3f01ab9b1ecb45e3cec81f78e95fe` plus recorded working changes, with
source manifest `062bc98819d2cd64c8e224d0df62697bee6b14a9e2b889212dc0aa08ff411aa1`.
The [structured evidence](evidence/original-stl-global-full-quality-20261024.json)
pins those receipts, both project containers, the new checker and its resources.

## Complete geometry measurement

Every one of the 3,121,976 indexed vertices is evaluated before and after global
alignment: 6,243,952 measurements. Each distance is the unsigned nearest distance
to the complete triangle surfaces of the other two scans. All 6,147,452 accepted
triangles participate in each stage's indexes. No geometry is downsampled, and no
registration correspondences, normals or boundary filters select the points.

The checker uses a separate installed BVH implementation, without importing the
application registration or transform code. It verifies index preservation and
five analytic cases, including a degenerate triangle. Six additional real-point
controls compare against an independent closest-triangle formula over every
eligible target triangle, with AABB lower-bound pruning. Those controls check
24,589,808 triangle bounds and agree within the predefined `0.000001 mm` tolerance;
they supplement the exhaustive measurements rather than replace them.

For a fixed-support comparison, each scan's vertices strictly within `0.5 mm`
before global alignment define its overlap set. The exact same vertex IDs are
evaluated afterwards, including any that subsequently exceed that distance.
This avoids reporting improvement merely by discarding difficult points.

| Scan       | Fixed overlap vertices | RMS before (mm) | RMS after (mm) | P95 before (mm) | P95 after (mm) |
| ---------- | ---------------------: | --------------: | -------------: | --------------: | -------------: |
| scan-1.stl |                 51,039 |        0.169815 |       0.162875 |        0.411376 |       0.401368 |
| scan-2.stl |              1,272,780 |        0.052089 |       0.045782 |        0.075530 |       0.056754 |
| scan-3.stl |              1,666,828 |        0.068309 |       0.059505 |        0.113011 |       0.089859 |

Across the 2,990,647 fixed overlap vertices, RMS decreases from `0.065173 mm` to
`0.057604 mm`. Full-scan percentages within `0.5 mm` change from 36.630% to 36.824%,
97.979% to 97.970%, and 99.004% to 99.089%, respectively. The report retains
all-vertex distributions and gained/lost overlap counts too.

These are vertex-weighted surface-distance measures, not uniform-area measures
or ground-truth scanner accuracy. The small first scan has substantial geometry
outside the other scans' overlap. Neither the overlap cutoff nor the oracle
tolerance changes an application setting or defines a release quality threshold.

## Independent coordinate publication check

A second checker decodes exact Float64 matrix bits from the retained public
preview and applies its two stages with separate Float32 stores. All 9,365,928
indexed coordinate elements and 55,327,068 expanded position elements match the
saved after-state bytes. All 18,442,356 triangle-index elements stay unchanged.
All three original STL file hashes also match. This verifies coordinate
publication for that run; it does not independently reconstruct normal streams
or replay the original native controller.

The retained workflow stopped after three passes. Final local statuses were
successful, but mean diagnostics of approximately 0.038294, 0.023717 and
0.038346 mm exceeded the native local convergence threshold of `0.001 mm`.
The measured improvement and the controller's false convergence flags are
therefore separate facts. The earlier identity-pose failure from raw STL poses
remains a distinct case requiring coarse placement.

## Resources and remaining acceptance

The exhaustive checker completed in 59.75 seconds with a measured Job peak of
870,703,104 bytes. Independent publication verification completed in 3.07 seconds
with a 717,185,024-byte peak. Both used the unchanged 4 GiB Job cap, 25% CPU quota
and finite leases; owned children exited, handles closed and cleanup errors were
empty. These are analysis measurements. The historical full application workflow
peaked separately at 4,065,284,096 bytes under its 4 GiB cap, with all 17 owned
processes exited and handles closed.

No application behavior, GUI/MCP schema or agent workflow changed. No new build,
unit/CAD suite or current-browser workflow was run for this analysis-only step.
Matched original-native final controller/setter comparison, a reviewed candidate,
the remaining format/point-cloud workflows and milestone acceptance remain open.
