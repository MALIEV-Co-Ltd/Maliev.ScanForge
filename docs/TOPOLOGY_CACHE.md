# Persistent topology cache

Topology preparation is shared by GUI and MCP mesh operations through the processing worker. The optional cache preserves ordered welded vertex identities, facets, edge incidence, neighbors, components, boundaries and diagnostics. It does not replace project recovery or alter mesh-operation schemas.

The content key uses `scanforge-topology-v2`, ordered canonical Float64 source coordinates and weld tolerance. Older keys are disposable misses. IndexedDB database version remains unchanged because records retain the same outer schema.

## Binary format 2

The payload has `format: 2` and fourteen ArrayBuffers:

| Slot  | Content                                                     |
| ----- | ----------------------------------------------------------- |
| 0     | Float64 welded coordinates                                  |
| 1     | Uint32 triangle vertex indices                              |
| 2     | Empty reserved buffer; endpoints are derived from incidence |
| 3     | Uint32 edge-use CSR offsets, including final sentinel       |
| 4     | Uint32 ordered triangle-corner references                   |
| 5–6   | Neighbor offsets and face indices                           |
| 7–8   | Component offsets and face indices                          |
| 9–10  | Boundary-loop offsets and vertex indices                    |
| 11–12 | Boundary-chain offsets and vertex indices                   |
| 13    | Six Float64 diagnostic counts in codec order                |

For corner `c`, the face is `floor(c / 3)`, the directed start is `triangles[c]`, and the end is `triangles[3 * floor(c / 3) + (c % 3 + 1) % 3]`. Edge identity comes from sorting that pair. CSR rows retain edge insertion order; references retain use order. Degenerate facets can have no incidence and remain present in triangles and component membership.

Hydration rejects invalid formats, buffer alignment, offsets, coordinate/index ranges, diagnostic counts, component membership, duplicate corners, repeated edge identities and mismatched incidence. It fills the compact edge directory directly without first creating a Map entry and objects for every edge. Existing checksum verification remains mandatory on persistent reads. Corruption or unavailable storage falls back to normal analysis.

The retained 1,998,344-facet benchmark has 1,010,968 vertices, 3,011,098 edges, two degenerate facets and 5,995,026 edge uses. Its format-2 size measured by a full-scan codec roundtrip is **124,242,124 bytes (118.486523 MiB)**, compared with 196,291,116 bytes for format 1. The exact size is also covered by a lengths-only admission test. Browser IndexedDB reuse was verified on a 250,000-triangle portion; a full-scan browser write was not measured. The per-record 128 MiB, total 256 MiB, eight-entry, age and resource-admission limits remain unchanged.
