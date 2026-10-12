# Native polygon reduction evidence

The production percentage target now truncates instead of rounding up. For
95 facets at 50%, the target is 47. This corrects one verified parameter rule;
the production protected edge-collapse algorithm is still independently chosen.

## Recovered route

All procedure addresses below refer to the captured mapped image with SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
Raw image data, decompilation and probes remain outside this repository.

- Ribbon builder `0x1402f09d0` associates the Reduce polygons label with command
  `0x8191`. Evidence `ev_bc478131967bf871cdbb6613fa3a4ab92ec9661af83a3f1d3c694222c3a7f855`.
  The mapped WM_COMMAND entries resolve its action to `0x1407ea1b0` and enabled
  state to `0x1407ea290`. These handlers dispatch through owner virtual methods;
  the complete owner/factory connection is not yet dynamically verified.
- Dialog constructor `0x140596ab0` creates resource `0x20e`, initializes the
  decimation dialog's type pointer, and stores Float32 `0.05` in its deviation
  field. Evidence `ev_ee86f3956c9b3f07d07f0acfc2f4d4b94e868d8adcf58de037215d2fa8a4a131`.
  Initialization `0x140597830` also reads saved settings and applies a separate
  context-dependent value and unit conversion; constructor defaults alone do
  not prove every configured UI default.
- Preview preparation `0x140597d10` creates a result mesh and has two branches
  controlled by a captured global flag. One calls wrapper `0x14038d2a0` with
  source mesh, output mesh, target count and progress owner. The other creates
  a polygon-reduction object inline. Evidence
  `ev_813e0f72a52c536994f34d3b230e5e595ad8c29d0fc944362c4ffafa7b1d0fb6`.
  The second branch's complete execution remains unresolved.
- Wrapper `0x14038d2a0` reaches `0x140396050`. The latter prepares source
  connectivity and uses 120-byte vertex and 72-byte facet records. It calls
  preparation `0x140394c30`, then collapse `0x140395aa0`, then reconstructs the
  output mesh with Float32 coordinates. Evidence
  `ev_dda122a0237f0806d431e126209b4b71929be02a9c0fe4c6604b672e00f68353`.
- Collapse `0x140395aa0` stops when the retained count reaches its target or
  after 1,000 passes. It compacts records every 20 passes and increases its
  candidate threshold using a power expression scaled by `1e-9`. It calls
  candidate calculation `0x140393e90`, validity checking `0x1403945b0`, adjacency
  updates `0x140395640`, and final compaction `0x1403957c0`. These helper bodies
  are retained, but no full collapse numerical comparison has been performed.
  Evidence `ev_224de1bb6364c28248d2e331a3afd3cdc1e05b8e03b79cad625645b3707e0abb`.
- Deviation comparison `0x140598310` caches a preview search object, distributes
  original vertices among CPU partitions, joins them, and computes the reported
  percentage within threshold. Evidence
  `ev_af05ba8628211c99046cbb8297c87bf9e71aebc73387b642204c996b4ba3890a`.
  This is static evidence of that path, not a multicore timing measurement.

## Percentage execution and integration

Original x64 routine `0x140598290` was executed on 143 guarded caller-owned
dialog objects. Only its MFC data-binding import was replaced with a no-op;
the arithmetic, constants, conversion and field writes are original. It clamps
the integer percentage to 1–100 and truncates `count * percentage / 100`.
All cases modify only the target and clamped-percentage fields. Counts cover
zero, small odd/even meshes, large meshes and the full UInt32 range.

Evidence `ev_4a0a42abfb8c5f2a125e4b432219f72170c8f8e51e223e8f4cc56eedb6f51192`
and `tests/fixtures/reduction-percentage.json` retain the numerical contract.
`src/scan-reduction-target.ts` supplies the target for the existing production
reducer, including its spatial-patch path. Invalid API percentages still fail
explicitly; fractional percentages remain an existing API extension. The
application retains a minimum target of one facet instead of permitting an empty
mesh. Tests distinguish these policies from the native integer arithmetic.

Complete native reduction requires identical input mesh/output comparisons,
candidate and tie ordering, boundaries, nonmanifold behavior, cancellation,
deviation mode and the alternate branch. The sequential collapse loop must be
verified before introducing multicore changes that could reorder candidates.

## Collapse candidate numerical verification

Original routine `0x140393e90` was executed on 424 guarded pairs of caller-owned
120-byte vertex records. It has no calls or imports; no instructions or numerical
dependencies were replaced. The source image digest is the mapped-image digest
above. Evidence is
`ev_2f28b3f32aadc97d910b521b9dcd0299a4f94bf3eb3c453d599d9e8c4bea060b`.
Input records and context remained unchanged; all output guards remained intact.

The candidate combines the endpoints' symmetric quadrics. It solves the
three-coordinate system when the determinant magnitude exceeds `2^-23` and the
two endpoints are not both boundary vertices. Otherwise it evaluates the first
endpoint, second endpoint and midpoint. Independent equality writes mean the
midpoint wins when all three costs tie. A single boundary endpoint does not
force that fallback. These rules differ from freezing all boundary edges.

`src/scan-reduction-candidate.ts` reproduces every captured cost and coordinate
bit, including signed zero. Cases cover all four boundary combinations, zero
and singular quadrics, determinant values at/below/above the threshold, and
seeded sums of plane quadrics with coordinate scales from `0.001` to `1,000,000`.
Arithmetic grouping follows the original scalar instructions: equivalent
algebraic reassociation produced different doubles in the first port. The
fixture stores raw output bytes because JSON module loaders may normalize
negative zero.

This module is a verified component for the native reduction port. It is not
yet used by the independently implemented production reducer. Installing it
alone would leave the native preparation, validity, update and collapse-order
rules unimplemented. The remaining integration gate is a complete native
collapse path compared on identical meshes, rather than substituting one
verified component into a different algorithm and claiming equivalence.

## Face-validity and deletion-mask verification

The port in `src/scan-reduction-validity.ts` matches 275 executions of original
routine `0x1403945b0`, including its Boolean result and all three output mask
words. Evidence is
`ev_97115feb5c2b3e657e8787f134f0ad27256def4c20725f5b991193683f96c034`.
Its double-vector normalization dependency `0x140154070` was separately
extracted with REA; evidence is
`ev_56a9b9eb30ef0b25b0d67ffee8893d1311ad93c99ffac5fdd9596e511ce70921`.
The isolated execution resolves only the original square-root import to the
helper process's CRT. No geometric code is replaced. The return contract is a
Boolean in `AL`; upper register bits are unspecified. The committed captures
use that contract, correcting the first probe's oversized return type.

The routine walks ordered incident-face references. Deleted faces leave their
mask bits untouched. A face containing the other collapse endpoint sets its
deletion bit. Otherwise the routine normalizes both replacement edge vectors
using double arithmetic and a `Number.EPSILON` length cutoff. An absolute edge
dot product greater than `0.999` rejects immediately. It then normalizes their
cross product, clears the face's deletion bit, and rejects if the dot product
with the stored face normal is below `0.2`. Early returns preserve unvisited
mask bits; clearing the entire mask before the check would differ.

The captures cover threshold neighborhoods, tiny and large coordinates,
collinear edges, empty incidence, deleted faces, endpoint removal, corner
rotations, and incidence counts of 31, 32, 33 and 65. All input records and
guard bytes remain unchanged. Candidate and validity components are now
numerically verified; preparation, adjacency updates, ordered collapse and
final compaction still require integration and full native mesh comparisons.
