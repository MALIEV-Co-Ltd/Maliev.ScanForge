# Interactive alignment control extraction

The original Interactive command is resource `0x8338`, named **Move scan data**.
Its command handler is `0x140805c30`; availability is updated by `0x140805d30`.
It resolves the `MUM_ALIGN_MESH` mode and opens or reactivates its dialog. This
is distinct from the reference-based Align Mesh command at `0x81fe`.

REA recovered the dialog, mode and factory RTTI, message map, constructor,
initialization, data exchange, four manual step callbacks, view alignment,
accept/cancel, matrix application and mouse-move controller. The retained
[evidence](evidence/interactive-alignment-native-controls.json) includes 26
procedure records, their Evidence IDs and pseudocode hashes. The mapped source
image SHA-256 is
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
No activation or licensing behavior is implemented by this work.

## Controls and recovered defaults

The original `Align Interactive` dialog template is resource `0x14a`.

| Control                | Resource ID | Callback      |
| ---------------------- | ----------: | ------------- |
| As Current View        |        1133 | `0x140549cf0` |
| Positive rotation      |        1032 | `0x140549f00` |
| Negative rotation      |        1035 | `0x14054a030` |
| Positive translation   |        1033 | `0x14054a170` |
| Negative translation   |        1034 | `0x14054a430` |
| Show mirrored mesh     |        1039 | `0x14054a700` |
| Mirror plane selection |        1123 | `0x14054a750` |
| Drag strength slider   |        1124 | `0x14054aa20` |
| Accept                 |           1 | `0x140548a90` |
| Cancel                 |           2 | `0x140548d60` |

Constructor instructions initialize rotation and translation steps to Float32
one and the mirror toggle to zero. Initialization populates X/Y/Z rotation
axes, X/Y/Z translation directions and OXY/OYZ/OXZ mirror planes. It selects
Z rotation, X translation and OYZ mirroring, sets drag strength to 100, and sets
the slider range to 0-100. These defaults are static instruction observations;
the initialization callback has not been replayed as an installed GUI.

The original data-exchange callback ran with three different populated dialog
records. All 42 ordered dispatches agree with the retained field bindings, and
all dialog bytes remain unchanged under the controlled exchange recorders.
Rotation and translation occupy offsets `0xdc8` and `0xdcc`; both pass numeric
helper arguments 4 and 6. Those argument values do not establish parsing,
formatting or input-range semantics. The template also exposes an active-mesh
count, so the workflow must account for multiple selected targets.

## Executed step callbacks

All four complete original callbacks were executed with their original rotation
helpers and system UCRT sine/cosine imports. UI methods are controlled adapters.
The unit converter is a Float32 adapter with declared scales 1, 25.4 and 0.001;
this does not verify the original application unit-conversion service. The
geometry-application boundary records the generated matrix instead of changing
targets. The original step arithmetic is not replaced.

The capture contains 640 cases across signed inputs, zero, tiny angles around
the Z threshold, all three axes, two unsupported axis values and the three
translation unit adapters. Every callback emits exactly one apply request with
flag one and leaves its dialog record unchanged.

Rotation reads the Float32 step, takes its absolute value, applies button sign,
and converts degrees using double `0.017453292519943295`. X and Y always invoke
their helpers. Z leaves the matrix unchanged below absolute `1e-5` radians.
Translation applies sign to the absolute Float32 step, calls the unit adapter,
and widens its Float32 result before building the translation matrix. Unsupported
axis selections still submit identity matrices; public argument validation
should distinguish that internal control state from accepted user axis names.

The independent decoded test adapter matches 634 captured matrices byte for
byte. Six 45-degree cases differ by one ULP in double sine coefficients between
JavaScript and the retained UCRT outputs. Every coefficient in all 640 cases
matches after Float32 conversion. The regression preserves original double bytes
and checks both the one-ULP bound and exact Float32 bits. It does not replace
native expected values with JavaScript output. This bound is specific to these
cases and does not prove arbitrary-angle or repeated-transform behavior.

## Integration boundary

This checkpoint adds native evidence and regression tests, with no application
behavior or MCP schema changes. It does not enable the Interactive ribbon entry
or advertise a new agent operation. GUI/MCP session integration must retain the
native control behavior while separately validating:

- Manipulator picking, 15 handle modes, drag sensitivity and movement thresholds.
- Current-view transform construction and mirrored preview.
- Multi-target pose composition, mesh/cloud/CAD publication and target ownership.
- Preview updates, cancel restoration, accepted history and Undo/Redo.
- Same-input native geometry results, including repeated rotations.

The extracted mouse-move controller scales Float32 movement by drag strength
divided by 100 and checks transform determinant magnitude within 0.001 of one
before applying. These observations are not yet runtime verification of dragging.
The four step-button capture does not execute the complete geometry application
routine. It therefore cannot certify complete Interactive alignment parity.

For implementation, the extracted apply routine stores an accumulated double
pose in each mesh model during interaction; Accept later bakes that pose and
resets it. The application currently stores world-space mesh positions, so
rebuilding those buffers on every pointer event would introduce work absent
from that native path. A proposed integration is an immutable geometry buffer
with a temporary viewport matrix during the session, then one bounded CPU
publication at Accept. GUI and MCP must inspect and manipulate the same preview
pose, including cancellation and multi-target state. This is implementation
guidance from the static trace, not a completed or runtime-verified workflow.

## Validation

Build `scanforge-4fd227083888fd39` passed with no warnings or errors. The focused
contract file passed 642 tests. The complete suite with the supplied STL, PLY
and ASC examples enabled passed 28,899 tests across 367 files with no skips.
Scoped formatting, JSON identity/readback, whitespace and prohibited-name
checks passed. Native mappings and analysis helpers were released. This
evidence-only checkpoint changes no GUI behavior or MCP capability, so a new
GUI/MCP browser replay is not applicable. Port 5173 retains the current app.
