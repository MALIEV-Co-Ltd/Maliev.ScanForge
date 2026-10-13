# Mirror Mesh coordinate verification

## Exact planar NURBS references

The CAD worker now retains a single planar B-spline face's UV frame from exact
surface derivatives and the complete control net. Rational weights are supported.
Every pole must lie within 0.0000001 mm of that plane; checking only corners or
display triangles is insufficient. The adaptor supplies world coordinates,
including the face location. Reversed face orientation reverses the normal.
Undefined midpoint derivatives omit this optional frame without failing import.
Curved and multi-face objects do not receive a plane frame from this path.

The actual pinned OpenCascade smoke covers planar polynomial and weighted tilted
surfaces, translated/rotated/scaled frames, STEP roundtrips, and a curved patch
whose corners are all coplanar. Native handle and virtual-file cleanup remain
part of that gate. This is an exact CAD producer feeding the already recovered
Mirror frame policy; it does not establish the original application's surface
classification or face-picking behavior.

`tests/fixtures/mirror-nurbs-plane-native.json` retains four fresh executions of
the original Mirror frame/inverse/coordinate instructions using the frame exported
from the imported weighted tilted NURBS face. All 891 Float32 coordinates, frame
bytes, and inverse bytes match the port. Project serialization and Mirror request
tests also retain these outputs. The mapped-image digest and ABI/sqrt adapters
are retained in the fixture provenance; native picking and full UI execution are
outside this numerical capture.

Validation passed: production build without warnings/errors, the actual CAD
WASM smoke with native-handle/file cleanup, 90 focused tests, and all 9,391 tests
across 199 files. The rebuilt browser's restored NURBS reference produced an
accepted copy matching all 864 annular native coordinates while preserving the
source and exact reference BRep/frame. Browser logs were empty of warnings/errors.
The current manifest is `scanforge-71b4cd374058dfc3`; formatting, diff, and
prohibited-name checks passed. The original-instruction probe released both
mapped allocations and exited.

The recovered ribbon builder binds Mirror to `0x84c9`. Its mapped message-map
action is `0x140812d40`; REA Evidence is
`ev_62fedb3b99a167983969f6956ebb3e666b79c2bc81de72bd85a056c219a599f8`.
It activates `MUM_MIRROR_MESH`. RTTI resolves its mode vtable to `0x1411dd968`.
The mode dispatches acceptance to `0x14061f5d0`, whose complete pseudocode and
assembly were recovered. Evidence is
`ev_fddac368011e66e3ba160def0fcb5235d26bb172c9580ee2da46627600243547`;
assembly Evidence is
`ev_9b4a7861a1bbb8daee0ccc18872a378e65a5d5431000e1ff8bee108b1d58cf1a`.

The handler copies or retains the source mesh according to a dialog flag. It
copies the plane frame, inverts it, transforms each Float32 vertex into local
coordinates, rounds all three local coordinates to Float32, negates local Z,
then transforms back and publishes Float32 coordinates. It refreshes mesh
normals and calls the separately recovered Flip Normals virtual method. The
application previously used a direct double-precision plane-reflection formula,
which skips the local rounding and produces different bytes on tilted planes.

Frame construction `0x140365fe0` has Evidence
`ev_6fa04a7facb3082246f49f03c8ce081c01298c9fb43f334f1fa3ff0d8976e4b0`.
It constructs normalized tangent axes from a normal and a hint, choosing a
least-aligned axis if their cross product is too small. Normalization uses
reciprocal multiplication. Inversion `0x1401dd230` has Evidence
`ev_a1012102c4ba616bca1dfd0229a4fa18c69b5b055e4e0a69f959640ddfd30dc4`;
it transposes the rotation and computes inverse translation in a specific
summation order. The application now preserves these operations and the vertex
loop's differing X/Y/Z summation orders.

An isolated probe executes the original frame constructor, normalization,
complete inverse helper and coordinate instructions `0x14061f88d–0x14061f9e4`
from mapped-image SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
An ABI wrapper supplies point/frame pointers and inverse coefficients, preserves
nonvolatile registers and returns immediately after the coordinate stores. The
exit branch and captured sqrt import thunk are adapted; the arithmetic is
unchanged. The sqrt thunk binds to local UCRT. Frame and inverse raw double bits
are retained alongside output Float32 bits, preserving signed zeros through
JSON formatting. Both mapped allocations were released and the probe exited.

