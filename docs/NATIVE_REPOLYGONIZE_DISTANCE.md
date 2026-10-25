# Native Re-polygonize distance arithmetic

The 2026-10-24 follow-up traced six additional candidate functions through
projected-triangle classification, segment sampling, triangle-box admission and
vector normalization. Independent decoding checked another 794 reported
instruction addresses against the archived image. Twenty-one candidate
functions have now been examined across this investigation.

## Arithmetic that must be preserved

The projected triangle classifier chooses the dominant normal axis. It uses
Float32-rounded coordinate equality and product comparisons, including special
cases for equal projected coordinates. A generic double-precision orientation
test can classify near-edge points differently.

The segment helper treats squared lengths at most
`9.999999974752427e-7` as zero and selects the first endpoint. Otherwise it
calculates an unclamped projection parameter, clamps the closest point to the
segment and stores that point as Float32. The returned distance is Euclidean;
its returned projection parameter remains unclamped. Intermediate arithmetic
order differs between the interior and final-endpoint branches.

Signed triangle sampling first applies a strict absolute plane-distance cutoff.
It preserves the normal for interior projections. Outside projections visit
candidate edges in order, retain the nearer distance with strict comparisons
and return flags for all outside edges. The sign comes from the plane distance.
The resulting direction uses Float32 subtraction, Float32-rounded squares and
additions, `sqrtf`, double-precision reciprocal scaling and final Float32 stores.
The normalization length threshold is `2^-52`.

Triangle-box admission includes a plane-overlap test followed by edge-axis
overlap tests. Its complete placement in the ordered spatial admission path
still needs a port and verification.

## Math binding and isolated ports

Archived import pointers resolve exactly to `floor`, `sqrt` and `sqrtf` exports
in matching UCRT DLL bytes at a module base retained from another same-day
process observation. This is a historical derived binding. No process was
opened for this check, and it does not establish a fresh runtime binding.

Two private arithmetic ports were tested before application integration:

- Segment sampling: 12 initial failures, then 12 passing analytic controls for
  interior points, endpoints, extrapolation, short segments, degeneracy,
  negative coordinates and Float32 input/output.
- Signed-triangle sampling and projected predicates: 15 initial failures out of
  16 controls, then all 16 passing. These cover both plane sides, triangle edges
  and vertices, dominant axes, reversed normals, strict cutoff equality and
  Float32-sensitive projected coordinates.

These controls use supplied normals and nondegenerate triangle samples, apart
from the explicit segment-degeneracy control. They do not verify native source
normal preparation, full degenerate-triangle admission or full reconstructed
output. The ports remain private investigation code, with no claimed GUI or
MCP capability.

The two static-analysis jobs peaked at 881,238,016 and 897,212,416 bytes. Their
roots exited successfully, descendant jobs ended with zero active processes,
owned handles closed and cleanup errors were empty. The red and green arithmetic
runs also exited with their expected statuses and clean cleanup. All used the
unchanged aggregate 4 GiB and 25% CPU limits. No original application or helper
was executed or instrumented, and no fresh native geometry was read.

## Integration gates

No production behavior or MCP contract changed. A full replacement must port
ordered spatial admission, source boundary and normal preparation, corner
reduction and extraction together through the shared `mesh_process` operation.
It must preserve ownership, cancellation, revisions, retry protection and
history, and pass GUI/MCP comparison on the complete original inputs. Surface
deviation, components, self-intersections and reconstructed-project lifecycle
remain required. Point-cloud reconstruction, M3 and the full objective remain
open.

See [structured evidence](evidence/repolygon-distance-arithmetic-20261024.json)
and the [signed-field investigation](NATIVE_REPOLYGONIZE_FIELD.md).
