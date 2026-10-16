# Project loading memory and responsiveness

Project restoration previously decoded and repeatedly validated large arrays on the UI thread, then rebuilt uncached display normals using ordinary JavaScript coordinate arrays and string-key welding tables. Automatic backup also structured-cloned large ordinary arrays into its encoder worker. Those temporary allocations survived until garbage collection; their lifetime explains a heap rise followed by a later drop. This is allocation pressure, not by itself evidence of a retained-memory leak. Collection and synchronous processing both interrupt navigation.

Restoration now performs decoding, validation and current mesh display preparation in a disposable worker. A typed hash table preserves the previous weld order and Float32 normal arithmetic. Large ordinary numeric arrays use lossless transferable staging buffers; reconstruction yields between bounded chunks. Existing authored/history buffers never detach. File format 2/3 and public GUI/MCP contracts remain unchanged.

## Controlled evidence

The display comparison uses the complete three owner PLY inputs, with hashes recorded in `tests/fixtures/smooth-display-owner-baseline.json`. This is comparison against the previous application display helper, not native algorithm parity. All position and normal output hashes matched exactly.

| Input     | Previous helper | Typed helper | Previous phase-marked heap | Typed phase-marked heap |
| --------- | --------------: | -----------: | -------------------------: | ----------------------: |
| ply-1.ply |          333 ms |        76 ms |                    148 MiB |                  44 MiB |
| ply-2.ply |         3823 ms |       730 ms |                    862 MiB |                 280 MiB |
| ply-3.ply |         4903 ms |      1230 ms |                   1727 MiB |                 368 MiB |

These are helper timings excluding input expansion. Heap marks are sampled at instrumented phases, not continuous absolute high-water measurements.

A fresh owned browser replay imported ply-1 and ply-2 (2,972,031 triangles), created an automatic backup, restored it using public MCP `backup_restore`, checked geometry counts/history, and exercised orbit/pan/zoom. Before the decoder/transport fix, restore reached 1460 MiB with a 1301 ms longest frame, and a later automatic backup caused a 2319 ms frame. Afterward restore reached 1035 MiB with a 167 ms longest frame (183 ms on the regression rerun); navigation's longest frame was 16.9 ms, and the settled observation's longest frame was 16.9 ms. No UI-thread display welding occurred. The decoder terminated after its single result. This replay isolates the loading path and does not reproduce every allocation in the owner's existing browser session.

## Regression and limits

Run `SCANFORGE_ALIGNMENT_EXAMPLES` pointing to the owner scan folder, then `node --max-old-space-size=768 tests/project-restore-memory-browser.mjs` with the current application on port 5173. The harness uses an isolated browser, checks source hashes, preserves the user's browser state, records memory/frame/worker evidence under `.resources/project-restore-memory-browser`, and closes its resources under a six-minute lease. It requires 3072 MiB free memory. Frame budgets are 500 ms for restore/settled and 100 ms for navigation on this workload; they are regression ceilings, not an instant-loading guarantee.

Unit coverage checks exact legacy weld output, allocation structure, lossless numeric transfer/shared identities, authored buffer retention, cloud placement, cancellation, malformed replies, worker expiry, codec round trips and backup behavior. Current meshes are prepared eagerly; distinct historical geometry is prepared when needed. Large imports still have other main-thread work (the measured startup longest frame was 634–801 ms across the two replays). This change does not claim that all loading work or all future history navigation is free of stalls. GPU geometry copies and worker heaps are separate from the status bar's UI-heap reading.

The final validation passed an isolated production build and 151 focused tests. The complete current-tree suite passed 43,417 tests with 40 optional skips and zero failures. The saved browser regression passed its frame budgets, retained both mesh counts/history, reported no browser errors, and released its decoder and owned browser/bridge.
