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
a helper that first calls a virtual floating-value helper, then formats its
result with precision settings
and parses the text back to double. Its complete unit and rounding contract
remains open; it must not be reduced to a hard-coded unit scale.

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
Their native command names are now mapped:

| Numeric kind | Native command     | Command ID | Dispatch branch |
| ------------ | ------------------ | ---------- | --------------- |
| 3            | Make Perpendicular | `0x829e`   | `0x14070bf72`   |
| 4            | Make Parallel      | `0x829d`   | `0x14070bd48`   |
| 19           | Make Colinear      | `0x84c3`   | `0x14070e8de`   |
| 20           | Make Equal         | `0x84c4`   | `0x14070eb02`   |

These are derived static bindings. Retained REA menu evidence binds the first
three labels to command IDs. The Make Equal tooltip belongs to the embedded
button at byte offset `0x8fa0`; callback `0x1405c85f0` accesses its window at
`0x8fe0` and sends `0x84c4`. Two selector/target dispatch tables connect those
commands to branches that store the corresponding relation kind before calling
the known insertion routine `0x140a401c0`. Independent copies therefore retain
selected internal perpendicular, parallel, collinear and equal relations; they
must not drop every relation.

Ghidra did not recover a function owner for this raw dispatch region. A separate
digest-bound decoder using Capstone 5.0.6 from the installed Ghidra distribution
checked the two table decodes and 25 critical instructions. This establishes the
command-to-record-kind mapping, not complete dispatcher analysis, executed paths,
solver equations or which quantity Make Equal constrains on every curve class.
Raw code stays in private evidence. The shared sketch model now represents a
collinear relation through GUI and MCP `sketch_set`; see
[the application contract](SKETCH_COLLINEAR.md). Its numerical solver formulation
has not been established as native-equivalent, and duplication remains open.

The first insertion opens the native history change once; subsequent insertions
share it. Project persistence and exact history behavior still need live replay.

## Direction and count handler follow-up

Both direction lists are ordered X Axis, Y Axis, Sketch line. The first two
choices replace the stored direction with `(1,0,0)` or `(0,1,0)` respectively.
Choosing Sketch line leaves that vector unchanged in the combobox handler; the
separate pick workflow must supply it. Enabling Direction 2 selects Y Axis and
resets its stored vector to `(0,1,0)`, even after a previous secondary direction.
Picked-line normalization and degenerate-input behavior are still unresolved.

The primary, secondary and circular instance edit handlers clamp values below
one to one. The linear/grid generator independently clamps both active counts
to at least two. A value of one is therefore not proven to mean an original-only
preview or acceptance. Preserve this distinction until native UI replay resolves
it; do not silently replace these two observed rules with one validation rule.

For linear/grid spacing, the native instructions load each full binary64 value
into XMM1, clamp it against zero, call the unit service at virtual slot `+0x20`,
and use the XMM0 result in the translation calculation. In particular, the
decompiler's `SUB84` expression does not establish truncation to 32 bits. The
converter implementation, unit settings and formatting round-trip remain open.
For finite spacing inputs, the pre-conversion operand is `max(spacing, 0)`;
this does not prove that the converter is linear, identity, or globally constant.

REA dossiers bind six handlers to the original message-map controls. A separate
Capstone check verifies 46 instruction anchors and rejects an intentionally
incorrect editor minimum. The secondary virtual-table thunk at `0x140664808`
adjusts the object pointer and enters the destructor, not a picked-line callback.
This excludes a false callback candidate without claiming the real picker has
been found. These are static observations, not executed native acceptance tests.
The provider was closed and its owned Java process exited after retention.

## Implementation and validation gate

Before adding duplication, resolve native curve categories, relation equations,
unit/precision conversion, picked-direction normalization, path evaluation and
acceptance history on equivalent fixtures. Then implement all supported modes through one
shared operation used by GUI and MCP, with an observable preview/accept/cancel
contract, instance maps, bounded work, revision/retry/cancellation checks and
atomic history. Discovery must not advertise duplication before it exists.

Static checks verified the image/template digests, all 49 dialog controls,
30 message-map entries and terminator, Accept/Cancel bindings, numerical constants
and circular divisor branch. The follow-up checks bind all four copied relation
names and recover the spacing-helper formatting boundary. No new application
behavior, GUI/MCP end-to-end run, native numerical replay or full test-suite run is claimed by this investigation.
The analysis provider was closed after evidence retention.

See the [structured controller facts](evidence/sketch-duplicate-controller.json)
for exact evidence identities and unresolved boundaries. Raw decompiler output
and the captured image remain private analysis material.
