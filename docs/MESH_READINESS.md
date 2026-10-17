# Scan preparation performance

Raw scans use the same `analyzeMesh` kernel for background preparation, GUI scan
editing, `mesh_analyze`, and topology-dependent `mesh_process` operations.

## Change

Welding retains the original Euclidean tolerance, first-coordinate origin,
27-cell search order, first matching representative within each cell, and
triangle/vertex numbering. A growing open-addressed numeric cell index replaces
string keys and per-cell JavaScript arrays. Full Float64 cell coordinates resolve
hash collisions, including coordinates beyond 32-bit integer range. Capacity grows
with occupied cells rather than coordinate range. Cancellation is checked during
both corner processing and table growth.

Per-triangle diagnostic checks also avoid temporary vector arrays, sorting and
sets. The cross-product arithmetic, degeneracy threshold and duplicate-triangle
identity remain the same. Persistent topology format/version and cache limits
remain unchanged because the resulting topology is compatible.

## Exported headlight validation

`Z:/scanforge (2).stl`, SHA-256
`d25fb01797575f1824483752e7992f59512fbf58216cc987a6e4ed0aefb48f32`,
contains 1,998,344 triangles. At the GUI tolerance of 0.001 mm:

| Cold analyzer stage | Before      | After       |
| ------------------- | ----------- | ----------- |
| Welding             | 29.5-35.2 s | 3.0-4.4 s   |
| Complete analysis   | 37.8-50.6 s | 11.5-14.3 s |

Two baseline and three optimized full-file runs retained identical welded vertex
and triangle SHA-256 hashes and all reported topology counts. This includes the
original scan defects; no repair, remeshing, detail loss or source-file change is
part of this optimization. One final in-memory index reuse took 0.0814 ms inside
the analyzer, which does not represent end-to-end GUI/MCP latency.

These are sequential observations on a shared machine, not timing guarantees.
Cold analysis excludes file import, rendering and persistent-cache I/O. Building
adjacency is now the largest remaining cost. This is a resident optimization;
large scans still require memory proportional to their topology and topology-
dependent tools still wait for preparation. Geometry-independent selection and
navigation remain available while the worker prepares the index.

On a 250,000-triangle portion imported through the GUI, Select all succeeded
while preparation was still pending. Background counts then matched MCP
`mesh_analyze`, which reported an in-memory cache hit. No page errors occurred.
The isolated build, 108 focused tests, full suite (46,582 passed; 54 skipped),
scoped formatting checks and browser validation passed.

See [recorded measurements](evidence/mesh-readiness.json).

## Reproduce

Run `node tests/mesh-readiness-benchmark.mjs "Z:/scanforge (2).stl"` for a full
cold analysis and an in-memory reuse check. Add `250000` to limit the triangle
count; add `2292f56` after that count to reproduce the original analyzer. Each run
records input/buffer hashes, topology counts, timings and memory in `.resources`.
Full runs require 4096 MiB free memory, partial runs up to 250,000 triangles require
1536 MiB, and the subprocess has a ten-minute lease. A failed admission must be
retried after capacity becomes available.

`node tests/mesh-readiness-browser.mjs` validates import and selection on a
250,000-triangle portion of the same STL, then compares GUI background counts
with MCP analysis and requires an in-memory topology cache hit. It requires
3072 MiB free memory and a production build. Set `SCANFORGE_READINESS_STL` to use
another binary STL.
