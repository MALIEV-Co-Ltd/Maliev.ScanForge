# Original three STL workflow validation

The full original STL workflow completes under the 4 GiB process cap, but
**fine alignment from the raw file poses fails the quality gate**. At a
0.5 mm search tolerance, all three local refinements return status `-2`
with zero iterations. The controller stops after one pass. All three poses
remain identity, and every authored buffer is unchanged after cached
**Apply anyway**. Initial zero mean values are not evidence of zero alignment
error. Coarse alignment must be investigated before useful fine registration
can be demonstrated on these inputs.

[Structured evidence](evidence/original-stl-three-workflow.json) pins the exact
build, source, original inputs, browser replay and resource receipts. The tested
base is `5b974e8` plus the five recorded pre-existing working edits; all
1,864 compiler inputs are byte-identical before/after build and replay.
The fresh build passed with zero stderr bytes.

## Original import and authored data

The files contain 6,147,454 declared facets. The native-compatible mapper
rejects two collapsed facets in scan 2, yielding 6,147,452 accepted triangles
and 3,121,976 indexed vertices. All six complete imported vertex/index
hashes match retained native topology fixtures for these exact source SHA-256s.
That is input-topology evidence, not current native GUI or solver equivalence.

Each STL object retains three authored buffers: expanded positions, indexed
vertices and triangle indices. STL import does not supply the PLY files'
additional authored normal carriers. All nine buffers, totaling 332,541,408
bytes, were hashed completely. No scan was downsampled before this workflow.
The first diagnostic stopped at an inappropriate PLY-only five-buffer assertion.
Its 17 owned processes exited cleanly; it did not hit the memory cap. The
corrected harness uses the exact STL schema and preserves every prior resource
limit and geometry/history assertion. Application code was unchanged.

## GUI and MCP results

The actual GUI imported all originals and launched Global Fine Align Preview.
MCP adopted its exact cached output with Apply anyway. History/timeline and
Undo/Redo checks passed, although identity output means this does not validate
a useful non-identity registration.

GUI and MCP reconstruction at 0.5 mm produced identical complete geometry hashes,
topology and diagnostics. The result has 265,792 vertices, 531,944 triangles
and two closed components, with zero boundary, non-manifold, winding, duplicate
or degenerate defects in the implemented topology checks. Targets stayed
unchanged, Undo restored all nine authored input buffers, and Redo restored
the exact output. Each reconstruction used one history step and borrowed
three shared Float32 inputs with zero transfers.

Two components do not establish one usable solid. Self-intersections were not
checked; reported surface offset is approximately 0.375 mm. Reconstruction is
an independent voxel implementation and does not establish native equivalence.

## Resources and current review workspace

Peak Windows Job memory was 2,091,593,728 bytes (1,994.70 MiB), under the
unchanged 4 GiB cap and 25% CPU quota. All 17 owned processes exited, final
active count was zero, process/Job/completion-port handles closed, and all
three temporary ports closed. Capture and cleanup errors were empty. This
is a measured single-run Job peak, not machine RAM, GPU memory or a full
backup/restore/soak result.

A fresh current development workspace on port 5173 has the three originals
loaded, Top view selected and Global Fine Align ready at 0.5 mm. Its three
history entries are imports only; no foreground alignment or reconstruction
was applied. The separate production regression above used pinned built assets.
Foreground warning/error console entries were zero at capture.

No application behavior, MCP schema or agent usage changed. Build and the
affected full-size GUI/MCP replay were run; unit/CAD suites were not repeated
for this evidence-only update. Full native controller/setter/clock comparison,
useful registration quality and the remaining M3 acceptance requirements stay
open.

## Default visible-scene preview: separate node-budget failure

A subsequent full-size replay omits both `fixedId` and `targetScope`. For moving
scan 2, GUI controls and MCP state select `visibleScene`, no bound fixed target,
and scans 1 and 3 in scene order. All six physical landmark pairs are present.
The GUI then reports **Noise tree exceeds its node budget**, and no preview is
published. `prepareNativeAlignmentTarget` reaches the shared noise-tree builder,
whose default guard rejects more than 100,000 generated child nodes. This is a
logical application limit, separate from the expanded-normal acceptance spike.

The explicit-error run peaks at 2,393,513,984 bytes (2,282.63 MiB), below the
unchanged 4 GiB Job cap. Its initial diagnostic missed GUI alert banners and
waited the 780-second work budget; that run peaks at 2,278.77 MiB. Its terminal
trace retains 12,253 responsive MCP calls, so the unchanged intermediate status
file does not establish an MCP stall. The corrected observer reads the GUI alert,
captures its screenshot and public state, then reports failure promptly.
The initial owned GPU process used SwiftShader software rendering; its exact
creation identity matches the retained Job record. Graphics metadata does not
explain away the explicit application guard failure.

