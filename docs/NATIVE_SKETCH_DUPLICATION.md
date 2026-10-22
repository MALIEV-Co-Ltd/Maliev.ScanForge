# Sketch duplication: recovered behavior and remaining work

Duplication is not implemented in the application or MCP discovery. This evidence
defines work remaining under construction/sketch milestone M4; it does not close
that milestone or establish numerical equivalence.

## Artifact and controller binding

The installed reference executable is version 8.0.123.0, SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
Read-only runtime capture produced a private static-analysis image, SHA-256
`a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`.
That derived image is never executed or distributed with this repository.
Old captured external addresses do not bind calls in the current native window.

REA resource inspection (`ev_98a75917e41ca7becbcfc109647958e9285aa8960648d04b8a2744d91525ac33`)
identifies dialog 496, **Duplicate selected**, with 49 controls. Its 2300-byte
template has SHA-256
`971267d18bb39dbf31bf9cf6f690c9f5e40ca6a50a479c3f85416decef07bf20`.
The decoder consumed exactly the resource length. Constructor `0x14065ff70`
passes dialog ID `0x1f0` to its base and installs the dialog's virtual table;
factory registration names `cSubCopyCurvesDialog`. The message map connects
Accept to `0x140663cf0`, Cancel to `0x1406611b0`, and edits to the preview
generator `0x1406611d0`. Thus the recovered calculations are bound to this dialog,
rather than inferred from an unrelated CAD body-pattern command.

## Required modes

| Mode        | Observed controls and behavior                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear      | X Axis, Y Axis or picked Sketch line; instances, spacing and Flip. Instances include the original.                                                                                             |
| Grid        | Direction 2 adds its own axis/line, instances, spacing and Flip. The generator visits the rectangular instance product, excluding only the original at `(0,0)`.                                |
| Circular    | Explicit centre coordinates or a picked point, instances, Angle to fill, Flip and Retain original orientation.                                                                                 |
| Along curve | Pick a path, instances, spacing or Equal spacing, Flip and Retain original orientation. This mode is present in the shipped dialog but absent from the retained manual's duplication tutorial. |

The manual's printed pages 84–88 establish the first three workflows and that
copies can be edited independently. Resource controls and controller recovery
establish the additional along-curve branch. Neither source proves that every
option has been replayed successfully in the native UI.

## Recovered calculations

The generator clamps instance counts to at least two. Activation initializes
linear, secondary and circular counts to two, circular fill to 360 degrees and
centre coordinates to zero. Length defaults pass the numerical value 10 through
a unit conversion helper; that helper's complete unit contract remains open.

For finite nonnegative circular fill angles below 360 degrees, the angle step
uses `fill / (instances - 1)`. At 360 degrees or above, it uses
`fill / instances`. Exactly 360 therefore omits a duplicate at the original
location. The unchecked Flip state negates the step; Flip reverses its sign.
The 360 and degrees-to-radians constants and the branch/division instructions
were checked against the digest-verified image, rather than accepted solely from
decompiler variable types.

With retained orientation, circular copies use a translation calculated from
the selected group's stored anchor rotating around the requested centre. Without
it, source geometry rotates about that centre. Activation derives the anchor
from single-precision extrema of selected native point records, with special
handling for a curve category whose exact type mapping remains unresolved.
It is not established as the analytic bounding box of every supported curve.

Along-curve Equal spacing uses path length divided by `instances - 1`, except
when the native start/end points are less than 0.0001 units apart, where it uses
`instances`. Path evaluation accepts distances up to length plus
`1.1920928955078125e-7`; Flip reverses path traversal and tangent direction.
The retained-orientation branch preserves the initial path frame's rotation;
the other branch uses each evaluated path frame. Native curve evaluation and
distance-to-parameter behavior are still indirect-call boundaries.

Accept also remaps and copies selected relation records with numeric kinds
3, 4, 19 and 20 when both referenced source entities have corresponding copies.
Their semantic names are not yet mapped. Consequently, independent copies must
not be interpreted as proof that all internal constraints should be dropped.
The first insertion opens the native history change once; subsequent insertions
share it. Project persistence and exact history behavior still need live replay.

## Implementation and validation gate

Before adding duplication, resolve native curve categories, copied relation kinds,
unit conversion, picked-direction normalization, path evaluation and acceptance
history on equivalent fixtures. Then implement all supported modes through one
shared operation used by GUI and MCP, with an observable preview/accept/cancel
contract, instance maps, bounded work, revision/retry/cancellation checks and
atomic history. Discovery must not advertise duplication before it exists.

Static checks verified the image/template digests, all 49 dialog controls,
30 message-map entries and terminator, Accept/Cancel bindings, numerical constants
and circular divisor branch. No new application behavior, GUI/MCP end-to-end run,
native numerical replay or full test-suite run is claimed by this investigation.
The analysis provider was closed after evidence retention.

See the [structured controller facts](evidence/sketch-duplicate-controller.json)
for exact evidence identities and unresolved boundaries. Raw decompiler output
and the captured image remain private analysis material.
