# Native hole-fill comparison

The integrated 64-edge Curvature annulus now matches native geometry exactly in
shared async, GUI and public-MCP checks. See the latest acceptance section below
and [its evidence](evidence/m2-curvature-integration-20261026.json). Earlier
failed stages are retained as investigation history. M2 remains open.

## Partial Tangent curved-annulus control, 2026-10-27

The 64-facet original curved annulus was imported into the native application
and a partial Tangent patch was exported at 164 facets. The input SHA-256 is
`0f383ea9abcf8d76aa41ab01394ea2ee0c11988ff6bb47a683424616a84e9a61`;
the native STL SHA-256 is
`d7a0034352028a3a7ffa857b559e166d534b3eace33deae6d8b9032f0cda1753`.
Sanitized coordinates and selection observations are retained in
`tests/fixtures/hole-observed-semi-tangent-curved.json`. One complementary
arc matches all 164 oriented facets in the shared operation. The captured
chord is a ten-segment Hermite curve; static caller evidence shows zeroed
normal fields for its intermediate vertices. Interpolating those normals
produced a different patch. The retained browser driver also matches the full
oriented native geometry through the GUI and public MCP, preserves the source
corners, and checks Back, Undo/Redo and binary project reopening. The existing
Semi/Flat browser control still passes. See
[the finite acceptance record](evidence/m2-partial-tangent-20261027.json).
This result does not establish parity for other selections or other partial
and bridge algorithms, and does not close M2.

An original 273,139-facet scan also passed a separate four-edge partial Tangent
GUI/public-MCP comparison: both paths produced the same 273,143-facet geometry,
retained all source corners, and passed Undo/Redo. This is a real-input application
comparison, not a native export comparison. Source/output hashes, the selected
boundary, failed driver attempts and resource evidence are in the same record.

The pinned second original STL (2,547,405 facets) was analyzed under the 4 GiB
job limit. Position welding at 0.001 mm reports one nonmanifold edge; the
application's indexed STL import representation instead reports none and has
42 closed boundaries. Its importer accepts 2,547,403 facets, rejecting two with
repeated mapped vertex identities. The opt-in
`tests/original-partial-topology.test.ts` retains both topology controls.
A subsequent isolated partial Tangent fill on boundary 3, vertices 255–263,
added 13 facets with the source unchanged. Replacing a complete edge-map copy
with an immutable overlay reduced the matched owned-job peak from 3,907,825,664
to 2,352,549,888 bytes under the 4 GiB limit. A separate isolated fill, topology packing and hydration probe peaked at
2,504,290,304 bytes, with a 158,647,600-byte packed cache. These measurements
do not establish full project save/reopen or rendered GUI/MCP or native parity
for that scan. The opt-in `tests/original-partial-cache-memory.test.ts` pins this
selection and output; selection details and hashes are in the evidence record.

On the pinned 3,326,910-facet third STL, partial Tangent previously copied
5,009,433 source edge records to construct a small synthetic rim. The solver
now retains only the selected arc and chord edges. In a matched worker-level
probe the owned-job peak fell from 3,660,705,792 to 1,722,908,672 bytes; rim
construction fell from 5.53 seconds to 9.90 milliseconds. Six complete
partial attempts on three boundaries were all skipped and left the source
unchanged both before and after; their job peak fell from 3,817,005,056 to
1,756,082,176 bytes. These measurements do not establish a successful fill or
GUI/MCP/native parity on that scan. Exact scope and hashes are in the evidence.

## Manufactured cup controls, 2026-10-26

Native reference build 8.0.123 imported binary STL cups with radius 2 mm, bottom
Z=-1 mm and an open rim at Z=0 mm. Each comparison started from the original
input. The entire-hole button filled the one selected boundary. Native exports
and screenshots remain outside the repository; sanitized input and Tangent
output coordinates are in `tests/fixtures/hole-fill-observed-cups.json`.

| Rim edges | Input facets | Automatic output                         | Explicit Tangent                     | Explicit Curvature                        |
| --------- | ------------ | ---------------------------------------- | ------------------------------------ | ----------------------------------------- |
| 39        | 117          | 400 facets, no holes                     | Same complete STL bytes as Automatic | 484 facets, four holes and two components |
| 40        | 120          | 424 facets, no holes                     | Same complete STL bytes as Automatic | 384 facets, two holes and two components  |
| 41        | 123          | 376 facets, two holes and two components | Not captured                         | Same complete STL bytes as Automatic      |

