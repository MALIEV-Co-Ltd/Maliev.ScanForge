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
but is not integrated by this coordinate slice. No multicore/GPU speedup is
claimed for Mirror Mesh.

Validation: `npm run build` passed with zero warnings/errors. The four focused
native/transform/reference/panel files passed 56 tests; `npm test` passed 9,285
tests across 196 files. Scoped formatting, diff and prohibited-name checks passed.
The browser loaded `index-D73-Rlgd.js` from manifest
`scanforge-52da90295a4397f1`. Applying YZ mirror exported all 864 annular
coordinates byte-identical to the native capture, and Undo exported the original
864 coordinate bytes. No native UI, copy mode or arbitrary picked-plane tangent
orientation parity is implied by these checks.
