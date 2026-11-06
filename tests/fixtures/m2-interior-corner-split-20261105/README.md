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
visible in the viewport. The pinned far QSF contains a source block at byte offsets 456–583: five
Float32 vertices and five uint32 index triples. Expanding those indices exactly
matches the unordered STL facets. Its edge joining the two cut endpoints has
two incident faces, with the same vertex indices on both sides. The fixed-offset
interpretation is scoped to this hashed session and is not a general QSF parser. ScanForge matches the far native facets. The current shared operation also matches the near native facets and indexed shared edge; an earlier implementation retained the near endpoint.

The pinned near session has four indexed source points and three faces. Its edge from the source corner to the interior endpoint is shared by two faces. An experimental corner snap matched its STL facets but opened that edge, so facet matching alone does not establish native indexed topology.

On 2026-11-06, an isolated production-browser replay imported the exact source and near cutter STL bytes through public MCP. The GUI result matched all three native STL facets and retained the corner-to-interior edge with two incident indexed faces. GUI and MCP geometry matched through undo/redo, binary project reopening, and cancellation, with no page errors. The bounded Job peaked at 924,762,112 bytes and confirmed cleanup. The [receipt](C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-native-ui-tools/interior-near-corner-indexed-20261106.json) SHA-256 is `3e3f1caac636817cd29281e0164fa3592452fc8070ef5e392177d1d3e7ff0d41`; the browser plugin was unavailable, so the repository's isolated Playwright workflow was used. This result is specific to this fixture, not general native Split acceptance.

The full default Split browser suite also passed with the new near-corner and Float32 coplanar controls included: 18 result entries, no page errors, and a 1,016,598,528-byte guarded peak with cleanup confirmed. Its [receipt](C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-native-ui-tools/split-full-near-corner-20261106.json) SHA-256 is `54b64336428feeb4bd027f036da702f52fbc07f627abc1167f451f1372a1fc67`. The default suite loads manufactured coordinates; the targeted replay above is the exact-file import comparison.