An additional explicit Flat run reloaded the saved original 39-edge cup and
closed it with 154 facets, zero holes and one component. The STL SHA-256 is
`19b2a78603b445c9d0b91489d5c3eb52986f7b294eaa51405138f1d2e3c48acd`;
the ordered Float32 coordinate SHA-256 is
`474cd167e8e241e71ea2f5ec0680b9f1e9c75d5e1a1ea7458f1cdf7746e39f98`.
This is exactly 37 added cap facets, without inserted refinement vertices. The
new Flat regression also compares oriented triangle sets, retaining winding
while allowing export-order differences.

The matched-height 41-edge control has input SHA-256
`cfb36f1235043361d42bf634345ddee919d5e30db58a41cd3cba82e1be5d1e94`.
Its Automatic/Curvature output SHA-256 is
`160ba293d3f812f3518ca39c2a445ba9fe7ddfebd30a5976a447e84a95cd03c2`.
An initial separate 41-edge fixture had a different height; it was imported but
never filled and is excluded from this comparison.

These controls bind Automatic to Tangent at 39/40 edges and Curvature at 41
edges. The installed manual's statement “less than 40” does not match this
observed boundary. Native Curvature failed to close these particular cups; its
failed outputs are retained, not treated as successful caps.

## Shared implementation and finite controls

GUI and MCP use the same `scanEdit/fillHoles` worker. Explicit Flat now uses
strict smallest-corner clipping without refinement vertices. Its 39-edge
control matches the complete oriented native triangle set.

Tangent retains Float32 differences, normals, Hermite insertion directions and
emitted coordinates, with native Double scoring/interpolation expression order.
The boundary begins at the native red-black tree root after exposed edges are
inserted in facet/corner order. The terminal triangle reverses all three corner
records. Lowest-ID starts and count-only matching were insufficient; failed
probes remain recorded outside the repository.

Production regressions match every ordered Float32 coordinate for 39/40-edge
Tangent and Automatic controls. A separate 32-edge steep-lip Automatic control
matches all 344 output facets, including minimum cap Z -1.3122670650482178 mm.
The input has 128 facets and the outer boundary remains open. Input SHA-256:
`5f14c3c00e8a06e97d13435e6fab93e143da3c3db3833225240955b97a6af017`.
Native STL SHA-256:
`19081c786b4ab3c6b4cc05a3e174d84202f25b723c2f8f5bc826cf6f69361fcc`.
Sanitized coordinates: `tests/fixtures/hole-fill-observed-steep-lip.json`.

The guarded collar-fit fill remains explicit `algorithm: "surfaceRecovery"`,
GUI **Recover surface**, for entire holes. It retains bounded steep-lip recovery
without presenting that different surface as native Automatic. Partial/bridge
requests reject this algorithm. ShrinkWrap selects recovery explicitly.

## Validation checkpoints

Flat build `scanforge-542e0920973ae120` passed twelve TypeScript batches and Vite
with all 2815 enumerated inputs unchanged. Its fourth rendered replay passed
actual GUI/public MCP geometry, source preservation, Undo/Redo, invalid-selection
rollback and binary project reopening. Earlier selector/busy-history failures
remain retained. The affected repair suite passed 183 tests with exclusive
resource ownership.

The combined build `scanforge-39813075d443eb00` passed all twelve TypeScript
batches and Vite, with all 2820 manifest inputs unchanged. The focused suite
passed 82 tests; affected repair passed 185 and shared-tree Re-polygonize passed 9. Five frozen-asset replays passed: actual binary-STL Flat39, Tangent40,
Automatic39, two-rectangle native batch at 9 mm, and guarded steep-lip recovery.
Each checks real GUI/public-MCP geometry, unchanged source prefix, Undo/Redo,
empty-fill history preservation, failure rollback, binary reopen and reopened
history. Batch geometry and Tangent screenshots were visually inspected.

