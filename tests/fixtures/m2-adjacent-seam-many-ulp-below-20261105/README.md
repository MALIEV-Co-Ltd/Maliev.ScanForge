# Adjacent seam, many Float32 steps below 0.0001 mm

The source is `../m2-adjacent-seam-20261105/source.stl`. The cutter seam
coordinate is 1.0000499486923218 mm: 419 Float32 steps above the source
boundary at 1 mm. QUICKSURFACE Pro 8.0.123 imported both files in millimetres.
Source Edit > Split Mesh used the cutter, "Split with another body or a mesh",
Envelope unchecked, Preview then OK. No warning was observed. The source was
shown as three triangles and two individual meshes. Export Visible with the
cutter hidden produced `native-result.stl`; a separate export of the untouched
cutter retained all input coordinates.

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `source.stl`                  | `1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5` |
| `cutter.stl`                  | `7fbc905d5e47ad52a8f583307483922d17bbdab0f78353dfb017012b2f91008e` |
| `native-result.stl`           | `dc295b159937de3fbffc20cf3ff2369c61758ca64df953af2e085d86af15abfe` |
| `native-cutter-roundtrip.stl` | `69b475ffbd6c327b4afac8670ba843edd5bc09f76282a3a7529851e562e0e4a1` |

Native retains the boundary contact, omits the cutter-seam contact and has
area 0.5 square mm. Shared Split currently retains both points in five
triangles and two parts; native facet parity is an expected failure. This
control shows that a one-Float32-step-only association cannot reproduce this
native behavior. It does not establish the exact threshold, general matching
rule, winding, or safety for arbitrary meshes.