All 17 owned processes exit in each run, active count reaches zero, handles and
temporary ports close, and cleanup errors are empty. The independent audit
rechecks all 2,136 source/dist files and both frozen plans, including original
STLs. The fresh build passes with 1,864 unchanged compiler inputs. The
[sanitized diagnostic evidence](evidence/original-stl-default-preview-node-budget.json)
pins both runs and the corrected observer. MCP state inspection is verified;
MCP preview-error parity, post-error geometry digests, Reset/cancellation,
acceptance and the second moving-scan preview were not reached. Native full
controller/geometry comparison remains open. No GUI/MCP behavior, schema or
agent usage changed; unit/CAD suites were not repeated for this evidence-only
investigation. No product fix has been applied.

## Independent first-acceptance coordinates and sampled accuracy

For scan 2 from the fixed-target N-point replay below, a read-only checker
decodes the raw-STL project container with standard gzip
and verifies all nine original geometry carriers against the browser replay.
Without importing application transform code, it applies the recorded coarse
and refinement frames with separate Float32 stores. All 3,897,099 indexed
coordinate elements and 22,926,627 expanded position elements match the accepted
scan 2 SHA-256s exactly; its 7,642,209 triangle-index elements remain unchanged.
This checks coordinate/index publication, not independently reconstructed normals.

Point-to-triangle distances use 1,024 deterministic stratified original indexed
vertices, excluding all picked landmarks, against every triangle in the target
surface. Axis-aligned bounding-box lower bounds prune impossible matches. A hit
requires distance strictly below 0.5 mm. The complete fixed surface contains
273,139 triangles; the reverse final-pose query uses all 2,547,403 moving triangles.

| Sample direction / stage      | Hits / samples | Conditional RMS (mm) |
| ----------------------------- | -------------: | -------------------: |
| Moving to fixed, raw poses    |     10 / 1,024 |              0.36216 |
| Moving to fixed, coarse pose  |    301 / 1,024 |              0.16675 |
| Moving to fixed, refined pose |    299 / 1,024 |              0.16714 |
| Fixed to moving, refined pose |    279 / 1,024 |              0.20813 |

The coarse pose increases sampled overlap substantially. Refinement does not
improve this particular forward sample. Different stages admit different subsets,
so their conditional RMS values are not a fixed-support global error score.
Vertex samples are not uniform area samples, and these partial-overlap results
do not certify whole-scan accuracy or native controller equivalence.

The bidirectional run reproduces all forward results from the first run. Five
analytic distance cases and a Float32 stage-boundary control pass. It finishes
under the unchanged 4 GiB/25% CPU analysis Job, peaking at 857.77 MiB; the retained
child exits, only the owner remains in the final Job accounting, both handles
close and cleanup errors are empty. This private checker peak is not an
application memory measurement. The second moving scan's application acceptance
failure remains unresolved. [Structured evidence](evidence/original-stl-first-acceptance-accuracy.json)
pins the inputs, checker, owner and results. No GUI/MCP behavior or schema changed;
unit/CAD/browser suites were not rerun for this evidence-only check.

## Subsequent full-size N-point replay: memory failure

A separate replay supplied six corresponding original STL vertex pairs for each
moving scan, using scan 1 as the explicit fixed refinement target. Both GUI and
MCP previews produced identical coarse registrations. Scan 2 completed cached
MCP acceptance, retry and complete authored-buffer Undo/Redo comparisons. Its
triangle indices and both other objects stayed unchanged; its positions and
indexed vertices moved. Scan 3 completed both previews but failed during GUI
acceptance. This replay did not exercise the default visible-scene target scope.

The Windows Job emitted `JOB_MEMORY_LIMIT` at a 4,296,564,736-byte peak
(4,097.52 MiB), against the unchanged 4,294,967,296-byte cap. The owner's generic
identity-capture error wraps that explicit resource event; it is not evidence of
a process-identity mismatch. All 17 owned processes exited, final active count
was zero, handles closed and cleanup errors were empty. The complete workflow
failed and remains unvalidated.

The accepted scan 2 contains 22,926,627 expanded normal elements encoded as
Float64, totaling 183,413,016 bytes, alongside Float32 indexed normals. The
shared `indexedRenderNormals` helper currently expands those Float32 values into
a JavaScript number array. Preserving Float32 storage would halve that expanded
numeric payload without changing its values. Across scans 2 and 3, the predicted
logical saving is 211,475,268 bytes (201.68 MiB). This is a source-backed
allocation hypothesis; it does not attribute the entire measured peak or prove
that the proposed fix resolves the failure. No product fix has been applied.