Every owned job exited with zero live descendants and no cleanup errors. Build
peak was 1,608,749,056 bytes; the largest browser job was 964,517,888 bytes. The
aggregate 4 GiB and 25% CPU policy remained unchanged. See the
[checkpoint evidence](evidence/m2-native-holes-20261026.json) for fixture/receipt
hashes, source identity and retained failed runs. Full milestone acceptance is
still pending.

## Diameter and batch correction

Bounded ordinary static analysis bound the native dialog, MFC message map and
batch delegate. The retained image was neither executed nor instrumented.
Native diameter is twice an approximate enclosing-sphere radius using Float32
extrema and ordered expansion. The selection field adds 0.1 mm. The shared application inventory and filter now use that sphere instead of
the AABB diagonal.

A native control has two congruent 2 by 8 mm rectangular rims, one rotated 45
degrees. Measured fields were 8.346212/8.346211 mm including the margin. A 9 mm
batch filter closed both. Input SHA-256:
`73317ced05c81b39f1e134277d3ab9f0390d80811978c0536e3f7daa19b922bb`.
Batch export: 28 facets from 20, zero holes, STL SHA-256:
`08942053622d9114a7bdc855d340a714c705f3bd972bcfcb5550148939038622`.

Flat was shown, but native batch uses Tangent. Reloading the original and
filling one selected rectangle with Flat produced 22 facets, one remaining hole,
STL SHA-256:
`09c6dcf943f07845af4bf14ec42767ff5e1dfe5d0a1929ca8a25f44b6a702985`.
Inputs and outputs: `tests/fixtures/hole-fill-observed-rectangles.json`.
Batch dispatch and diameter filtering now pass shared core, GUI and public MCP
acceptance on this complete control. Native multiple-hole Tangent is exposed as
`batch:true`; explicit recovery remains available separately.

M2 remains open. These finite controls do not establish arbitrary-rim,
Curvature, partial-hole, bridge or failure-recovery parity. Native Curvature's
failed caps above remain failures, not successful geometry oracles.

The subsequent full candidate suite passed 49,078 tests with zero failures and
64 fixture-gated skips across 700 canonical files. All 2061 compiled runtime,
asset, script and test inputs from the frozen build remained unchanged. The
owned Job peaked at 956,387,328 bytes and finished with no live descendants or
cleanup errors. This is a regression checkpoint, not completion of the open
native or complete-milestone acceptance gates.

## Successful Curvature control under investigation

A fresh installed-native run imported a smooth paraboloid annulus with 512
facets, a 64-edge inner rim at radius 2 mm and an outer rim at radius 4 mm.
Explicit Curvature closed the inner rim and exported 1,702 facets with one
remaining boundary, no nonmanifold edges and consistent winding. Source STL
SHA-256: `d5552bbeead8824441ad7020b9059804702509b0edab2b435cee7d9c9672dcdf`.
Native export SHA-256:
`40b7399e1c31259935ec756ef87d6410365919d322344ed8411a91aad996c298`.

This operation remeshes the surrounding collar: only the 64 outer rim vertices
remain unchanged, and none of the original complete facets remain identical.
The shared application currently preserves that collar and produces 1,346
facets. This is a reproduced mismatch, not an accepted approximation. The
sanitized original/export geometry is retained in
`tests/fixtures/hole-fill-observed-curvature-annulus.json`.
`scan-hole-native-curvature.test.ts` passes the native fixture integrity check
and currently fails the production comparison (1,346 versus 1,702 facets).

Static selected-hole dispatch reaches `14066ede0` from `140671640`. Curvature
enters a separate collar repair delegate at `1403226e0`; the Flat/Tangent path
uses `140ac3cb0`. Function extents and decompiler types remain subject to the
retained image's missing unwind metadata. No retained image was executed.
The owned native session and comparison/static jobs all exited with no live
descendants and no cleanup errors. Curvature implementation and its GUI/public
MCP acceptance remain open.

The recovered fitting field uses `r² log(r²)` radial terms and an affine
component, solved with the existing native scaled-pivot LU arithmetic. A
192-vertex support collar predicts central Z `0.003499632423427601` mm before
the grid's Float32 publication. Quantizing the height relative to its centroid
then restoring the frame gives exactly the observed native coordinate,
`0.0034996371250599623` mm. The current application cap reaches
`-0.019654259085655212` mm. Counts alone therefore do not explain the mismatch.

