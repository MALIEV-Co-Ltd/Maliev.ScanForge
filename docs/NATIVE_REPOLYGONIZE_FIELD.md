# Native Re-polygonize field and extraction investigation

Latest comparison-preparation checkpoint: three binary little-endian indexed PLY
inputs retain all 3,121,976 posed vertices and 6,147,452 triangles from the pinned
aligned project. The files total 117,381,333 bytes. Independent readback of every
coordinate and face index matches the source hashes, including face order and
winding. A control also preserves signed zero, a Float32 subnormal and an unused
vertex. Units and intended comparison spacing are recorded as mm and 0.5 mm.
See [comparison-input evidence](evidence/reconstruction-comparison-inputs-20261024.json).

The exported files contain geometry only. Normal carriers, native importer
behavior, flags and cached source state are not verified by this pack. No native
application was opened or run and the active application scene was not changed.
A matching existing native output, with input preparation, poses, units,
settings and execution mode identified, remains necessary for output comparison.
The owned export job peaked at 257,830,912 bytes and exited successfully with zero
descendants, closed handles and no cleanup errors under the existing limits.

The previously inferred cell-size helper is now decoded directly: all 26
instructions and both return paths establish the largest Double axis extent for
finite boxes, matching the current port. The initial linear decode stopped at
the first return; the retained control-flow decode follows all direct branches.
The inspected direct emitter has the distinct-vertex and Float32 area gates;
the recovered compaction routine removes unused points and rewrites triangle
references. These routines do not reveal the hypothesized triangle-removal pass.
This is a selected-function finding, not a proof about every native workflow.
No geometry rule, product behavior, MCP schema or native-acceptance status changed.

Latest execution-mode checkpoint: selected retained native instructions bind two
internal paths. Parent mode less than two uses one work-root entry and one
initialized triangle counter shared across source invocations. Parent mode at
least two uses partition entries and the previously bound worker counter reset.
Thirteen selected instructions were independently decoded. This establishes the
internal branch distinction; the actual native GUI setting and full controller
invocation remain unobserved. The native reduction body also explicitly sums
signed distances within the preferred source group and divides by its count.
No alternative clipping or averaging rule was introduced. See
[single-root evidence](evidence/repolygon-single-root-20261024.json).

The single-root reference processed the same complete aligned input: 3,121,976
vertices and 6,147,452 triangles, with exactly the same 0.5 mm grid frame. Source
positions, indices and saved-project identity remained unchanged. It used one
corner pool, two source passes per scan (validation and admission), 73,522 data
leaves and 144,302 corner records. No candidate was clamped outside that root.
The five diagnostic corners behind the worst partitioned artifact were never
admitted in this single-root field. Finalization completed without a retired
pointer read; all output normals are finite and nonzero.

| Private full-input reference     | Single root | Partitioned roots |
| -------------------------------- | ----------: | ----------------: |
| Vertices                         |      52,615 |            52,703 |
| Triangles                        |     101,792 |           101,918 |
| Nonmanifold edges                |         173 |               165 |
| Duplicate unoriented faces       |           4 |                 7 |
| Boundary edges                   |       4,189 |             4,249 |
| Input-corner-to-output RMS (mm)  |   0.0533433 |         0.0539991 |
| Output-corner-to-inputs RMS (mm) |   0.0453342 |         0.0480956 |
| Output-to-inputs maximum (mm)    |   0.6369631 |         1.0130738 |

The independent single-root distance check queries every input and output
indexed vertex against complete target triangle surfaces, with exact index
incidence weights for 18,442,356 input corners and 305,376 output corners. Five
analytic controls, one weighting control and four full-triangle/bounds oracle
comparisons pass. Input-to-output maximum distance remains 0.6765042 mm. These
are unsigned vertex-to-triangle metrics, not continuous-surface Hausdorff bounds
or native numerical acceptance.

The single-root field/finalization job took about 66 seconds and peaked at
840,876,032 bytes; its distance job peaked at 655,310,848 bytes. These are bounded
private reference timings, not a native parallel-performance benchmark. Both
jobs exited successfully with zero owned descendants, closed handles and no
cleanup errors under the unchanged 4 GiB / 25% CPU limits. Both modes still fail
usable-topology acceptance. Neither is substituted for the other to close that
gate. Production GUI/MCP behavior and schemas remain unchanged; the native mode
option is not yet advertised or integrated, and no full application build was
run for these diagnostic-only additions.

