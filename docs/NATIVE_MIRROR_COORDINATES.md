# Mirror Mesh coordinate verification

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
