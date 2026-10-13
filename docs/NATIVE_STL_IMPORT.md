# Native STL import extraction

This investigation supplies a recovered facet-validation primitive. It does not
yet enable native surface refinement for STL imports. The optimized binary
reader's complete connectivity still needs an original execution check. Its
coordinate keys, hash and map iteration order now have direct execution captures
and a matching port.
GUI and MCP currently share the existing STL import path; neither interface
advertises this incomplete native importer as verified.

## Extracted procedures

The retained loaded image has SHA-256
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
REA extraction established these procedures:

| Procedure     | Observation                                                                                                                           | REA evidence                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `0x1408c8560` | Import entry tests the header for `solid`, `facet`, and `vertex`; binary input tries the specialized reader before per-facet fallback | `ev_cd2e7cdbaf9235598a1d05fc03005a7b0630db7dc162705faa2fc573a7364ae9` |
| `0x1408c5950` | ASCII reader collects three corners after `outer loop`, then calls its insertion helper                                               | `ev_a7eb89fee0ee3ff1b22c24702b00eb67e7c988dd3c733356bd7ef97cc994b8da` |
| `0x1408c5db0` | Specialized binary reader constructs connectivity through its own tables                                                              | `ev_2a4dbbe46487d7ca829cc365fd5ffe92f029de810c3173c9a4633ee2c7c5cb14` |
| `0x1408c7c50` | ASCII facet insertion and vertex table lookup                                                                                         | `ev_0a8063a5d67357ecdc3f796b2ccbada5e42cc9647f6fca3a97cd668bae517126` |
| `0x1408c82a0` | Binary fallback facet validation and insertion                                                                                        | `ev_63d379a1263b516e6516366268101f52a47221be5b06749b3b76eddebb3d0c43` |

The seed addresses were found by bounded read-only scans of RIP-relative
references and PE unwind ranges. Those scans are candidate discovery, not REA
Evidence. REA then extracted the identified functions. An earlier UI trace of
`Open` did not identify a unique handler; it is not used as proof of this route.

## Direct execution and port

`tests/fixtures/stl-facet-native.json` captures direct execution of the original
fallback routine and its original normalization helper. Vertex and facet
insertion are intercepted to record arguments, so this does not test welding,
mesh construction, full import, or the native UI. It is a native runtime capture,
not a new REA Evidence ID. The isolated probe releases its image allocation and
exits; its script, results and cleanup record remain outside the repository.

`nativeStlFacetCoordinates` preserves the recovered rules:

- Coordinates are Float32 and strictly inside the finite Float32 extrema.
- Edges are subtracted in Float32 before conversion to double precision.
- Normalization multiplies by the reciprocal length only when length is at least
  double epsilon.
- The squared cross product of the normalized edges must be at least Float32
  epsilon. This is an angle threshold, rather than a triangle-area threshold.
- Accepted corners reach vertex insertion with `Math.fround(0.0001)` tolerance.

Captures cover ordinary, collinear, zero-edge, narrow-angle, tiny, large, oblique,
nonfinite and extreme-coordinate facets. This primitive is kept out of the
application import path until the optimized reader and vertex table agree with
the original results.

The owner's STL examples contain 273,139, 2,547,405 and 3,326,910 facets. The PLY
examples have different counts and digests. Their previously verified alignment
captures therefore cannot certify these STL imports or their alignment outputs.

## Optimized vertex table

`scan-native-stl-vertices.ts` preserves the optimized reader's coordinate-key and
unordered-table behavior. It is an internal reconstruction component; it is not
yet connected to GUI or MCP imports, and does not enable STL fine alignment.

The original `0x1408c6d40` converts each Float32 coordinate to double, multiplies
by one million, then calls Windows UCRT `llround`. This is a coordinate key,
rather than the fallback's distance-based insertion tolerance. Out-of-range CRT
results are also captured, including zero outside the signed 64-bit range and
the signed minimum at its endpoint.

`0x1408ca030` hashes the little-endian signed 64-bit bytes of each key using
FNV-1a, then combines them as `xHash XOR (yHash << 1) XOR (zHash << 2)` modulo
64 bits. `0x1408c9d80` retains the first value for equal keys, appends new hash
buckets, and prepends collisions inside an existing bucket. Rehashing reinserts
the existing iteration sequence. Bucket counts grow from 8 to 64 to 512, then
double. The linked-list port preserves this order without repeated array shifts.

REA evidence includes hash extraction
`ev_6037fdec49d5a6fe6b5f94f6561e34075315be4bcfb54bf67a08a9b3ba6f740a`,
insertion extraction
`ev_fc4185def6fe21d23fb5141e44a0c88914d2a025cba11d0e318f1c025ca3abb1`,
and rehash extraction
`ev_8cc80d7c22bb899509099bccee7efdcf9f2bc3bb5d6c991fdc04b7f33537ff21`.
The fixtures capture original loaded-image execution, not additional REA
Evidence IDs: 10 coordinate cases, 420 hash outputs, and 653 insertion steps with
63 sequence checkpoints including all three growth transitions. Allocation is
intercepted in the table probe; the original hash, insertion and rehash code run.
These captures do not execute the complete optimized reader or its facet
construction. Spatial bucket assignment and full-mesh connectivity remain to be
verified before either shared application import interface uses this component.