Latest defect-provenance checkpoint: a diagnostic-only extractor observer records
cell, local edge and accepted-face origins. Seven new controls pass after an
observed 2/7 red result; the existing extraction suite remains 6/7 with its known
two-source ideal-plane failure. The complete aligned-input replay reproduces
every previous output position, index and normal byte. Production source and
GUI/MCP behavior are unchanged. See
[provenance evidence](evidence/repolygon-provenance-20261024.json).

The trace retains 285,397 edge events and 101,966 raw accepted triangles. It
localizes all 165 final nonmanifold edges, seven duplicate face groups and the
retained worst-deviation points to 1,097 cells and 272 selected vertices. Five
bad edges have raw triangle origins in multiple work roots; 160 have origins
within one root. Eighteen have an originating cell directly on a work-root
boundary, including ten whose raw originating cells all touch such a boundary.
Those associations do not establish a single cause for all defects.

The worst output vertex's reference field combines two interior samples at one
corner with signed distances -1.1660618 mm and +0.9779079 mm. Their mean is
-0.0940770 mm, below the 0.125 mm endpoint-selection threshold, so multiple
lattice edges select the same projected endpoint. The originating cell touches
its work root's upper Z boundary. This explains this private output's arithmetic
path; native application behavior and a corrective policy remain unproven.

An independent arithmetic replay agrees on all 2,122 captured hot-edge
projections, with three analytic branch controls. A separate nearest-surface
check evaluates all 3,702 selected diagnostic corners against the complete
6,147,452 source triangles. No stored sample underestimates the global nearest
distance by more than 0.000001 mm; the largest observed underestimate is about
0.000000053 mm. Local admission can overestimate the global nearest distance,
by as much as 0.6312561 mm in these diagnostics. This corner set is for diagnosis
and does not replace the prior full input/output deviation check.

Static inspection binds the native source iterator's constructor vtable and five
entry methods, with all 56 instructions independently decoded from retained
image bytes. These methods read the triangle-container count, start with record
zero and advance by sequential index access. They add no further filtering in
the inspected methods. Container/controller behavior and native runtime
equivalence remain separate questions. No original executable was run.

All seven owned checkpoint jobs reached their expected exits with zero owned
descendants, closed handles and no cleanup errors. Peak owned-job memory was
1,031,958,528 bytes under the unchanged aggregate 4 GiB / 25% CPU limits. The
private extractor's earlier hashes remain historical; this instrumented replay
supersedes those source bytes while preserving final output. No geometry repair,
native precision change, new product capability or full application build is
claimed by this checkpoint.

Latest aligned-project checkpoint: the complete saved project's 3,121,976
indexed vertices and 6,147,452 triangles passed the private field and recovered
finalization sequence at 0.5 mm. Coordinates and indices match the prior
GUI/MCP Apply digests; triangle buffers also retain the original STL hashes.
No source sampling, transform approximation or new alignment solve was used.
The run completed in approximately 357 seconds with peak owned-job memory of
878,477,312 bytes. See [aligned-field evidence](evidence/repolygon-aligned-three-field-20261024.json).

The output has 52,703 vertices and 101,918 triangles. Cleanup handled 124
three-record walks, adding 38 caps and removing 86 isolated faces without a
retired-pointer read. All output normals are finite and nonzero. Topology still
fails: 165 nonmanifold edges, seven duplicate unoriented faces and 4,249 boundary
edges remain across 138 edge-connected components. The largest has 101,045
triangles. No winding conflict, repeated-index face or zero-area face was found.
Different derived grid bounds accompany the changed poses, so this comparison
does not isolate the cause of a particular defect.

An independent distance checker queried every input and output indexed vertex
against complete target triangle surfaces. Five analytic controls, an exact
weighting control and four full-triangle/bounds oracle comparisons passed.
Triangle-corner multiplicity accounts for all 18,442,356 input corners and
305,754 output corners without adding or dropping geometric samples.
See [complete deviation evidence](evidence/repolygon-aligned-distance-20261024.json).

| Direction, triangle-corner weighted        | RMS distance (mm) | Maximum distance (mm) |
| ------------------------------------------ | ----------------: | --------------------: |
| Aligned inputs to private field output     |         0.0539991 |             0.6765042 |
| Private field output to all aligned inputs |         0.0480956 |             1.0130738 |

The retained voxel backend result on the same saved input project had an
input-corner RMS of 0.3435247 mm. The private field fits those input samples more
closely, but its topology and worst-case deviations remain unacceptable for
claiming usable combined geometry. Reverse output populations differ between
backends. These unsigned vertex-to-triangle measurements are not continuous
surface Hausdorff bounds, scanner accuracy or native equivalence. Self
intersections were not checked. The distance job peaked at 696,524,800 bytes.
Both owned jobs exited with zero descendants, closed handles and no cleanup
errors under the unchanged 4 GiB / 25% CPU limits.