Twenty-four cases cover an annular scan, signed zeros, rounding-sensitive and
analytic triangles across XY/YZ/XZ origin planes, an offset XY plane and two
tilted planes. All 5,346 application coordinates match the original arithmetic
bytes; frame and inverse double bytes also match. Input preservation and
cancellation have regression coverage. The analytic reflection test permits
Float32 rounding; the separate native test requires exact bytes.

These are numerical captures with explicit plane inputs, not native UI captures.
Plane picking, native normal refresh, confirmation, copy naming and full history
equivalence remain unverified. The application chooses stable tangent hints from
the normal because its construction-plane metadata does not retain the native
plane's tangent orientation. Origin-plane hints match the recovered policy;
arbitrary picked-plane tangent orientation still needs a matching reference
capture and metadata implementation. The native create-copy flag is recovered
and integrated in the preview/copy slice below. No multicore/GPU speedup is
claimed for Mirror Mesh.

## Picked-plane tangent arithmetic gate

The recovered plane-selection handler `0x14061ffe0` reads the normal at plane
offset `0x38`, center at `0x50`, and tangent at `0x68`. Its cross-product
instructions construct `normal × tangent` as the hint passed to frame builder
`0x140365fe0`. This explains why a normal-only frame can differ in intermediate
Float32 rounding from a frame retaining the plane's rotation about its normal.

`mirror-tangent-native.json` adds 20 numerical captures (4,455 coordinates) over
five explicit planes: rotated XY, rotated oblique, negative normal, parallel
tangent and small tangent. The isolated harness executes the original frame
constructor, inverse and coordinate instructions from the same SHA-verified
mapped image. Hint inputs follow the cross-product arithmetic recovered above;
the complete plane-picking handler is not executed. ABI entry/exit and sqrt
adapters are unchanged from the earlier probe, and facet order still uses the
separately verified winding reversal. Native allocations were released and the
probe process exited.

The Mirror operation and preview session now accept an optional tangent and use
the recovered hint policy when supplied. All new frame, inverse and coordinate
bytes match their captures, including the frame-builder fallback for degenerate
tangents. Existing origin-plane output remains byte-identical. This slice
verifies the numerical consumer. The stored construction-plane workflow is now
integrated below; imported CAD planes without orientation metadata continue using
the geometry-fit fallback and do not establish arbitrary picked-plane parity.

## Stored construction-plane workflow

New fitted-plane references store `planeFrame` with their center, normal and
tangent. The tangent is the original plane geometry's local X direction rotated
by the same quaternion used to construct its display surface. Both project
serializers retain this optional v1 field; parsing validates finite vectors,
unit normal, nonzero tangent, reference-object kind and coplanarity with the
saved geometry. Existing projects without the field remain readable. Uniform
object transforms rotate the axes and move the center with the geometry;
unrelated geometry edits invalidate the stored frame. Mirror reference binding
copies and supplies all three vectors to the verified coordinate consumer.

All 20 tangent captures pass through string and Blob serialization, reload,
reference binding and Mirror with exact native output bytes. Transform and
malformed/stale-frame regressions are included. The browser loaded the current
build, opened the same annular mesh with a rotated oblique reference, accepted a
mirrored copy and saved it. All 864 source bytes remained original, all 864 copy
bytes matched the native reference, and the saved plane frame stayed identical.
No browser warnings/errors were reported. This verifies an explicit stored
reference, not the complete original native plane-picking UI or CAD surface
orientation recovery. Exact analytic CAD plane extraction is covered below;
planar spline faces and selecting individual faces inside solids remain incomplete.

## Exact analytic CAD plane extraction

The CAD worker now reads a single analytic plane face through
`BRepAdaptor_Surface`, `Plane()` and its `gp_Ax3` position. The adaptor applies
the face location, so center, normal and X direction are in world coordinates.
Reversed faces reverse the normal. The stored frame travels through `KernelMesh`
into the imported entity and its project file. Multi-face shapes and non-analytic
surfaces do not receive a whole-object plane frame.

The actual OpenCascade smoke gate constructs a tilted analytic face, exports and
reimports STEP, reimports BRep, then applies translation, rotation and uniform
scale. Every stage verifies unit orthogonal axes and coplanarity with its world
geometry. STEP retains the same frame, and all shape handles and temporary virtual
files are released by the smoke gate.