An independent read-only audit rehashed all 2,136 pinned source/dist files and
14 frozen inputs, including the original STL files and landmark fixture. It
verified both GUI/MCP registration pairs, scan 2's complete Undo/Redo carrier
digests, unchanged references and indices, changed moving coordinates, the
memory event and cleanup. Two mutated digest controls were rejected. The fresh
build passed; unit/CAD suites were not repeated for this evidence-only update.
[Sanitized partial replay evidence](evidence/original-stl-coarse-memory-failure.json)
records the exact scope and receipt hashes. Native final-controller equivalence,
independent final alignment accuracy and the full three-scan acceptance remain
open.

## MCP node-budget failure, retries and post-failure close

A follow-up full-size MCP replay reproduces `OPERATION_FAILED` with message
`Noise tree exceeds its node budget` for both moving STL scans against the
other two visible originals. Scan 2's picks, input carriers and compiler inputs
match the preceding GUI error capture exactly. Both job messages match that
observed GUI error. The jobs report `progress:1` while terminal `status` is
`failed`; progress alone must not be interpreted as success.

Identical preview request retries return their original job receipts, and only
two main processing workers are created for the two solves. All nine authored
geometry carriers remain byte-identical after each failed preview and after
closing its session. All recorded history/public-state snapshots retain the
three imports and no redo entries. GUI Cancel closes the first failed session;
MCP `preview_discard` closes the second. These are post-failure close checks,
not in-flight cancellation. Neither scan publishes a preview or accepts geometry.

The independent audit covers nine full carrier snapshots in eight equality
comparisons, rejects one mutated digest, rehashes all 2,136 source/dist files,
and matches all 1,864 compiler inputs to the earlier GUI run. The fresh build
passes. Peak Job memory is 2,384,171,008 bytes (2,273.72 MiB), below 4 GiB.
All 17 owned processes exit, final active count is zero, handles/temporary ports
close and cleanup errors are empty. [Structured evidence](evidence/original-stl-mcp-failure-contract.json)
distinguishes the passing failure-contract diagnostic from the still-failing
alignment workflow. No product fix, schema change or native controller comparison
is established; unit/CAD suites were not rerun for this evidence-only update.

## In-flight cancellation after worker progress

A separate replay cancels both full-size moving STL scans with default
visible-scene targets and the same six physical landmark pairs. Before each
cancellation, a paired processing worker reports progress and `job_get` still
reports `running`. Both worker and public progress are already `1`, which does
not mean the operation has completed. GUI Cancel stops the first MCP-issued
preview; MCP `job_cancel` stops the second. Both settle as `cancelled` with
error code `CANCELLED` and message `Processing cancelled.`

Both processing-worker targets close within the five-second probe budget.
Identical request retries return their original job receipts without another
solve. GUI Cancel closes its draft. `job_cancel` leaves the second draft and
twelve picks active until MCP `preview_discard` closes it. Twenty-one public
digest jobs verify seven complete buffer snapshots: all nine authored carriers
stay identical, and all recorded history/public-state snapshots retain the
three imports and no redo entries. The independent audit rehashes all 2,136
source/dist files and rejects a corrupted digest control.

The fresh build passes with 1,864 unchanged compiler inputs. Peak Job memory is
2,016,997,376 bytes (1,923.56 MiB), under the unchanged 4 GiB cap. All 17 owned
processes exit, active count reaches zero, handles/temporary ports close and
cleanup errors are empty. [Structured cancellation evidence](evidence/original-stl-inflight-cancellation.json)
pins the exact build, replay and audit. This covers MCP-issued raw-mesh jobs
and observed worker progress, not GUI-submitted previews or later native
CAD/controller stages. An early-cancellation peak does not bound a successful
solve or establish a controlled memory improvement. Neither successful
alignment nor acceptance is proved. The node-budget and expanded-normal
acceptance failures remain unresolved; no product fix or schema change was
made, and unit/CAD suites were not rerun for this evidence-only update.

## Joined visible-scene target size

[Read-only joined-tree census](evidence/original-stl-joined-tree-census.json)
explains why the original moving scan 2 fails with both other STL references:
point-pair refinement joins target records before building one query tree.
Scan 1 alone needs 60,538 child nodes and scan 3 alone needs 79,476. Their
joined target needs 275,561 children, exceeding the unchanged 100,000 limit.
The wider joined root cube leaves depth-8 cells above the 0.5 mm threshold;
166,554 additional nodes reach depth 9. Individual cubes stop at depth 8.
The joined leaves contain 6,199,177 ordered triangle memberships.

