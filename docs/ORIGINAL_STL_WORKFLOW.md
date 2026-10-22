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
