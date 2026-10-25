# Native hole-fill comparison

## Manufactured cup controls, 2026-10-26

QuickSurface Pro 8.0.123 imported binary STL cups with radius 2 mm, bottom
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
