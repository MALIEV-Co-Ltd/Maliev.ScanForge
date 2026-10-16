# Packed global-alignment target storage

Prepared evaluator nodes now keep their ordered triangle memberships as views
into one typed backing buffer per target. Previously each populated node owned a
separate backing buffer. Child traversal, original face IDs, membership order,
subdivision, normals and boundary masks are unchanged. Shared inputs produce one
shared membership buffer, which the second query worker receives with the
existing prepared-target carrier instead of rebuilding topology.

An internal `compactBounds: true` option additionally removes the retained
24-byte-per-face triangle-bound cache. The index builder still needs a temporary
bound array. That array is privately allocated and detached in `finally` when
`ArrayBuffer.transfer` is supported; older runtimes reclaim it normally. Authored
buffers are never detached. Queries derive tight bounds by selecting extrema
from the immutable Float32 vertices, then use the same distance arithmetic.
The prepared carrier explicitly marks this representation with `deriveBounds`;
a missing bound cache without that flag is invalid.

Cached bounds remain the default. On a warmed scan-3 sample of 825 queries per
timed batch, six alternating pairs had median times of 10.45245 ms cached and
15.2856 ms compact: compact was about 46% slower. These medians average the two
middle samples; the retained benchmark's upper-median fields report about 48%.
It removed 79,845,840 bytes
(76.15 MiB) of retained bound storage for that scan. This is a measured storage
tradeoff, not a query speedup or a whole-process peak-memory measurement. No
automatic size threshold selects the slower representation. Membership packing
applies to both modes.

## Fidelity and integration

The retained native evaluator corpus covers 392 query cases, including exact
winner IDs, Double distance/projection bits and edge flags. All pass with
derived bounds. All three retained owner scans pass ordinary cached preparation
and compact shared restoration: six routes and 396 repeated query comparisons,
plus complete index, normal and boundary-mask hashes. Every route reports one
membership backing buffer; compact routes retain zero bound-cache bytes.
Retained carrier identities are verified, but original source files are not
freshly rehashed by this replay.

The browser regression uses compact prepared targets across two physical CPU
workers. It checks 64 native case comparisons, two pose comparisons, two
single-worker fallback comparisons, 33 prepared-target handoffs and termination
of all 71 worker handles. The synthetic two-scan registration reaches zero plane
gap in five query batches. This does not substitute for full native registration
with the large owner scans.

This changes a private kernel representation used by the shared application
operation path. GUI/MCP routing, schemas, results, defaults and operation gating
are unchanged; no public compact-storage setting is advertised. The production
pool's conservative memory admission remains unchanged. Lower aggregate peaks,
admission of all large scans, full default native registration, and the separate
project-load heap spike still require their own validation.

## Validation record

The fixed validation snapshot used parent `f4baf4b` plus the kernel and test
changes in this slice. The production build passed with no warnings or errors
(`scanforge-deecb8b0652a9d3a`). Six focused files passed 1,025 tests. The full
suite passed 45,966 tests with 49 optional tests skipped and no failures. The
six retained-owner routes were enabled separately and all passed; filtered
routes in each individual invocation were deliberately skipped. Browser
verification passed against the live development source, with no page errors.
Formatting and whitespace checks passed for the files in this slice.
