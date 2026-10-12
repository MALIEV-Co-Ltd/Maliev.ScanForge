# Native Flip Normals verification

The ribbon builder `0x1402f09d0` binds the Flip Normals string at
`0x141165eb8` to command `0x8169`. The message table routes its action to
`0x1407e2210` and enabled-state query to `0x1407e2290`. REA handler Evidence is
`ev_f015d139a5ac3b04593c9c35dceb928eb01dc495d0f498c6378875e3f13b92ef`;
assembly Evidence is `ev_825ea826ddb51e9d847889dfd582f43de989055893f186fd386c1594bbc409af`.
The handler calls mesh virtual slot `0x20` directly, clears owner state at
`0x2b8`, sets display state at `0xec`, and notifies the workspace. It does not
open a tool dialog or preview session.

The mesh vtable resolves this slot to `0x140b38d10`. Kernel Evidence is
`ev_2996128a273ff271f41ae62b7225797fdfd105aeb52e4c7940744759b2c84f50`;
assembly Evidence is `ev_a7abddee2e0645b273bd3706bb1f958202b210c0ee2f4195209d18884fb62c00`.
It swaps facet vertex pointers one and two, XORs all three stored facet-normal
sign bits, updates reciprocal edge slots, swaps edge-zero/edge-two links and
their reciprocal slot indices, then calls vertex-normal refresh `0x140b375e0`
with mode zero. It clears two validity bytes at mesh offset `0x119`. No vertex
welding or topology construction occurs in this routine.

An isolated probe executes that original complete facet loop from mapped-image
SHA-256 `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
Adapters provide indexed facet lookup and count; final vertex-normal refresh
is replaced with a recorder. No facet-loop or reciprocal-link instructions are
patched. Five captures cover the annular source, signed-zero and Float32-rounding
triangles, disconnected shared-vertex fans, and a degenerate triangle. All 963
output coordinates are retained as raw bits. The probe checks normal sign bits,
reciprocal adjacency, unchanged vertex bytes, validity invalidation and refresh
dispatch. Two flips restore every facet byte. The mapped allocation was released
and the probe and REA processes exited.

The application ribbon now executes Flip Normals directly as one history edit.
Its existing winding kernel matches all five coordinate captures byte-for-byte,
including signed zeros; it preserves input and restores the same bytes after
two flips. The command uses the existing processing-worker request and CAD-source
guard. Browser verification checks direct execution, exports, two flips and Undo
on the same annular source.

These captures use synthetic native object structures. They do not execute native
UI, notification/history internals or final vertex-normal refresh. The application
regenerates render normals and invalidates its geometry topology cache after
winding changes; matching native in-place cache updates remains a separate task.

Validation: production build completed with no warnings/errors; 37 focused
transform, reference, panel and native tests passed, followed by 16 native/ribbon
checks after updating the evidence mapping. All 9,251 tests across 194 files
passed on the final sources. Scoped formatting and diff checks passed. Browser
asset `index-C3iKMmHF.js` and manifest `scanforge-9258b8a5743f2ec9` were verified;
the final 864-coordinate export matches the native annular bytes. Browser
warnings/errors were empty and temporary cache bypass settings were restored.
