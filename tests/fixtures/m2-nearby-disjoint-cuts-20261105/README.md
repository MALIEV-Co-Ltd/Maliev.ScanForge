# Nearby disjoint cutter faces

The manufactured source is one triangle with vertices `[0, 1, 0]`,
`[1, 1, 0]`, `[0, 2, 0]`. The cutter has two separate triangles, each with
one edge on the source plane. One edge starts at source boundary point
`[0.5, 1, 0]`; the other begins at the interior point
`[0.5000399947166443, 1.0000499486923218, 0]`. The cutter faces have no
shared vertex. The two endpoints are approximately 0.000064 mm apart.

QUICKSURFACE Pro 8.0.123 imported both meshes in millimetres. Source Edit >
Split Mesh used the cutter, "Split with another body or a mesh", Envelope
unchecked, Preview then OK. No warning was observed; the source showed six
triangles. Export Visible with the cutter hidden produced `native-result.stl`.
The untouched cutter, exported separately with the source hidden, retained its
unordered triangle vertices.

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `source.stl`                  | `1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5` |
| `cutter.stl`                  | `8fde3110427f68f3ec74d76774b7afb5788809bb8d452925c604c6a7f69ce731` |
| `native-result.stl`           | `a5d3c0edb203a7d9b8b49231492025f634aaeb096d896800f276eca9e514ef5f` |
| `native-cutter-roundtrip.stl` | `aa2c14e5cb874f3b2d6bb3cc4498a984523024356d51ae38803d2962c12cd740` |

Native output includes the boundary endpoint but omits the nearby interior
endpoint, joining the cuts in the exported triangle mesh. The current shared
Split matches its unordered Float32 facets in `m2-nearby-disjoint-native.test.ts`.
The earlier isolated distance-association prototype also matched native
facets on this control. This one fixture has cutter edges on the source plane;
it does not establish native behavior for all disjoint cuts, exact tolerance,
winding, output vertex topology, or general safety of welding contacts.