The private streaming census calls the existing shared target join and
one-level partition operations. Both complete individual trees match normal
production node counts, bounds and ordered membership hashes. Two small
fixture trees also match, and a second joined census repeats the full ordered
tree hash. The normal joined builder reproduces the exact node-budget error.
All six bundled source inputs, the original saved project and cleanup receipts
were independently checked. The final probe peaks at 1,325.82 MiB under the
unchanged 4 GiB/25% CPU Job and exits normally in 11.79 seconds. It releases
completed branches; this is not a full application or fully retained tree peak.

This is evidence for sizing the pending shared GUI/MCP memory fix, not a fix or
a successful joined solve. Application behavior, MCP schemas and agent usage
remain unchanged. No unit, CAD or browser suite was rerun.

## Fully retained joined target and packed transport

[Retained-tree memory evidence](evidence/original-stl-retained-tree-memory.json)
constructs the joined target through the existing independent octant operation.
Seven nonempty tasks fit its unchanged 100,000-descendant limit; the largest
needs 60,161 descendants. The private analysis combines these tasks without
enforcing the application merged-node cap. The normal product build remains
unchanged and still rejects the joined target. Its complete retained object tree
has 275,562 nodes and 6,199,177 leaf memberships, with the exact full ordered-tree
hash from the earlier streaming census.

The existing packed query transport occupies 56,761,900 bytes (54.13 MiB).
Object and packed queries agree on all 207 callback visits and winners across
33 synthetic signed-distance cases. These are traversal and strict-winner
controls, not physical distance or alignment-accuracy measurements. The owned
probe peaks at 1,349.60 MiB under the unchanged 4 GiB/25% CPU Job, completes in
8.64 seconds, observes normal child exit and closes both handles. Eight bundled
input hashes, the original project and cleanup receipts were independently
verified; the five pre-existing working edits remain intact.

This retains the object tree and packed transport, but omits complete application
state, adjacency, worker duplication, solve and acceptance. Its peak does not
prove full application memory use. No application behavior, MCP schema, agent
usage or resource policy changed. No unit, CAD or browser suite was rerun.
The shared memory fix and full native comparison remain incomplete.

## All original target-pair sizes

[All-pair tree sizing](evidence/original-stl-all-pair-tree-sizing.json) extends the
retained-tree probe to the other two original target pairs. Moving scan 1 against
scans 2 and 3 requires 239,075 children and 8,911,540 leaf memberships; its packed
tree is 60.44 MiB. Moving scan 3 against scans 1 and 2 requires 189,548 children
and 4,627,683 memberships; its packed tree is 38.62 MiB. Together with the
275,561-child moving-scan-2 case, every original pair exceeds the unchanged
100,000-node product cap. Normal construction reproduces the cap error in each
case. The largest private branch across all pairs requires 60,161 descendants.

Retained and separate streaming construction hashes match for every pair.
Across all three pairs, 99 synthetic query cases retain identical object/packed
callback sequences and winners over 652 visits. The two new pairings also retain
negative-zero winner bits. Seven repository input hashes agree across all cases;
the original project, process exit and handle cleanup were independently checked.
The largest probe Job peak is 1,947.72 MiB with the existing 4 GiB/25% CPU policy.

These private probes combine independently admitted branches without the product
merged-node cap. They use original poses and omit complete application state,
adjacency, worker duplication, solve and acceptance. Later transformed target
sets are untested. Moving scan 1 is constructor-level evidence; the earlier
GUI/MCP failed-preview checks cover moving scans 2 and 3. No application behavior,
MCP schema or agent usage changed. No unit, CAD or browser suite was rerun.

## Physical queries on the joined target

[Physical query evidence](evidence/original-stl-physical-query-check.json) checks
the complete original scan-1/scan-2 target with the shared full adjacency rebuild
and face cache. Thirty-three deterministic triangle-centroid samples, offset
-0.1, 0 or +0.1 mm along cached normals, return exactly identical signed distance,
closest point, normal and boundary results through object and packed queries.
An independent double-precision closest-triangle oracle checks every target
face through AABB lower bounds: 93,077,886 bounds checks and 536 triangle-distance
evaluations. Maximum unsigned-distance discrepancy is 0.000020504 mm against
the predefined private check tolerance of 0.0002 mm. Five analytic controls,
including a degenerate triangle, pass. No application tolerance changed.

All 75 bundled input hashes, the original project, retained tree hash and owned
process/handle cleanup were independently checked. The probe peaks at
1,300.18 MiB under the existing 4 GiB/25% CPU Job and exits normally in 9.06
seconds. No sampled query reports an open-boundary hit; this does not validate
that branch, native signed-winner arbitration or final registration accuracy.
The samples are not uniform-area coverage. The private build combines admitted
branches without the product merged-node cap, which remains unchanged. No
application behavior, MCP schema or agent usage changed. No unit, CAD or browser
suite was rerun; a complete application solve and acceptance remain unverified.
