# Imported scanner normal storage

GUI scan opening and MCP `project_import` retain the Float32 normal buffers
transferred by the import worker. Previously both paths expanded mesh and point
cloud normals with `Array.from`, although `Entity.normals` already supports
Float32 arrays. Values and authored-buffer ownership are unchanged; the receiving
entity keeps the transferred buffer rather than another complete numeric array.

This also avoids routing imported normals through the Float64 staging and
JavaScript-array reconstruction used by project transport for large ordinary
numeric arrays. The binary project format already supports Float32 payloads, so
no schema or container version change is needed. Historical files containing
Float64 normal arrays remain supported. GUI and MCP use the same import worker,
project encoder and decoder; no new tool or parameter is introduced.

For N normal components the retained Float32 payload occupies 4N bytes. The
previous packed-double array payload typically occupies 8N bytes, excluding
array headers, capacity, transient conversion allocations and project transport.
These sizes are structural buffer accounting, not a measured whole-process peak.

`tests/import-normal-storage.test.ts` covers mesh and point-cloud import through
the shared MCP operation, verifies exact buffer identity and unchanged bytes
(including negative zero), and checks that imported coordinates remain attached.
The worker's source vectors were already Float32; this changes storage, not the
normal-generation algorithm or its precision.

The full reported loading spike remains a separate measurement requirement.
Large replay attempts must preserve memory admission and runtime abort limits;
an aborted replay is not evidence of successful peak-memory reduction.

## Browser replay

Set `SCANFORGE_ALIGNMENT_EXAMPLES` to the owner-provided alignment scan directory,
then run `node tests/scanner-memory-browser.mjs` with port 5173 serving current
source. The default uses PLY scans 1 and 2. `SCANFORGE_SCANNER_IDS=1` restricts the
input explicitly; `SCANFORGE_SCANNER_NORMAL_STORAGE=legacy` reproduces the former
consumer-side normal expansion for comparison. It does not alter application
source. The test imports through the real worker, renders through the viewport,
encodes/decodes a project with history, checks triangle counts and every normal
value, then releases its viewport and disposable browser.

Admission requires 4096 MiB free; a legacy replay containing scan 2 requires
6144 MiB. A runtime monitor closes the browser below 1024 MiB
free, and a three-minute lease bounds the replay. Reports separate CDP managed
heap from backing storage; they do not represent total RAM, worker heaps or GPU
allocations. Unsampled short phases are not reliable peak measurements.

Observed on the two scans (274154 and 2697877 triangles): the completed legacy
replay sampled about 616 MiB managed heap and 861 MiB backing storage; a completed
Float32 replay sampled about 105 MiB managed heap and 861 MiB backing storage.
The latter run checked restored triangle counts; the legacy replay and focused
round-trip regression additionally checked normal values. Original source file
identities were not freshly rehashed, and these are not native-algorithm parity
claims. Another confirmation attempt was aborted by the runtime memory guard.
These measurements isolate storage effects and do not reproduce the entire
application state from the reported 3 GB event or establish a latency speedup.