Native mutable globals, controller/scheduling equivalence, point-cloud
reconstruction and integrated GUI/MCP/history/cancellation/save/rendered
acceptance remain open. Production GUI and MCP still share the voxel backend;
no application capability or schema changed and no full application build was
run for these private diagnostic changes.

Latest finalization checkpoint: a private finite fresh-output sequence now joins
the recovered compaction, normals, shared packed adjacency, boundary collection
and three-record repair steps. Eight focused controls were observed failing
before implementation and passing afterward. An unresolved retired triangle
reference causes this reference to stop; it does not guess native allocator
slot reuse. See [finalization evidence](evidence/repolygon-finalized-three-field-20261024.json).

The full original-pose field output completed that sequence with no retired
pointer read. All 23 three-record walks were handled: 19 caps were appended and
four isolated faces removed. Nine orphan vertices were compacted, leaving
89,485 vertices and 167,025 triangles. The final normal array is finite, with
four zero vectors. The bounded job peaked at 220,504,064 bytes and cleaned up
successfully. Canonical field-input hashes were unchanged.

The resulting mesh still has 47 nonmanifold edges, 11 duplicate unoriented faces,
one winding conflict and 12,328 boundary edges. The recovered cleanup does not
remove those defects. Self intersections and native numerical output remain
unverified; this is not usable-output acceptance. The subsequent full run using
the retained aligned project's exact indexed geometry is documented above.
No production GUI/MCP
backend, schema or capability has changed.

Latest full-input field checkpoint: the private partitioned field/extraction path
processed all 6,147,452 accepted triangles from the three original STL files at
0.5 mm spacing. It produced 89,494 vertices and 167,010 triangles in about 356
seconds, with peak aggregate owned-job memory of 952,770,560 bytes under the
unchanged 4 GiB / 25% CPU limits. Original file hashes and canonical source
buffers were rechecked unchanged. No input sampling was used. The input poses
are the original STL coordinates; no registration transform was applied.
See [full-input field evidence](evidence/repolygon-original-field-20261024.json).

An independent edge/face audit, checked against three analytic controls, found
12,397 boundary edges, 47 nonmanifold edges, one two-face winding conflict and
11 duplicate unoriented faces before finalization. There are 15 edge-connected
components; the largest contains 166,832 triangles. No repeated-index or
zero-area triangles were found. Self intersections were not checked. This is
not accepted as usable combined geometry or native-equivalent output.

The first original scan also completed this field stage independently, producing
33,832 vertices and 64,204 triangles with peak owned-job memory of 299,053,056
bytes. All three checkpoint jobs exited successfully with zero owned descendants,
closed handles and no cleanup errors. A retained static instruction explicitly
initializes root depth to zero, contradicting the proposed depth-one explanation
for the exact-lattice plane failure. That quality question remains unresolved.

These runs supply a zero direction initializer and Float32-epsilon provider
tolerance explicitly. They do not resolve native mutable globals, complete
native finalization, compare equivalent native output or validate an integrated
GUI/MCP kernel. Production GUI and MCP still share the existing voxel backend;
no capability, schema or application behavior changed in this checkpoint.

The shared adjacency provider and recovered boundary collector were then applied
to the pinned full-size output. Three analytic bridge controls pass. They found
12,468 unmatched directed edges; retaining the first duplicate key consumes
12,467 records into 122 walks (120 closed and two open). Of 23 three-record
candidates, four classify as isolated-face removals and 19 as distinct-face
caps. No repairs were applied. Larger walks include 2,023 and 3,372 records;
the three-edge helper cannot complete this output. The provider's
`adjacencyValid` flag does not establish manifoldness. Pre-collected pointer
lifetime after move-last deletion remains unresolved. The bounded job peaked
at 113,045,504 bytes and cleaned up successfully. See
[boundary-walk evidence](evidence/repolygon-original-boundaries-20261024.json).

Latest shared-provider checkpoint: reconstruction source preparation can reuse the
application's packed alignment adjacency, directed-edge directory, facet-normal
generator and optimized binary STL topology code. A private bridge passes 82
checks: 42 retained native facet cases, 33 retained native adjacency cases and
seven integration/validation controls. The 19-file provider slice is pinned and
bundles without warnings. No production reconstruction backend was replaced.
See [shared-source evidence](evidence/repolygon-shared-source-20261024.json).