The new field helper and dense inverse are independently tested, including
frame changes, singular input, cancellation, retained sample ownership and
work-budget admission. The focused/affected run passes 14 tests. This stage is
not yet connected to the application: the complete native Curvature comparison
still fails. No new GUI or MCP behavior is claimed from these helper tests.
Native grid interpolation, tessellation, trimming and collar smoothing remain
to integrate and verify together.

A separate owned native Fit Surface run used the manufactured 192-vertex collar,
Simple, U/V 20, 10% expansion and zero smoothness. Its original IGES export is
SHA-256 `27ee2b342ae4fa562c6bd5535b533b519d9e887daf04ddaa603832e1dfba6b98`.
The exported surface has 21 by 21 cubic controls and center Z about -0.01618438
mm. It does **not** reproduce the hole-fill delegate's recovered field, and is
retained as a diagnostic rather than a Curvature oracle. The whole native
hole-fill STL remains the acceptance target. The owned session exited with no
live descendants or cleanup errors, peaking at 705,880,064 bytes.

Static IAT/export offsets independently bind the internal delegate to
`GeomAPI_PointsToBSplineSurface::Interpolate(Array2OfPnt, ChordLength, false)`:
constructor, Interpolate, Surface and IsDone all imply the same historical
TKGeomAlgo base. This is a static binding against the hashed installed DLL,
not execution of the retained image. The installed DLL reports version 7.7.0;
the application kernel remains the separately pinned OCCT 7.4.0p1 build.

The collar selection starts with 64 incident boundary faces and two synchronous
edge-neighbor expansions produce 128 then 192 faces, referencing 192 vertices
in source order. A nearest-vertex connectivity diagnostic finds 392 of 512
source facets still connected to the corresponding three original vertices,
while coordinates move by up to 0.1483 mm. This diagnostic is consistent with
seam edge optimization and smoothing; coordinate differences alone must not be
interpreted as wholesale replacement of the original mesh connectivity.

Further static frame inspection binds the internal fitting rectangle to the
existing global plane solver and sorted three-dimensional eigen solver. Its
centroid sums source coordinates in order, then multiplies by the reciprocal
count. Rectangle admission tests rotations from -90 through +90 degrees in
three-degree steps, retaining the first strict area improvement, and fitting
adds ten percent to each half extent. The graph frame uses the already recovered
normal/hint constructor and rigid inverse. These are static reconstruction
findings. The frame and collar-identity tests were observed red, then the focused
stage passed 70 tests. The frame, grid and field helpers remain unintegrated.

A private framed-grid probe now uses native binary-STL vertex ordering, the
two-pass collar, source normals, the recovered automatic rectangle, Float32
local coordinates and bounding-box midpoint centering. It reproduces central
Z `0.0034996371250599623` mm exactly after Float32 publication. At 66 native
vertices within radius 0.75 mm, the maximum inverse-XY error is below
`4.8e-16` mm and maximum absolute height difference is `2.72e-8` mm (RMS
`1.06e-8` mm). These are geometric diagnostics on central vertices, not proof
that every sampled vertex escaped native seam smoothing or that the complete
facet stream matches. The probe's first attempt hit the existing public
16-control limit; its corrected private evaluator leaves that limit intact.

The tessellation helper has two branches: a registered-shape branch returns
bounding diagonal times `0.0001`, while a BRep branch uses diagonal times
`0.001` times the surface's stored quality value. The Curvature caller loads
that quality from the surface data before requesting a 28-degree angular limit.
The existing settings-constructor record at `1404e4800` sets quality to `0.1`,
and the fresh Curvature factory does not override it. Preserve the separate
multiplications in the BRep branch rather than assuming bitwise equivalence.
The earlier private WASM probe declared only the registered-shape profile and
does not establish which native branch was used. Its convex-only trim produced
1,896 cap facets and must not be treated as the general native clipping method
or as an accepted whole-hole comparison.

The recovered general trim inserts polyline endpoints, splits intersected
triangle edges in facet/corner order, and classifies the resulting face centers.
The native face-center sum is Float32 before division by three and publication
to Float32. Outside classification uses a perturbed horizontal ray and winding
counts. Deletion at `14031fce0` moves the last facet into the removed slot; stable
filtering would change later source order. A convex polygon clipping shortcut
cannot substitute for this path.

