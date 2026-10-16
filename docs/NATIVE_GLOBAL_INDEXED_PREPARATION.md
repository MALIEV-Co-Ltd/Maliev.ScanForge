# Borrowed indexed evaluator preparation

Global mesh evaluator construction now calls `prepareIndexedNoiseOctree` with its immutable Float32 coordinates, Uint32 indices and already computed Float32 triangle bounds. The index builder validates those bounds against the referenced vertices and retains the supplied buffers. Hidden filtering reuses the existing admitted-face ID table to address original bounds; it does not allocate another compact bounds array. Triangle/corner order and overlap arithmetic remain unchanged.

The existing `PackedNoiseTree` format still contains expanded triangle coordinates. Existing Reduce Noise, refinement workers, surface queries and comparison callers retain that contract. The new indexed carrier uses `coordinates` and `indices`, deliberately omitting the expanded `points` field, so it cannot be passed to expanded-only consumers by its declared type. Both construction paths share root initialization and subdivision. The node and membership budgets, limits, cancellation and completed-geometry cache semantics remain unchanged.

The removed staging allocations were nine Float32 coordinates and six Float32 bounds per triangle: 60 bytes per face, or 15.63 MiB for the 273,139-face retained scan. This is an allocation-structure saving, not a promise that process peak memory falls by exactly that amount. Other phases may become the sampled high-water point after the index buffers are removed.

## Fidelity and scope

Focused regression compares indexed and expanded subdivision across the retained native tree fixtures, checks shared-buffer identity and input preservation, exercises face-to-bounds indirection, and rejects invalid dimensions, indices, limits and inconsistent bounds. Existing native evaluator construction and hidden-filter fixtures also run through the new indexed path.

The complete retained owner scan still matches all 60,539 native nodes and 639,591 ordered memberships through the independent native index hash. All 273,139 facet normals and boundary masks match; every winning ID, signed distance, projection, region flag and target-choice output matches on two passes over 33 native queries. Cached preparation returns the same completed target. No native algorithm or resource guard was relaxed to obtain these results.

This is private preparation used by the query-worker pipeline. No new public GUI/MCP capability, schema or command discovery is advertised. The existing expanded-tool contracts remain intact. Whole-owner browser registration, the remaining large scans, admission estimates and the final shared preview/Apply/cancel/history workflow remain separate gates.

## Measurements and validation

The prior retained-scan preparation observations were 751.11 and 827.48 ms, with sampled process peaks of 103.85 MiB JavaScript heap and 30.24–31.22 MiB ArrayBuffers. Indexed-path observations were 954.56 and 777.81 ms, 97.14–97.54 MiB heap and 20.35 MiB ArrayBuffers. These samples show lower memory, not a demonstrated latency improvement. Timings include instrumented preparation but exclude file loading and subsequent index hashing/query verification; memory is sampled through cancellation checkpoints at most once per 100 ms. These are Node process figures, not continuous allocation peaks, native speed comparisons, browser frame times or GPU memory. Host resource pressure varied during validation.

The fixed validation snapshot uses committed baseline `1121e3c` plus the two owned implementation files and indexed regression. The production build passed before focused validation; 476 focused tests passed, and the explicit retained-owner replay passed. Full-suite and browser results are recorded after execution. Concurrent dirty work is excluded from the snapshot, and temporary validation follows the unchanged admission guards.

The production build passed with zero warnings/errors (`scanforge-fdc777f6dcf730a1`). The complete fixed-snapshot suite passed 45,356 tests across 598 suites, with zero failures and 44 optional skips. Both explicit full-owner replays passed all native hashes and query bytes. Formatting and owned-file whitespace/name checks passed. Later concurrent hole/viewport commits are outside this snapshot's suite results; no owned source paths overlapped them.

The current-source isolated browser Worker passed 784 record queries, 784 packed queries, 240 composed mesh-target comparisons, twelve extent cases, 42 facet cases, five native index-construction cases and three generated adapter cases. A separate physical-worker replay passed all 32 native correspondence cases twice through two workers, plus two changed-pose checks and two forced single-worker checks. Shared buffers were active; all 66 query workers initialized once and terminated, both owned browsers closed, and no browser errors occurred. These are controlled worker checks, not a new whole-owner browser registration result. Native whole-owner parity above remains the separate Node replay.

The compiler, focused/owner tests and full suite exited. The existing validation snapshot is retained after the earlier removal rejection without another deletion attempt. Port 5173 remained available. The existing 512 MiB admission estimate remains conservative and unchanged; this patch does not establish capacity for all remaining full meshes or enable public Global Fine Align.