All three original STL files were freshly identity-checked and processed at full
size. Their 3,121,976 vertices and 6,147,452 accepted triangles match the retained
native indexed-buffer hashes. Every facet-normal and neighbor-presence-mask hash
also matches. The repeatable source iterator visited every accepted triangle,
verified its borrowed coordinate/normal views and left the canonical buffers and
original files unchanged. Scan 2's two repeated-identity facets are rejected by
the existing topology producer, matching the retained native accepted count;
the raw total is 6,147,454 facets.

| Original STL |  Vertices | Accepted triangles | Peak owned-job memory |
| ------------ | --------: | -----------------: | --------------------: |
| Scan 1       |   139,338 |            273,139 |     152,780,800 bytes |
| Scan 2       | 1,299,033 |          2,547,403 |     493,121,536 bytes |
| Scan 3       | 1,683,605 |          3,326,910 |     618,008,576 bytes |

This is full-size source-preparation evidence, not a completed Re-polygonize run,
native controller comparison, alignment-quality result or GUI/MCP reconstruction
acceptance. The reused provider's bucket tolerance comes from an explicitly
supplied retained corpus; the current native mutable epsilon remains unresolved.
No native binary was executed. All seven checkpoint jobs ended with expected
exits, zero owned descendants, closed handles and no cleanup errors under the
unchanged aggregate 4 GiB/25% CPU limits. No full application build or new browser
acceptance was run because production code was unchanged.

Latest work-root checkpoint: a sequential private reference now models the
partitioned command path, preserving work-root order, independent corner pools,
inclusive triangle-bounds overlap, clamped descent and worker counter resets.
Eleven focused controls pass; existing suites retain 59 passes and the known
two-source quality failure. This does not validate native parallel scheduling.
See [partitioned evidence](evidence/repolygon-partitioned-20261024.json).

The unit-plane probe selects 64 work roots. Equal corner coordinates in different
roots retain separate records. The offset single-plane output still has nine
vertices, eight faces and unit area, while the aligned plane still emits no
surface. The partitioned two-source probe differs from the single-work-root
reference: it has 21 compacted vertices, 24 faces, area approximately 1.0148563
and one sixteen-edge boundary. Its maximum plane deviation remains approximately
0.0000716 fixture units. These results remain quality-open and are not native
runtime observations. All probes still supply the unresolved globals explicitly.

The worker resets a triangle counter per source/work-root invocation; the
inspected source-slot advance appends sample storage without an explicit reset
of the retained last-triangle identifier. A synthetic one-triangle-per-source
control preserves the resulting collision in this reference. It does not prove
a native application defect or establish behavior on the original scans.
The bounds filter also requires multiplication by the stored reciprocal before
flooring: division differs on a retained Float32 regression. Aggregate private
budgets, preabort behavior and input immutability remain checked.

Latest arithmetic correction: the private selected-cell and sparse-admission paths
now retain a source corner's boundary flag after any successful strict-nearest
boundary update. A later, closer interior sample replaces its distance/direction
but does not clear that flag. Rejected farther or equal-distance samples cannot
set it. This corrects a translation error; it is not a production application
change. Eight new regressions pass, alongside 51 passing affected controls and
the existing failed two-source quality control. See
[boundary-latch evidence](evidence/repolygon-boundary-latch-20261024.json).

The corrected geometric probes derive source boundary flags and face normals.
Their results are unchanged: the aligned plane emits no surface; its offset
counterpart has nine vertices, eight faces, unit area and eight boundary edges;
the two-source result has fifteen compacted vertices, sixteen faces and one
twelve-edge boundary, with the previously recorded plane deviation. A three-edge
repair cannot address that twelve-edge walk. These remain private-port quality
questions, not native runtime defect findings. Direction initializer and adjacency
epsilon are still explicitly supplied as zero in those probes. Earlier code
hashes/results remain historical; this checkpoint pins the corrected sources.

Latest source/construction checkpoint: the successful command construction path
now statically binds the output mesh to the real adjacency builder. A repeatable
packed source iterator passes eleven controls while borrowing Float32 position
and cached face-normal views. It reproduces native vertex-boundary marking,
including internal diagonals whose two endpoints are boundary vertices. Native
epsilon, direction initialization, imported cache equivalence, point-cloud
reconstruction and full original/native acceptance remain open. See
[source/construction evidence](evidence/repolygon-source-construction-20261024.json).

