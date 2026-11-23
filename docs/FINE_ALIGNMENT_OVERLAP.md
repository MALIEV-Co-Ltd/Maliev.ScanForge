# Fine alignment on the owner PLY scans

The large edge shift was caused by fitting non-overlapping and opposite-facing
surfaces as though 85% of the moving scan belonged to the shared region. More
iterations, denser samples, and point-to-plane fitting alone did not fix it.

## Original command evidence

The installed original was version 8.0.123.0, SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
Its observed dialog exposes **Search tolerance**, initially 3 mm. Static command
`0x1407fc100` calls controller `0x140aaa570` with sample budget 3000, the entered
tolerance, and target minimum extent 0.5. It collects other visible meshes/CAD.
The original optimizer's success flag is not an RMS accuracy certificate.

Read-only process observations found target mode byte `0x14764d8c9 = 0`, logical
lane count `0x14159f5a4 = 24`, and tolerance `0x1415dbfb0 = 3.0`. Mode zero uses
compound triangle targets. Pairwise workers `0x140aa96b0` and `0x140aa9a20` call
triangle query `0x140213e90`; initialization rejects normal disagreement beyond
60 degrees and unsupported boundary correspondences. The alternate evaluator
property and Global Fine Align have separate contracts.

[Retained REA records](evidence/fine-alignment-native-command.json) contain
decompilation of a focused **analysis-only derivative**, not executions of the
installed GUI solver. Code/read-only bytes were copied twice from the running
process and compared; no process writes, hooks, or foreign calls were made.
The derivative SHA-256 is
`66e9b2f93002590ba772cc89d98975506068769482e5565b5dd5ab68dc52c0c2`.
Its code ranges are RVA `0x6a3000..0x6a5000`, `0x7fc000..0x7fe000`,
`0xaa8000..0xaac000`, and `0xb23000..0xb27000`, with captured read-only data.
Other sections/imports are unavailable; analyst export seeds identify entries.
The derivative was never executed. Evidence IDs for the command/controller are
`ev_2788def0a2f35f1699f3fdf9bbc7fc96257b63377f40462730eea159039948ff`
and `ev_e2228657068b84a598e1f34001399369cf11fca4f9eca443f82c8b1700abe121`.

## Root cause and fix

An independent 10,000-vertex check on raw PLY-2 to PLY-1 found closest-15% surface
RMS about 0.02460 mm and closest-25% about 0.07237 mm. The accurate same-facing
matches span the part's full bounds. After the old 85% dense fit, close
opposite-facing matches increased from 2 to 1729, and the source slid about
2.2 mm in Z. This is different scan coverage, not a requirement to force the
whole-cloud RMS below the overlap target.

The shared fine-alignment operation now queries complete visible mesh surfaces
with the recovered closest-triangle kernel. It retains point matching for cloud
targets. Coordinate-aligned normals, where available, reject nearest matches
more than 60 degrees apart. Rejection does not retry a farther face across a thin
wall. Initial insufficient compatible overlap leaves the geometry and history
unchanged. Both final RMS metrics independently evaluate every eligible stored
source coordinate; only overlap RMS gates target accuracy. Missing compatible
matches produce null overlap RMS. The fitting-count slider remains independent
of final verification, and normals/surface buffers are host-owned inputs.

The configurable dense ICP operation is an application extension. Its overlap,
target RMS, best-pose safeguard and sample-count controls are not original
dialog controls. The separately exposed `nativeRefine` optimizer remains
unchanged. This change does not claim identical full native CAD/controller or
alternate-evaluator behavior.

## Validation

All 1,375,494 raw PLY-2 vertices were evaluated against PLY-1 triangles, with
20,000 fitting samples, radius 10 mm and target RMS 0.5 mm:

| Requested overlap | Outcome                                    | Final overlap RMS                             | Whole-cloud RMS |
| ----------------- | ------------------------------------------ | --------------------------------------------- | --------------- |
| 85%               | Insufficient overlap, exact unchanged pose | 0.734186 mm over the smaller available subset | 1.674207 mm     |
| 15%               | Target reached                             | 0.024244 mm                                   | 1.674137 mm     |
| 25%               | Target reached                             | 0.087096 mm                                   | 1.674011 mm     |

The 85% request requires 1,169,170 matches, while only 446,255 are compatible.
Successful poses remain close to the raw alignment: translation length below
0.04 mm. SHA-256 checks confirm all source/target position, normal and topology
buffers remain unchanged. See [numeric evidence](evidence/fine-alignment-ply-overlap.json).
These full-source numerical checks used unique PLY vertices; rendered mesh
storage may contain repeated triangle vertices and weights those repeats.

`tests/fine-registration-ply.test.ts` reproduces the 85% refusal and 15% accuracy
checks when `SCANFORGE_ALIGNMENT_EXAMPLES` names the owner scan folder. The
ordinary suite covers sparse triangle interiors, thin-wall normal rejection,
zero compatible matches, full-source RMS, selection, memory admission and
cancellation. GUI/MCP browser verification compares geometry, refusal without a
revision/history change, Undo/Redo, slider controls, matching diagnostics and
target-versus-plateau status. Its rendered scene is a synthetic thin-wall case;
the owner's processed 1,610,976-point screenshot scene was not reconstructed.
