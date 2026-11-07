# Adjacent cutter seam, 1000x native control

The source and cutter are the manufactured files in
`../m2-adjacent-seam-20261105`, with all vertex coordinates multiplied by 1000
and stored as Float32. Both were imported in millimetres in QUICKSURFACE Pro
8.0.123. Source Edit > Split Mesh used `cutter`, "Split with another body or a
mesh", Envelope unchecked, Preview then OK. No warning was observed. The
source had five triangles and two individual meshes; the visible source alone
was exported as `native-result.stl`.

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `source.stl`                  | `a22bfaafb76d72830b40edf646a128b02667b75217f84b4978c4b884faf838ce` |
| `cutter.stl`                  | `0cd38794e186f8f38883505719e17105dccbddda8357380c2f1b2b3a1f39e50c` |
| `native-result.stl`           | `3a28b5231d21585cc4ea9bdc062a2eb977e682f87c0c5a070a5687eb1867ea6e` |
| `native-cutter-roundtrip.stl` | `c2bf6f4e3ece4be8c76eaef7a6028b39e7e267598315700636e70eca7017820b` |

The export contains both `[500, 1000, 0]` and
`[500, 1000.0001220703125, 0]`, with triangle area sum 500000 square mm.
The shared application Split produces the same unordered Float32 facet
multiset and reports two parts. By contrast, the original-size native control
omits its one-step interior contact while the application retains it. This
pair demonstrates a scale-sensitive difference on these controls, not an exact
threshold or general native parity. Exporting the untouched cutter separately
with the source hidden retained all its input coordinates. The facet comparison
ignores winding and does not replace GUI/public MCP lifecycle verification.