Current checkpoint: private raw extraction, fresh-output compaction and face-normal
arithmetic are implemented. Compaction passes six controls and face normals pass
eight. Angle-weighted vertex normals now pass thirteen controls, including
cached/recomputed face normals, strict squared-edge thresholds, triangle-order
Float32 accumulation and input immutability. JavaScript `acos` is not established
as bit-identical to the native CRT. Raw extraction still fails one of seven controls. Two parallel finite
source planes produce 15 compacted vertices and 16 faces rather than the expected
9 vertices and 8 faces. Their maximum plane deviation is approximately 0.0000716
in the fixture's coordinate units, with a changed boundary. Compaction removes
only one unused vertex. Normals from the traced worker and topological boundary
masks give the same result. The failed expectation remains in place.

An independent unrounded closest-point calculation now explains the finite-plane
deviation under the reconstructed blending rules: averaging distance magnitudes
and normalized directions separately does not preserve the arithmetic-mean plane
at a finite boundary. Its predicted point differs from the port by less than
0.000000018 fixture units. This explains the prototype result; it does not prove
native output parity or close the recorded geometric quality expectation.

Exact-lattice acceptance also remains open: an aligned open-plane probe produces
no crossing cells in the private port; its offset counterpart does. Neither probe
establishes native runtime behavior or an application defect. No application
behavior has changed. See [output/finalization evidence](evidence/repolygon-output-finalization-20261024.json)
and [admission evidence](evidence/repolygon-sparse-admission-20261024.json).
The subsequent [normal/topology evidence](evidence/repolygon-normals-topology-20261024.json)
records the thirteen controls, analytic boundary explanation and six additional
candidate functions with 639 independently decoded instruction starts.

Eight additional candidate functions were traced through source iteration,
compaction, normal generation and three-edge boundary repair, with 997 reported
instruction starts independently decoded. The face-normal worker promotes source
Float32 coordinates before double subtraction, then rounds its double length to
Float32 before division. Complete topology repair remains untranslated. The traced repair handles three-edge loops; it does
not establish a general hole-filling operation. All eleven checkpoint jobs
finished with their expected exit codes, no active owned descendants, closed
handles and no cleanup errors under the existing aggregate 4 GiB/25% CPU limits.

The subsequent topology trace shows directed boundary edges stored in a balanced
tree, with traversal starting from a tree-root record and searching for each next
start vertex. Private tree insertion, successor-copy erasure, rebalancing and
root-seeded traversal now pass thirteen controls. These include ambiguous outgoing
edges and eight deterministic insertion/erasure permutations of 127 records, with
tree invariants checked after each operation. A reserved invalid destination is
removed but not appended to the walk; an earlier failed attempt is retained.
Triangle deletion disconnects reciprocal adjacency and moves the last triangle
into the removed slot, updating back-references. A stable deletion or sorted
boundary traversal would change the recovered ordering. The coordinator's final
point cleanup clears flags; it adds no geometric smoothing. All five subsequent
owned jobs finished with expected exits and clean teardown, at a peak below
860 MB under the same limits.

The [boundary-port checkpoint](evidence/repolygon-boundary-ports-20261024.json)
adds nineteen reciprocal-adjacency/deletion controls, fourteen supplied-loop
repair controls and six analytic integration controls. With explicit adjacency,
the collector and three-edge helper close a tetrahedron's triangular opening,
preserve reciprocal opposite-direction edge links, compact its output and generate
finite unit vertex normals. An isolated triangle is removed, while a quad retains
its four-edge boundary. These checks cover supplied topology, not the native
virtual adjacency builder, original scan inputs or native runtime parity.

The subsequent [computed-adjacency checkpoint](evidence/repolygon-adjacency-20261024.json)
adds fourteen ordered edge-matching controls, ten bucket-selection controls and
five combined checks. Private construction now creates neighbor links from
indexed triangles. A tetrahedron closes with six reciprocal pairs; a triangular
opening is repaired without supplying neighbor links. The combined single-plane
path runs discovered field extraction, compaction, computed buckets/adjacency,
boundary collection and normals, retaining unit area, exact plane location and
eight boundary edges. These controls explicitly supply zero spatial epsilon and
zero direction initializer; neither is established as the native runtime value.

The traced adjacency builder processes triangles wholly within a spatial bucket
before the remaining triangles. Reverse-edge matching retains the first directed
record, links its first opposite incidence and rejects later matching incidences
without replacing the original pair. A control demonstrates that bucket-first
processing can choose a different nonmanifold pair from one global triangle-order
edge pass. The private port preserves this ordering. Its bucket constructor and
selector also retain differing Y/Z bit directions from the static trace rather
than substituting uniform bins.

