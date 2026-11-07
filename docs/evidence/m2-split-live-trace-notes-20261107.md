# QuickSurface Split live trace

QuickSurface Pro 8.0.123's installed executable SHA-256 was
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
REA 6.7.0 attached Frida to the existing process and recorded bounded entry
prefixes and call stacks while Split preview ran on the already split
crossing-pair source. The live chain reached `0x14067df80`, `0x14067cec0`,
`0x14032a500`, `0x1403290a0`, `0x14032c400`, `0x14032dae0`,
`0x14032f980`, and `0x140330350`. See the retained call-trace Evidence
`ev_16e4e024795e9cbe23e15ebe8c9d91dfd9988b24763084a3660a0d24fb7c4db4`.
These observations bind that candidate chain to this preview; the input was
already split and the trace does not prove every branch or output contract.

On the original two-cutter source, four calls to `0x140330350` each had only
one interior point. On a fresh original source with the four-triangle cutter,
the helper was observed with three four-point chains. A repeat preview captured
the relevant point-record prefixes and selected indices. All three chose the
closer of the two points to the endpoint segment, under the one-limb
sign/exponent/magnitude interpretation that reproduces the fixture's known
Float32 coordinates. This is scoped observational support, not proof of the
full arithmetic, tie behavior, segment recovery, or exact Split implementation.
The three Evidence files retain original session messages and report truncation.
The repeat preview had a second hidden cutter object in the scene, but the
Split dialog explicitly selected only the four-triangle cutter.

Two further bounded REA observations of the original two-cutter preview
recorded two `0x14032c400` calls. The returned integer sequences were `[3,4]`
and `[5,6]`; a repeat captured the point-record prefixes for both endpoints.
The first pair decodes to the segment absent from the exported native mesh, and
the second to the retained segment. Both segments therefore reach and return
from this candidate in this run. The later step that removes or fails to retain
the first segment was subsequently located with a third trace: the face list
after recovery of `[3,4]` contains edge `[3,4]`, and the face list immediately
after recovery of `[5,6]` no longer contains it. The latter list contains edge
`[5,6]`. The face list was read at the offset used by the previously decompiled
publication routine. These records and the original call trace are observations
of a small fixture, not complete algorithm extraction.

An additional bounded trace captured the initial native triangulation and the
nested `0x14032dae0` strip-recovery calls. The initial eight faces already
contain edge `[5,6]`. Recovery of `[3,4]` invokes the strip routine across
`[6,5]` and replaces those two adjacent faces; recovery of `[5,6]` invokes it
across `[3,4]` and returns to the initial unordered eight-face set. This pins
the replacement to these calls for this input; it does not prove the native
algorithm's behavior on every crossed strip or its output validation.

A guarded REA CLI/Ghidra function analysis of the earlier runtime-derived image
timed out during full auto-analysis after 177 seconds, with a 2,847,506,432-byte
peak under the 4 GiB job cap and confirmed child cleanup. It produced no new
function dossier. Earlier separately retained, selective no-auto-analysis
decompilation is documented in `m2-split-native-chain-pivot-20261029.json`.
More runtime binding and reconstruction are required before changing the shared
operation; safety checks remain in force.

The two-triangle crossing cutter was also imported with the triangles in the
opposite order. A bounded REA capture, `m2-split-native-reversed-recovery-20261107.json`,
recorded the same two recovery pairs and the same face lists before and after
each call. The QuickSurface preview was accepted, saved as `reversed.qsf`,
reopened with the eight-triangle source, and exported. Its unordered triangle
faces match the earlier native export exactly at Float32 precision. The saved
project also contains two earlier hidden cutter meshes; the Split dialog named
the reversed cutter explicitly. This is one input-order observation, not proof
of a general ordering rule.

On the compiled ScanForge browser build `scanforge-12844615819f2f7e`, the
reversed fixture produced the same geometry digests as the original fixture,
with 10 triangles and area 0.5. Both cutter segments remained represented by
edges; GUI and public MCP geometry matched, undo/redo, binary reopen and both
cancellation checks passed, and no page errors were reported. Peak guarded
job usage was 1,007,370,240 bytes, with no owned processes remaining. An initial
replay failed because the test expected coverage in the original triangle order;
the assertion was corrected and the replay passed. This evidence changes no
production behavior and does not establish full native parity.