The general trim stage passed its eight manufactured controls after an observed
shared-diagonal failure: it retained area 0.375 instead of 0.5. Collinear points
on an infinite segment extension were being marked as constrained vertices,
preventing a later required split. Marking now requires membership in the
finite segment. Concave and clockwise polygons, endpoint insertion, source
ownership, cancellation and swap-last removal pass. This corrected guard is an
application validity safeguard, not an additional observed native control.

With the recovered frame, actual application WASM tessellation produces 1,544
vertices and 3,014 facets. General trimming produces a 1,048-facet cap with 645
used vertices, one closed boundary, no nonmanifold edges and consistent winding.
The 240-edge cap boundary requires 176 inserted seam vertices beyond the 64
original rim identities. Those counts are consistent with the observed whole
result if the subsequent native seam phase collapses 17 edges; this is a
prediction to verify, not a completed whole-hole comparison.

The recovered collar smoother accumulates Double neighbor fields in facet and
corner order, adds each exposed edge twice, pins the exposed source rim and
publishes only selected vertices through Float32 stores. Its five tests pass,
bringing the staged focused suite to 83 tests. Whole collar stitching, edge
collapse, asynchronous worker integration and GUI/public-MCP acceptance remain
open.

The subsequent shared join stage passed six manufactured controls (89 focused
tests in total). The private whole reconstruction stitches 176 boundary vertices
and collapses 17 edges, producing 1,702 facets and 884 used vertices with one
remaining outer boundary and no nonmanifold or inconsistent edges. These counts
match the observed native result, but geometry does not: nearest-vertex RMS is
about 0.02074 mm and maximum distance is about 0.11093 mm, with correspondence
collisions and differing facet connectivity. These are diagnostic comparisons,
not acceptance. Seam construction and smoothing require further isolation;
the application still uses its previous Curvature path.

The private stage observer further isolates this result: the radius-3.5 mm
source ring agrees within 2.41e-7 mm after smoothing and the outer ring is exact,
but the unsmoothed central cap already has different vertex locations. Rebuilding
a natural CAD face from the same imported surface preserves the mismatch:
54 of 66 native central vertices have a counterpart within 1e-6 mm and the
remaining central differences reach 0.0778 mm. Changing the collar smoother
cannot resolve a mismatch already present before that stage.

Static leaf inspection confirms that facet construction initializes selection
flags to zero, the growth-pass helper clears only facet bit 4, and the smoother's
vertex-preparation helper only assigns consecutive indices. These findings
support the current selection bookkeeping but do not establish mesher parity.
The combined numerical/restore regression run passes 94 tests; whole Curvature,
worker/browser/public-MCP acceptance and milestone closure remain open.

Captured IAT/export correlation identifies the native construction sequence as
`BRepBuilderAPI_MakeFace(surface, 0)`, `gp_Trsf::SetTransformation(gp_Ax3)` and
`BRepBuilderAPI_Transform(shape, transform, false, false)`. The zero tolerance
also has a direct `XORPS XMM2,XMM2` call-site witness. Module bases in this
correlation are inferred from retained pointers and hashed installed exports;
this is not a fresh runtime binding or execution of the retained image.

Building the candidate surface in its local fitting frame and placing the CAD
face afterward improves central correspondence to 61 of 66 vertices within
1e-6 mm. Using the identified Ax3 construction and zero tolerance does not
remove the remaining five central differences. The whole local-placement probe
still has 1,702 facets and 884 used vertices, with maximum nearest distance
0.09897 mm and RMS 0.02017 mm; it remains a failed native comparison.

A controlled all-selected smoothing diagnostic worsens that RMS to 0.03223 mm
and changes center Z from about 0.00350 to 0.00694 mm. It is rejected and does
not change the production selection policy. Further static inspection identifies
the temporary bit allocator and unreferenced-vertex compactor; it does not justify
selecting the entire cap. An independent private 7.7-family CAD comparison is
prepared to separate interpolation and tessellation differences. Application
dependencies and the existing Curvature execution path remain unchanged.

