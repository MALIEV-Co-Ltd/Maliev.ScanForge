# Complete native source normals for canonical owner scans

The three retained canonical STL topologies now have complete vertex-normal
captures from the original main-image routines. The controlled harness first
executes facet normals at `0x140b35d90`, then vertex normals at `0x140b375e0` with
its refresh-facets argument false. The second routine performs original ordered
angle accumulation and vertex normalization. Its Double `acos` and Float32
`sqrtf` imports bind to the host CRT. The geometry algorithms are not replaced.

| Scan  |  Vertices | Accepted triangles | Normal Float32 values |
| ----- | --------: | -----------------: | --------------------: |
| 1     |   139,338 |            273,139 |               418,014 |
| 2     | 1,299,033 |          2,547,403 |             3,897,099 |
| 3     | 1,683,605 |          3,326,910 |             5,050,815 |
| Total | 3,121,976 |          6,147,452 |             9,365,928 |

The application `noiseNormals` kernel, also used by alignment source preparation,
matches every complete captured normal array by SHA-256. No production algorithm
change was needed. Each native run also rebuilt its complete evaluator and
preserved the prior index, facet-normal and neighbor-mask hashes and every query
record: 99 original evaluator query controls across the three scans.

The [source-normal fixture](../tests/fixtures/global-fine-retained-owner-source-native.json)
records carrier identities, capture and generated-harness digests and the exact
normal output hashes. It cross-references the existing complete evaluator
fixture. Bulk virtual-access, allocation and serial scheduling adapters remain;
the original reader, GUI and OS scheduler are not executed by these captures.
Retained coordinate and triangle carriers are hashed. Original source-file
identities are recorded from earlier evidence and are not freshly rehashed.
Final runs released their executable mappings and helper mappings, and their
process exits were verified.

## Replay

Set `SCANFORGE_NATIVE_OWNER_SOURCE` to the external retained-capture folder, then
run `npx vitest run tests/scan-native-global-source-owner.test.ts --maxWorkers=1`.
The test requires 4096 MiB available before a large replay, aborts below 1024 MiB
or after 90 seconds, and has a 120-second test timeout. The ordinary suite runs
the provenance-binding check and skips the three external-carrier checks when
that environment variable is absent. The separately enabled replay passed all
four tests, including the three full normal arrays.

## Remaining controller boundary

These are canonical STL inputs. They do not replace the missing PLY-file-normal
carriers used by earlier raw-only controller captures. Retained ASC normals and
transformed landmark normals did not match those PLY hashes and are excluded.
Inverting rounded normal transformations cannot establish exact input parity.

The next full mesh-controller capture can use these exact canonical coordinates,
normals and connectivity together. It must attach original mesh evaluators,
preserve evaluator-only target routing and full source records, and compare
complete refinement passes and staged geometry application. This source-normal
verification does not establish full multi-scan registration, production pool
admission, native importer/UI behavior or public Global Fine Align completion.
Existing GUI/MCP schemas, operation gating and defaults are unchanged.

The validation snapshot used parent `f181d90` plus the new fixture and tests.
Build passed with no warnings or errors (`scanforge-23b3c6a650634d47`). The
separately enabled source replay passed four tests. The full suite passed
46,374 tests with 52 optional skips and no failures; three of those skips are
the separately executed large source-normal cases. Formatting, whitespace,
source/snapshot identity and owned-file branding checks passed. No browser
interaction regression was rerun because application behavior and UI source
were unchanged; the live development endpoint remained healthy on port 5173.