Nine additional candidate functions and 1,536 instruction starts were checked.
The normal-update wrapper renumbers vertices, updates bounds, recomputes normals
and conditionally builds adjacency. Candidate tables contain different adjacency
entries, including a no-op; at that checkpoint the locator structures alone did
not establish the concrete output object's dispatch. The later construction trace
described below resolves that static ambiguity. The epsilon and descriptor
names are unavailable in the checked static ranges. Selected direct-reference
scans have not established complete initialization or write sets. All eight new
owned jobs finished with their expected exits and clean teardown, with maximum
peak memory of 1,022,193,664 bytes under the existing limits.

The subsequent construction trace follows the command's new output wrapper to
its concrete indexed mesh, then follows that mesh field into the reconstruction
coordinator. The mesh constructor installs the table containing the normal-update
wrapper and bucket-first adjacency builder. This establishes the selected table
on the successful allocation path without executing or observing a native object.
Two new candidate functions and 212 instruction starts were independently checked.

Source preparation clears the vertex boundary bit and marks both endpoints of
each edge lacking a neighbor. The source iterator derives each edge's boundary
status from both endpoints' boundary/nondeleted flags. A quad's internal diagonal
can therefore be marked even when that edge has a neighbor. The new private source
iterator retains this behavior and creates transient triangle views on each pass,
while preserving order and leaving all supplied geometry, normals and topology
buffers unchanged. It requires supplied cached face normals and adjacency; it
does not establish source-import equivalence. No full-size memory benchmark was
run for this iterator.

A selected overlapping-store scan found no epsilon-writing candidate, and eight
retained analysis files lack raw ranges for the epsilon and direction initializer.
These negative checks do not prove a default value or complete write set. All
three owned construction/source jobs finished with expected exits and clean
teardown, at maximum peak memory of 850,329,600 bytes under the same limits.

Two further candidate functions and 268 reported instruction starts were checked
for boundary erasure and rebalancing. All twelve checkpoint jobs ended with their
expected exits, zero owned descendants, closed handles and no cleanup errors;
maximum peak memory was 875,266,048 bytes. Pre-collected triangle-pointer lifetimes
when deletion moves records remain an integration question. Complete native
adjacency runtime/epsilon validation, original Re-polygonize cached-source-state equivalence, mutable
initialization, native parallel scheduling/work-root acceptance and exact-lattice
acceptance are still required. The work-root checkpoint added one candidate
function with 29 independently decoded instruction starts and re-audited 123
context starts. Its seven owned jobs finished with expected exits, zero owned
descendants, closed handles and no cleanup errors, at maximum peak memory of
859,021,312 bytes under the same limits.

These private ports are not advertised application capabilities. The eventual
replacement must use the shared `mesh_process` operation for GUI and MCP, with
full original-input, history, cancellation, save/reopen and rendered verification.

The 2026-10-24 follow-up traced nine more candidate functions through triangle
admission, corner reduction and leaf extraction. Together with the earlier
command-path investigation, 15 functions have been examined. This establishes
concrete differences from ScanForge's current occupancy-shell approximation; it
does not establish native numerical acceptance.

## Recovered behavior

The source encoder consumes triangle records containing three vertex pointers
and boundary flags. The earlier conditional mesh-data branch did not establish
point-cloud support: the subsequent iterator is still consumed as triangles.
Point-cloud reconstruction remains unimplemented and its native contract remains
unverified.

Grid setup creates an eight-child spatial tree. Triangle admission visits cells
overlapping a triangle and retains the nearer absolute signed-distance result
for each source at a corner. Corner reduction prefers non-boundary source
contributions when available, otherwise uses boundary contributions. It averages
signed distances and normalizes the combined direction. The source boundary flag
is latched by successful nearest updates, so changing triangle order can change
which source contributions are preferred. Initialization,
normalization of cancelling vectors, degenerate triangles and the grid rounding
import still require investigation.

Leaf extraction classifies corners with a strictly negative signed distance and
uses Marching Cubes connectivity. All 256 recovered edge masks match both an
independent corner-crossing calculation and Three.js 0.180.0's published masks.
All 256 triangle cases match Three.js's oriented triangle sets. Only 221 rows
match literally; ordering and cyclic rotations must be retained when pursuing
exact output fidelity. The comparison does not permit substituting a different
case order or interpolator without validation.

The edge-position routine projects each endpoint toward its surface using the
absolute signed distance and the reduced direction. It chooses the nearer
endpoint's projection when that distance is strictly below one quarter of the
largest cell dimension. Equal distances select the second endpoint in this
branch. Otherwise it averages the two projections in the recovered arithmetic
order and stores Float32 coordinates. This differs from both binary occupancy
and ordinary linear interpolation of two scalar distances.