The browser imported that same STEP face and supplied its extracted frame to
Mirror. Four new original-instruction captures (891 coordinates) use those exact
center/normal/tangent values, including the small nonzero Y component of the
OpenCascade normal. All frame, inverse and mirrored coordinate bytes match the
application and project round-trip tests. The accepted annular copy matches all
864 native output bytes, retains the original mesh bytes and the reference's BRep
and frame, and reports no browser warnings/errors.

The native harness executes the existing SHA-verified original frame constructor,
inverse and coordinate block with the documented ABI and sqrt adapters. It does
not execute the complete native CAD-import or picking UI. Planar BSpline/NURBS
surfaces, coplanar multi-face compounds and face picking within a solid still need
their own surface-frame and interaction work. Numerical references are retained
in `tests/fixtures/mirror-cad-plane-native.json`.

Validation passed: production build without warnings/errors, the actual
OpenCascade smoke gate, 98 focused tests and all 9,383 tests across 199 files.
Scoped formatting, diff and prohibited-name checks passed. The current CAD worker
SHA-256 is `49d6af0ba2a651228b0208f8f80d7f9d392693c98aee52346e8fc1ba7901d726`;
the offline manifest is `scanforge-21a058a1b659d2a9`. Native mapped allocations
were released and the probe exited; no native helper remains running.

Stored-frame validation: production build passed without warnings/errors; 130
focused tests and all 9,375 tests across 199 files passed. Scoped formatting,
diff and prohibited-name checks passed. The browser loaded `index-BTR4kCAz.js`.

Validation for the tangent slice: production build passed without warnings/errors;
all 111 focused tests and all 9,353 tests across 198 files passed. Scoped formatting,
diff and prohibited-name checks passed. The refreshed browser loaded
`index-BBweanhJ.js`, reopened the verified source/copy project and reported no
warnings/errors. This browser refresh verifies the current bundle and project
loading, not interactive tangent picking.

## Preview and source-preserving copy integration

The recovered acceptance handler `0x14061f5d0` reads the create-copy flag at
dialog byte offset `0x1da8` (`param_1[0x3b5]`). When set, it constructs a new
owner via `0x14088aac0`, clones the mesh via `0x140b350e0`, adopts that mesh via
`0x14034aba0`, and transforms the clone. The source is retained. The retained
decompilation and assembly evidence is `ev_fddac368011e66e3ba160def0fcb5235d26bb172c9580ee2da46627600243547`
and `ev_9b4a7861a1bbb8daee0ccc18872a378e65a5d5431000e1ff8bee108b1d58cf1a`.

The application now previews Mirror Mesh from immutable source coordinates with
no welding or topology construction. Accept either replaces the source or adopts
the prepared result into a distinct mesh. Create new object is read at acceptance,
so it can be changed after preview without recomputing geometry. Copies retain
display color, opacity and source attribution, while dropping stale derived
normals, boundaries, selections and fitted-surface metadata. The checkbox defaults
to false as an application choice; the native checkbox default is unverified.
Changing the reference plane invalidates the displayed preview and disables Accept
until another preview is generated. Cancel retains source geometry and history.

All 24 native numerical cases verify preview and copy output byte-for-byte.
Worker tests switch planes using one canonical source and detach every published
buffer, verifying the source remains unchanged and reflection never compounds.
Validation passed: production build without warnings/errors, 98 focused tests,
and all 9,313 tests across 198 files. The browser loaded `index-CaG0T3OR.js`.
Its YZ copy export contains two distinct objects: all 864 source coordinate bytes
match the original and all 864 copy bytes match the native capture. Undo and Cancel
exports retain one original object; Redo restores the same verified pair. Browser
plane-change and copy-option acceptance guards passed, with no warnings/errors.

This integrates the recovered copy branch and verifies its geometry and application
history behavior. It does not execute the complete native clone/history/UI path or
verify native copy naming and metadata equivalence. Picked-plane tangent parity,
native confirmation behavior and native normal-refresh parity remain incomplete.

Validation: `npm run build` passed with zero warnings/errors. The four focused
native/transform/reference/panel files passed 56 tests; `npm test` passed 9,285
tests across 196 files. Scoped formatting, diff and prohibited-name checks passed.
The browser loaded `index-D73-Rlgd.js` from manifest
`scanforge-52da90295a4397f1`. Applying YZ mirror exported all 864 annular
coordinates byte-identical to the native capture, and Undo exported the original
864 coordinate bytes. No native UI, copy mode or arbitrary picked-plane tangent
orientation parity is implied by these checks.
