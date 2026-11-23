# Nearby short disjoint cutter

The source is the one-triangle `../m2-adjacent-seam-20261105/source.stl`.
The cutter has two separate triangles whose edges lie on the source plane. One
edge runs from `[0.5, 1, 0]` to `[0.5, 1.2999999523162842, 0]`. The other
runs from `[0.5000200271606445, 1.0000200271606445, 0]` to
`[0.5000399947166443, 1.0000200271606445, 0]`. The triangles share no
vertices; both ends of the short edge lie within 0.0001 mm of the first edge's
boundary contact.

QUICKSURFACE Pro 8.0.123 imported both meshes in millimetres. Source Edit >
Split Mesh used the cutter, "Split with another body or a mesh", Envelope
unchecked, Preview then OK. No warning was observed. The source showed four
triangles. Export Visible with the cutter hidden produced `native-result.stl`;
the untouched cutter exported separately retained the input coordinates.

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `source.stl`                  | `1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5` |
| `cutter.stl`                  | `f1cd9a480c33eb243156625c3a4c16de85b75e40abc087da14d955ef8a77d78c` |
| `native-result.stl`           | `8ebfdec52e7936e242da3560c23138d91c63ecc173705647ea1378b61ba2a507` |
| `native-cutter-roundtrip.stl` | `c4c86317c5f76c1826378f858dcf16550026c2fc4891ac5ad0113603d1f05ced` |

Native output omits both short-edge endpoints and has triangle area sum 0.5.
Current shared Split differs from native's unordered Float32 facets; parity is
an expected failure. The isolated distance-association prototype also omits
those endpoints but adds a midpoint to the remaining isolated slit and emits
six facets rather than four. STL facet comparison does not establish native
indexed connectivity or winding; this is one on-plane cutter control, not a
general rule for short unrelated cuts.
