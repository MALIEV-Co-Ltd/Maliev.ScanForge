# Interior Split endpoints near a source corner

The source is a single triangle with corners [0,0,0], [1,0,0], [0,1,0].
Each cutter is one triangle with an edge on the source plane, from an interior
point to [0.4,0.4,0]; its third point is [0.2,0.2,1]. Near starts at
[0.0004,0.0004,0], about 0.000566 mm from the origin; far starts at
[0.001,0.001,0], about 0.001414 mm away. Exact Float32 inputs are in the STLs.

QUICKSURFACE Pro 8.0.123 imported the source and each cutter in millimetres.
Edit Scan > Split Mesh used the cutter with Envelope unchecked, Preview then OK.
Export Visible with only the source visible produced each native STL. Near
produced three triangles using the origin in place of the near endpoint; far
produced five triangles retaining the far endpoint. Both triangle area sums
are 0.5 square mm. With only the cutter visible, a separate export retained all
input Float32 coordinates for each case. Native sessions are saved outside the
repository as `session-near.qsf` and `session-far.qsf` in the work directory.

| File                      | SHA-256                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| source.stl                | f58fac8359d3cd2936682d4730f955acd5f899a224d343337d7acdb3f3e124a6 |
| cutter-near.stl           | 7873e556fb2a1187dee21284b7c6eed5364c7864122f68b184b1604d739370a9 |
| cutter-near-roundtrip.stl | 1274b48c54bd9eb81c783e8c2a8ca2e73c17d0fc8cebf7bd23a6307c13483956 |
| native-near.stl           | 2de05dd96287f79342fc94ebd33dad0da2703e75a7ada8a547a316792fb66004 |
| cutter-far.stl            | 39ac42c54f52f309e25b9ef1482eabc11287dd35fac621f3da277aa6f606e12c |
| cutter-far-roundtrip.stl  | 36082a23e861ee2c1007c744ea036fcb1135c3c6ac6ce4bd82a6185a57ca7d5d |
| native-far.stl            | 73aa28526cdbb2754a064222b9f1eed58666f084614beae4be3ce713148a43f1 |

The STL files do not themselves establish indexed connectivity. The observations
support this pair of fixtures, not a general snapping rule.

The far native source's object tooltip reported five points and five triangles;
Edit Scan reported one individual mesh. Reopening `session-far.qsf` showed the
source with five triangles and the cutter with one triangle; the source was
visible in the viewport. The pinned far QSF contains a source block at byte offsets 456�583: five
Float32 vertices and five uint32 index triples. Expanding those indices exactly
matches the unordered STL facets. Its edge joining the two cut endpoints has
two incident faces, with the same vertex indices on both sides. The fixed-offset
interpretation is scoped to this hashed session and is not a general QSF parser. ScanForge currently emits
seven facets for each input, including a synthetic midpoint; its near result
also retains the near endpoint. Both native facet comparisons are pinned as
expected failures and are not GUI/MCP parity claims.
