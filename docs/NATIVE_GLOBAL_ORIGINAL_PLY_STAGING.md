# Original PLY import and shared alignment staging

The actual shared `readScan` parser imports all three original PLY files with
exactly the native pre-alignment indexed positions and ordered triangles:
3,381,455 vertices and 6,663,164 facets. Each original file is checked against
its recorded SHA-256 before and after import. All reads use the parser's bounded
slice path, with no whole-file fallback or preview sampling. Units are mm and
the original placement is retained.

The actual alignment-input core derives all 10,144,365 normal components exactly
as captured in the native starting meshes. Scanner-provided normals are retained
separately; they differ from the native computed geometry normals.

The [preceding complete numerical replay](NATIVE_GLOBAL_COMPLETE_NUMERICAL_REPLAY.md)
generated all controller matrices from those same indexed input bytes and the
recorded clocks. This check feeds those computed matrices into the actual shared
`createDatumTransformExecutor().transformScanStages` operation, using entities
constructed from the original-file parser outputs. It matches every final
indexed position and every expanded triangle position against the same-run
native after-state: **70,112,841 Float32 position values, zero differences**.
Topology is retained, expanded normals agree with their indexed authored
counterparts, and all input streams remain unchanged.

## Normal fields have different roles

The table below records the earlier diagnostic checkpoint, before persistent
computed normals were added. The later candidate comparison is described below.

| Buffer                    | Observed comparison                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Alignment-derived normals | All components equal the native pre-alignment geometry normals.                                                                   |
| Authored scanner normals  | Preserved and transformed by the shared operation; they differ from native computed normals before and after alignment.           |
| Display-cache normals     | Produced by the actual shared staging operation; 10,143,619 components differ from the native after-state geometry-normal buffer. |

The prior complete numerical replay's exact final normal result applies to
derived native geometry-normal streams. It does **not** establish native parity
for every authored or display normal field in the application. At that checkpoint the
display cache uses area-weighted sums and recomputes normals from transformed
positions. The alignment normal producer uses native angle weighting. These
source observations explain that the algorithms differ. The hardware follow-up
below now establishes the native normal-buffer source. A visible shading
comparison remains outstanding.

### Static rendering follow-up

The [rendering-path evidence](evidence/global-fine-render-normal-static-20261023.json)
now identifies a smooth fallback branch that reads the stored vertex-normal
components at record offsets `+0x10`, `+0x14` and `+0x18` before submitting each
vertex. Its flat branch reads the stored facet normal instead. A separate
hardware branch dispatches through the renderer property's virtual slot `+0x48`.

That first trace left the hardware buffer builder and external call bindings
unresolved. The subsequent
[hardware evidence](evidence/global-fine-hardware-render-normals-20261023.json)
resolves both. A static-only analysis copy exposes twelve observed vtable entries
while retaining every original section byte. Its record worker copies each
48-byte geometry vertex record unchanged at the normal field in both color
branches. The descriptor declares three Float32 components at offset `0x10`,
with stride `0x30`; the draw path binds that buffer and submits the descriptor.

A read-only check of the identity-bound running reference resolves the actual
imports to `glNormalPointer`, `glNormal3f`, `glVertexPointer` and
`glEnableClientState`. Four code ranges read twice match the static image exactly.
Independent byte decoding verifies nineteen instruction anchors and rejects two
wrong-layout controls. The check reads 56,108 bytes, calls no target functions,
installs no hooks and reads no geometry. All owned handles and processes close.

Both traced native smooth-rendering paths therefore use stored geometry normals.
ScanForge's earlier area-weighted display cache was a difference in normal-buffer
provenance. A faithful correction must retain computed geometry normals separately
from authored scanner normals and preserve their transformation through alignment
and project restoration. Recomputing from rounded final coordinates does not
establish the native stored-normal result.

This establishes data flow, not observation of a particular draw call in the
captured alignment run. GPU lighting, visible shading and rendered GUI/MCP
acceptance remain unverified. The static rendering evidence itself did not change
application behavior.

## Stored computed-normal candidate

The final [stored-normal comparison](evidence/global-fine-stored-geometry-normals-final-20261023.json)
exercises the actual shared import preparation and staged entity transforms with
the same original files. The candidate stores `IndexedMesh.geometryNormals`
separately from scanner-authored `normals`. Import generates native angle-weighted
vectors; each alignment stage transforms those stored vectors in Float32 without
regeneration from rounded coordinates. Indexed display data borrows the stored
carrier.

All **10,144,365** final stored and displayed normal components match the captured
native geometry-normal bytes. All **70,112,841** indexed and expanded position
values still match, and original geometry/scanner buffers remain unchanged. This
closes the earlier normal-buffer discrepancy. It does not establish visible
shading, browser transfer, public workflow or simultaneous three-scan GUI memory
acceptance. The files are compared serially under the unchanged 4 GiB Job cap;
the final run took 21,219 ms with a 980,123,648-byte aggregate peak. It consumes
the controller matrices generated by the final source-pinned numerical replay.
All owned handles closed without cleanup errors; the evidence records exact
source hashes and resource receipts.

The field is carried through shared transforms, processing, project codecs and
MCP geometry inspection/digests. Contract tests cover normal preservation,
history, cancellation and preview invalidation separately from this native replay.
The combined source-mask and computed-normal change remains an uncommitted
candidate until rendered GUI/MCP acceptance and review are complete.

## Scope and resources

The earlier [diagnostic evidence record](evidence/global-fine-original-ply-staging-20261023.json)
pins parser, staging, compiled-core and input identities. The import and staging
run completed in 17,415 ms with a 954,925,056-byte aggregate peak under the
unchanged 4 GiB Job limit and 25% CPU quota. All owned processes exited and
handles closed without cleanup errors. Entity staging used its supported CPU
fallback with zero workers; no browser capability was fabricated.

These are actual shared parser and staging operations used beneath GUI/MCP
workflows. This run does not exercise browser File transfer, worker transport,
public MCP, revisions, history, rendering or save/reopen. The source-mask
application change remains an uncommitted candidate pending rendered GUI/MCP
verification. No application behavior changed in that earlier evidence checkpoint;
the stored-normal candidate and its validation are recorded separately above.