The independent interpolation diagnostic isolates the remaining central mismatch
in endpoint fitting: nine-point Bernstein fits use the original global parameters,
followed by the constrained cubic normal-equation solve. The rewritten TypeScript
grid passes the independent control-net comparison. The independent affine-plane
control reproduces a 3.7992e-7 mm departure from ideal linear UV speed while staying
on the plane within 1.1e-12 mm; its regression retains the 1e-9 mm tolerance against
measured kernel samples and independently checks plane membership.

Using the independent correct controls in the existing pinned application WASM
produces 1,529 vertices and 2,984 facets, with all 66 central reference vertices
within 1e-6 mm. The independent mesh plus shared trim/join also yields all 884
reference correspondences and no missing or extra oriented facets (maximum
nearest distance 6.89e-17 mm). Neither replay establishes integrated application
acceptance. A fresh replay of the current TypeScript controls and the async
worker, GUI and public-MCP acceptance remain required.

The unused-cap ownership control was observed failing with one unused temporary
vertex and collapsed seam records retained. Compaction now preserves every source
record and removes only unreferenced new cap records; its green run is pending.

The fresh current-TypeScript/pinned-WASM replay remains geometrically failed:
1,702 facets and 884 compacted records, but only 816 distinct nearest native
matches, maximum distance 0.10373 mm and 353 missing oriented facets. Its controls
differ from independent interpolation by only 1.24e-10 mm, demonstrating that the
previous 1e-8 control-net assertion was insufficient for adaptive meshing.
The stricter 1e-12 control comparison and the full oriented-connectivity comparison
must pass. Source inspection identifies a specific hypothesis: the right endpoint
Bezier derivative is evaluated through the full forward-difference polynomial;
shortcut endpoint subtraction discards its floating-point evaluation order.
No integrated acceptance or kernel upgrade is inferred from these diagnostics.

## Integrated Curvature annulus acceptance, 2026-10-26

The right endpoint derivative must retain the complete forward-difference
polynomial evaluation. Shortcut endpoint subtraction differed by about 1e-14 mm
before the second direction fit, amplified to a 1.24e-10 mm control difference,
and changed adaptive meshing. After correction, the TypeScript control net is
identical to the independent pinned open kernel. The production kernel remains
unchanged. The regression keeps its 1e-12 control comparison and the whole native
fixture's strict oriented-coordinate digest; no geometry tolerance was relaxed.

The shared async operation uses a request-owned CAD worker, general UV trim,
original-rim stitching, selected seam collapse and collar smoothing. It preserves
source vertex identities and compacts only unused new patch records. The actual
pinned-kernel driver matches all 884 vertex coordinates and 1,702 oriented facets
with zero positional difference, unchanged source buffers and zero leaked handles.
Automatic's greater-than-40-edge dispatch is covered against this same solver.

Frozen build `scanforge-5ac679fa9d720305` passed all 13 TypeScript batches, Vite
and offline generation with an unchanged 2,845-file input manifest. Rendered GUI
and public SDK/MCP runs match the native oriented coordinates exactly and match
each other, including undo/redo, empty-fill history, invalid-selection rollback,
binary save/reopen and reopened history. A further browser run observes the actual
nested CAD worker before `job_cancel`, then confirms zero remaining nested CAD
workers and unchanged source geometry/history. All owned helpers/ports close;
the 4 GiB aggregate and 25 percent CPU limits remain unchanged.

The affected repair suite passes 202 tests. The first full suite has 49,133 passed,
three async test-adapter failures and 64 fixture-gated skips. Awaiting the real
worker response fixes all three failures; the follow-up 80-test worker/native
batch passes. Exact-head full CI remains required before a full-suite green claim.
The initial build's fallback type error, forced-fallback RED, initial output-URI
setup failure and older numerical failures remain separate retained receipts.

This control closes the observed smooth-annulus entire-Curvature mismatch, not
all Curvature input classes, partial/bridge behavior or M2. Native failed cup
controls are still failures and must not be treated as successful-cap oracles.

Current checkpoint `5ada756b6439eb1705a6842f84884a0e9765308e` passed [GitHub Actions run 40265236808](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/actions/runs/40265236808): 49,136 tests passed, 64 conditional skips, all 13 TypeScript batches, Vite/offline build, both CAD smoke checks and whole-repository formatting. The earlier failed full-run receipt remains retained. This verifies that checkpoint; later Unroll changes require their own validation.