These findings provide no basis for changing ScanForge's `0.75 * resolution`
shell radius to another constant. A faithful replacement requires the signed
field, boundary treatment, admission and extraction path together.

## Checks and implementation state

A private position-only arithmetic port was written after observing all 12
analytic controls fail against a stub. All 12 then passed, covering both nearer
endpoint branches, equal distances, strict threshold equality, cell-width
scaling, zero distance, three axes and planes at several offsets and scales.
The planar controls preserve their analytic surface location. They do not prove
the complete native surface has zero offset or that all native arithmetic has
been replicated.

The three new static-analysis jobs completed cleanly with peaks of 756,666,368,
753,094,656 and 739,647,488 bytes. Independent decoding checked another 1,987
reported instruction addresses against archived bytes. The red and green
arithmetic runs and the 256-case comparison also completed with their expected
exit codes. Every owned descendant job ended with zero active processes, owned
handles closed and cleanup errors were empty, under the unchanged aggregate
4 GiB and 25% CPU limits.

No original native application or helper was executed or instrumented. The
historical image was used as static analysis data. Function extents and types
remain inferred; some helpers include shared tail fragments. No fresh native
geometry, whole-output numerical comparison or self-intersection proof was
obtained.

No application behavior changed. The private arithmetic port is not an
application capability. GUI and MCP continue to use the shared `mesh_process`
operation; its existing reconstruction implementation remains native-unverified.
Integrating the complete replacement must preserve its ownership, cancellation,
revision, history and GUI/MCP contracts and undergo full original-input and
project-lifecycle validation. M3 and the full reconstruction goal remain open.

See [structured evidence](evidence/repolygon-native-field-20261024.json), the
[earlier static path](NATIVE_REPOLYGONIZE_STATIC_PATH.md) and the
[measured combined-output candidate](ORIGINAL_STL_COMBINED_OUTPUT.md).

The [distance-arithmetic follow-up](NATIVE_REPOLYGONIZE_DISTANCE.md) traces the
projected predicate, segment degeneracy threshold and normalization arithmetic,
with isolated segment and signed-triangle ports. Complete spatial admission and
application integration remain open.

## Grid, ordered corners and integrated cell checkpoint

A further 2026-10-24 checkpoint added private grid-frame and corner-reduction
ports, then connected triangle sampling, corner reduction, native case ordering
and edge positioning in a selected-cell evaluator. The grid port passes ten
controls, corner reduction passes twelve and the integrated evaluator passes
eight. Each suite first failed against its stub, then passed after implementation.

Grid controls cover lattice snapping, power-of-two extent growth, negative
coordinates, exact growth boundaries, thin bounds and Float32 midpoint rounding.
The port's domain is finite Float32 bounds and spacing above Float32 epsilon.
Its private domain guard is not a recovered GUI admission rule.

Corner controls cover interior preference, boundary fallback, absent samples,
equal source weights, cancelling directions, tiny directions and signed zero.
The accumulator initializer is an explicit parameter. A newly traced native
initializer copies another mutable global vector; the retained image does not
establish that vector's value or complete write history. Zero-initializer
fixtures must not be presented as proof of the native global value.

Integrated controls cover X, Y and Z planes, two-source fusion, case winding,
outside cells and zero-distance boundaries. Their output planes remain at their
expected locations with unit area for the intersected unit cells. This verifies
composition of the tested arithmetic on supplied triangles, with an explicit
zero initializer. It does not include spatial admission, source preparation,
cross-cell deduplication, complete emitter behavior or original input scans.

Three more candidate functions and 277 independently decoded instruction
addresses cover initializer copying, corner-key lookup and child creation. The
static-analysis job peaked at 882,561,024 bytes; all six red/green arithmetic
runs stayed below 35 MB. Every owned job exited with its expected status, zero
active descendants, closed handles and no cleanup errors under 4 GiB/25% CPU.

These remain private arithmetic ports. There is no application or MCP behavior
change and no whole-output native acceptance. Next resolve the initializer and
source preparation, then translate ordered sparse admission, corner keys, child
selection and vertex deduplication before integrating the shared `mesh_process`
replacement. The full nonlicensing feature objective and milestone gates remain.

See [grid and cell evidence](evidence/repolygon-grid-and-cell-20261024.json).

## Connected selected-cell checkpoint

The next checkpoint traced nine more candidate functions and independently
decoded 870 reported instruction addresses. Thirty-three candidate functions
have now been examined. Three additional private suites pass: 18 spatial-key
controls, nine corner-key controls and 12 connected-cell/emitter controls.

