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
