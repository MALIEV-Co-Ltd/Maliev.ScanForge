# Scaled adjacent seam, one Float32 step

The source is the same as `../m2-adjacent-seam-scaled-20261105/source.stl`.
The two cutter seam vertices were changed from 1000.0001220703125 to
1000.00006103515625 mm, one Float32 step from the source boundary at 1000 mm.
QUICKSURFACE Pro 8.0.123 imported both in millimetres. Source Edit > Split Mesh
used the cutter, "Split with another body or a mesh", Envelope unchecked,
Preview then OK. No warning was observed. The source was displayed as three
triangles and two individual meshes. With the cutter hidden, Export Visible
produced `native-result.stl`; the separately exported untouched cutter retained
all its input coordinates.

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `source.stl`                  | `a22bfaafb76d72830b40edf646a128b02667b75217f84b4978c4b884faf838ce` |
| `cutter.stl`                  | `e76798500bafb14f072c0eb3bde5b79641bd9b83b90469282f1b0de6b530d524` |
| `native-result.stl`           | `7d3d79e8023f9299b32951aa98e73f53c6c85a208f0fd2d5c15c348b55120087` |
| `native-cutter-roundtrip.stl` | `f91de66e509cfd4a8a458e402bb8ec5e6e550d7e3a6995f29aec1d6fb946deba` |

The native export contains `[500, 1000, 0]`, omits the distinct cutter-seam
contact and has area 500000 square mm. The current shared operation matches
the three retained native unordered facets and reports two parts in
`m2-adjacent-seam-scaled-one-ulp-native.test.ts`. In the
otherwise identical two-step control, native retained both contacts and its
unordered facets matched the application. The gap sizes are approximately
0.0000610 and 0.0001221 mm; these two samples bound an observed change for
this geometry, but do not establish the exact native threshold, its mechanism,
or safe behavior for arbitrary meshes. The comparison ignores winding.