Native child zero is the upper-X/upper-Y/upper-Z octant. Child-index bits select
lower axes; points on center planes select the lower child. Corner keys apply
`floor(((spacing * 0.01 + coordinate) - origin) * inverseSpacing)` before signed
32-bit conversion. Output keys instead truncate Float32 coordinates scaled by
10,000 into signed 64-bit integers. Output lookup retains the first inserted
position. These keys must not be replaced by a distance-radius weld or ordinary
rounding. Overflow controls check the conversion arithmetic and do not establish
native GUI coordinate admission.

The native leaf allocates edge vertices in ascending edge order before emitting
its triangle case. The indexed emitter rejects a face unless its Float32-rounded
cross product has squared length strictly greater than `2^-23`. Equality is
rejected. Source progression also appends absent-distance, zero-direction and
clear-boundary slots before advancing existing corner records.

The connected prototype composes the existing selected-cell arithmetic with
ordered output keys and indexed face admission. Controls verify exact edge-ID
and triangle order for a unit cell, shared IDs across neighboring cells, negative
coordinate seams, native octant traversal across four intersected leaves,
quantization collapse and strict face-threshold behavior. The planar fixtures
have their expected area and winding, with no edge incidence above two.

The emitter trace revealed the face gate after the initial seven-control stub
run. A revised twelve-control suite was observed failing eight controls, then
passed all twelve after implementation. The earlier failed run remains retained.
Three static-analysis jobs peaked at 938,409,984, 866,283,520 and 1,099,706,368
bytes. All validation jobs exited with expected statuses, zero active
descendants, closed handles and no cleanup errors under the unchanged limits.

This prototype still receives selected cells, supplied triangles and an explicit
zero initializer. It does not implement complete ordered sparse admission,
global corner-cache updates, source-normal preparation, callback output or full
postprocessing. The upstream initializer vector lies outside captured mutable
data; a selected direct-reference inventory does not prove its complete write
history. No native output, full original input, reconstructed-project or GUI/MCP
acceptance is claimed. Application behavior remains unchanged.

See [connected-cell evidence](evidence/repolygon-connected-cells-20261024.json).

## Sparse admission and shared-corner checkpoint

The next private port discovers cells from triangle bounding-box candidates,
filters them with the recovered plane/nine-axis overlap test, creates lazy tree
children and shares quantized corner records between leaves. It preserves
triangle/source order and skips repeated updates of a corner by the same
triangle. It currently translates the single-work-frontier path with supplied
normals, origin and vector initializer. Partitioned-frontier cache behavior
remains required.

Twelve admission controls and nine shared-field controls pass. A typed-array
control first exposed extra Float32 relative-coordinate rounding; the corrected
port promotes source coordinates into double arithmetic. The shared-field
fixture discovers nine data leaves and 32 corners, allocates 105 tree nodes,
visits 18 candidate cells, admits 16 visits and performs 60 unique
triangle/corner updates while skipping 68 repeats. Controls also check two
source fields, unchanged inputs, pre-abort and failures of explicit private
node/corner/candidate budgets. These budgets are validator safeguards, not
native GUI admission settings or public executor cancellation acceptance.

Three more candidate functions and 336 independently decoded addresses establish
that the recursive pre-extraction helper counts leaves and that the root lookup
checks bounds before descent. The coordinator does assign the corner-map origin:
the register multiplied into that calculation is explicitly zeroed and preserved
by the normal Windows x64 calling convention, so this traced finite-input path
assigns zero. This is separate from the still-unverified mutable vector used to
initialize reduction. An intermediate commentary description calling the map
origin nonzero was incorrect and was corrected before recording this evidence.

The exact-lattice diagnostic uses the same supplied open quad, unit normals,
spacing 0.5 and explicit zero initializer in both cases:

| Plane X | Data leaves | Shared corners | Crossing leaves |
| ------: | ----------: | -------------: | --------------: |
|    0.00 |           9 |             32 |               0 |
|    0.25 |           9 |             32 |               9 |

This is an unresolved prototype quality concern. Source preparation, exact-zero
classification, partition paths and complete extraction/postprocessing must be
checked before any native behavior or usable output is claimed. The diagnostic
does not establish behavior on the original scans or a defect in QuickSurface.

The static-analysis job peaked at 758,423,552 bytes; the current arithmetic and
probe jobs stayed below 35 MB. All jobs exited with expected statuses, zero
active descendants, closed handles and no cleanup errors under unchanged
4 GiB/25% CPU limits. No original native code was executed and no live process
was opened. Shared `mesh_process` behavior remains unchanged; full GUI/MCP,
original-input and project-lifecycle acceptance remain open.
