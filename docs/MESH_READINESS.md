# Scan preparation performance

Raw scans use the same `analyzeMesh` kernel for background preparation, GUI scan
editing, `mesh_analyze`, and topology-dependent `mesh_process` operations.

## Compact topology and foreground readiness

The next optimization keeps ordered numeric edge and face directories and flat
vertex-incidence rows. It avoids retaining millions of string keys, edge-use
objects and small per-vertex arrays. Edge directories are immutable; returned
rows are value snapshots. Editing consumers explicitly copy to a mutable Map,
while smoothing/noise caches retain the directory identity.

Topology-free scale, mirror, flip-normal and unroll requests can cancel explicitly
speculative background preparation for the same source. Visible diagnostics,
queued topology consumers and stateful preview ownership remain protected. The
normal processing queue and finite worker leases still apply to GUI and MCP.

Persistent format 2 stores ordered corner references and derives edge endpoints.
The full exported STL packed to 124,242,124 bytes (118.49 MiB), fitting the existing
128 MiB record cap; format 1 would require 187.20 MiB. A fresh browser worker
restored a 250,000-triangle sample from IndexedDB without welding or building
adjacency. See [cache format](TOPOLOGY_CACHE.md) and [readiness](SCAN_READINESS.md).

No extra preparation workers are launched. First-representative welding and
ordered topology have dependencies that require deterministic merging; adding
parallel copies without measured benefit would increase memory pressure. Existing
bounded operation-specific pools are preserved. This change targets measured
scan-preparation costs, not every operation in the application.

On the full 1,998,344-triangle STL, final cold analysis took 8.11 s and adjacency
construction 2.05 s, with analysis RSS 954,544,128 bytes. Welded coordinates,
triangle indices and ordered neighbor/component/boundary hashes matched the prior
candidate and a fresh full-file baseline at commit `febb367`. The fresh baseline
measured 15.89 s and 2,329,915,392 bytes analysis RSS: approximately 49% less cold
time and 59% less analysis RSS in the final version. Earlier baseline runs
measured 11.5–14.3 s on this shared machine.
A fresh paired 250,000-triangle comparison against commit `febb367` improved cold
analysis from 2.52 s to 1.32 s; analysis RSS fell from 669,560,832 to 488,501,248
bytes. Full snapshot packing took 0.56 s and hydration 4.68 s in the final run.
These observations reflect a shared machine; import, rendering, cache hashing and
IndexedDB I/O are outside cold analyzer timing.

The isolated production build passed with zero warnings/errors. The full suite
passed 46,672 tests, with 54 skipped. Browser GUI/MCP counts matched and a fresh
worker restored the same sample from IndexedDB in 0.36 s without rebuilding.
See [compact readiness evidence](evidence/mesh-readiness-compact.json).

The following measurements describe the earlier numeric-welding optimization.
New measurements and their validation scope are recorded separately.

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
