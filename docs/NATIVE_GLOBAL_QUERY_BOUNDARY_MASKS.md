# Global mesh query boundary-mask preparation

Target arbitration needs three bits indicating whether each triangle edge has a
neighbor. The previous producer built full neighbor IDs, neighbor-edge IDs and
triangle flags, then converted the neighbor IDs to a one-byte mask. Those three
temporary arrays occupied 16 bytes per face before their eventual collection.

The query-only producer now writes the mask directly while following the same
native spatial buckets, sorted bucket traversal, fallback order and first
directed-edge consumption rules. Pairing sets the corresponding bit on both
faces; an already-consumed reverse edge does not create another neighbor. This
preserves nonmanifold, duplicate and degenerate-edge handling. Hidden neighbors
still count as present; index admission remains a separate operation.

Full adjacency callers retain their original arrays, triangle flags and record
counts. Both paths share the linking logic. The global mesh target cache stores
the direct mask and preserves its existing geometry identity, pose reuse,
failure/cancellation behavior and query result contract. No native distance,
normal, traversal or arbitration arithmetic changes.

For the retained canonical meshes, avoiding the three full arrays removes these
allocations from each target preparation:

| Scan |   Faces | Avoided temporary arrays |
| ---- | ------: | -----------------------: |
| 1    |  273139 |                 4.17 MiB |
| 2    | 2547403 |                38.87 MiB |
| 3    | 3326910 |                50.76 MiB |

These are structural allocation sizes, not whole-process peak measurements or a
latency claim. The spatial edge directory, bucket lists and vertex assignments
still exist. This does not yet share prepared indexes between physical workers
or remove the existing 512 MiB query-pool admission limit.

Validation uses the retained original global adjacency capture (33 cases), the
full adjacency and target/correspondence suites, and an allocation regression
that rejects the full-size neighbor/edge arrays and duplicate per-face byte
storage. The optional retained-owner replay checks the native index, normal and
mask hashes plus all 33 Double query records on the first canonical scan.

The first retained-owner replay passed all hashes and 66 repeated query
comparisons (60539 nodes, 639591 memberships). Its sampled preparation
ArrayBuffer peak was 16.45 MiB, versus 20.35 MiB in the earlier retained run.
The 2547403-face scan also preserved every retained application index, normal
and mask hash; its sampled ArrayBuffer peak was 154.38 MiB, versus 190.82 MiB
previously. These phase samples exclude loading/hashing and are not a controlled
latency comparison or whole-process memory accounting.

The 3326910-face scan completed with 79477 nodes, 4617801 memberships and cache
reuse under the unchanged limits. That is a capacity result: the larger scans do
not yet have full original evaluator captures, and original source-file
identities were not freshly rehashed. Only the retained canonical carriers were
hash-checked. Do not describe these larger-scale results as complete native
registration parity.

This is internal preparation for the existing shared alignment implementation;
it adds no GUI-only action, new public tool or capability advertisement. Existing
GUI/MCP processing that needs full adjacency keeps that API. The complete Global
Fine Align workflow remains subject to its existing native-parity gate.
