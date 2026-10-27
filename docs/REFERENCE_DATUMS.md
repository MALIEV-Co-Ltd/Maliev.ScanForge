# Numeric reference datums

The **Reference plane** and **Coordinate system** GUI commands use the same
`datum_construct` operation as MCP. They create named, source-detached datums in
world millimetres. They do not change the world origin.

Create a coordinate system with a current `expectedRevision` and a new
`requestId`:

```json
{
  "kind": "frame",
  "name": "Assembly coordinates",
  "origin": [10, 20, 30],
  "normal": [0, 0, 1],
  "xDirection": [0, 1, 0],
  "displaySize": 100
}
```

Use `kind: "plane"` for a numeric plane. `normal` defines Z; the optional
`xDirection` is projected perpendicular to Z and normalized to define X, and
Y is Z cross X. A zero or parallel direction fails. Omitting `xDirection` uses
the shared deterministic datum basis. Every vector input must be finite and
within ±1e9; `displaySize` must be positive and at most 2e9 mm. All generated
plane corners or positive coordinate-axis endpoints must also remain within
±1e9 mm. For a plane, display size is the square's side length. For a coordinate
system it is each positive axis's length from the origin.

The result contains `entityId`, rigid `frame`, `units: "mm"` and `displaySize`.
To edit, provide `entityId` with the full new placement and size. The entity must
be unlocked and of the same numeric datum kind. Editing preserves identity,
name and presentation and creates one history step. Rename separately through
`object_update`. A fitted or exact CAD plane cannot be rewritten as a numeric
plane by this operation. Finish any active reference-construction preview
before creating or editing a datum. Cancelling the GUI form creates no datum.

`project_get` and `object_get` expose a coordinate system's
`coordinateFrame: { version: 1, frame, displaySize }` and exact
`coordinateFrameEncoding`. A coordinate system has no triangle or point-cloud
geometry. Its three displayed axes belong to one semantic `referenceFrame`
entity, and its bounds include the origin and positive axis endpoints. Mesh
processing, scan selections and scan alignment targets reject this entity.
STL omits coordinate systems; STEP requires exact CAD geometry, which they do
not carry.

## Alignment references

Run `alignment_references` with the datum's `entityId`, then poll its `jobId`
through `job_get`. Coordinate systems return seven named records with
`source: "referenceConstruction"`:

| ID suffix after `<entityId>/frame/` | Label    | Kind      | Direction or plane normal |
| ----------------------------------- | -------- | --------- | ------------------------- |
| `origin`                            | Origin   | point     | —                         |
| `X`                                 | X axis   | direction | stored U                  |
| `Y`                                 | Y axis   | direction | stored V                  |
| `Z`                                 | Z axis   | direction | stored normal             |
| `XY`                                | XY plane | plane     | stored normal             |
| `YZ`                                | YZ plane | plane     | stored U                  |
| `XZ`                                | XZ plane | plane     | stored V                  |

Every record is anchored at the exact stored origin. Axis lengths affect only
display and bounds; they do not shift alignment anchors to display midpoints.
An optional `centerAt` projects a world point onto plane references and does
not affect origin or direction references. A numeric plane returns one record
`<entityId>/plane/XY`, labelled **Plane**, with its stored center and normal.
Discovery leaves its tangent unchanged. Locked and hidden datums remain
readable sources. `triangleIndex` is reserved for exact CAD face lookup.

Use a returned ID with the existing constraint contract:

```json
{
  "kind": "reference",
  "entityId": "frame-id",
  "referenceId": "frame-id/frame/XY",
  "axis": 2
}
```

Pass constraints to `alignment_preview` or `alignment_apply` with unlocked
moving scan/CAD target IDs, revision and retry fields. Each operation resolves
the current source again; stale revisions and missing IDs fail before commit.
The GUI's **Reference object** and **Feature / face** selectors use the same
discovery and constraint handlers. Rename and display-size edits retain the
reference IDs; pose edits change their resolved geometry.

## Sketch placement and persistence

`sketch_manage` with `action: "create"`, `planeSourceId` and optional
`framePlane: "XY" | "YZ" | "XZ"` creates an empty sketch on a coordinate
system. XY uses U/V/normal; YZ uses V/normal/U; XZ uses normal/U/V. The default
is XY. Ordinary planes accept XY only and preserve their saved tangent
orientation; legacy fitted planes without a saved frame use the fitted
center/normal basis. Optional `normalOffset` moves along the selected normal
in millimetres. This placement is copied: later source edits do not move the
sketch. GUI plane selection uses the same operation.

Project JSON version 3 and binary manifest version 5 preserve the accepted
frame as twelve little-endian Float64 values in `frameBits`, ordered origin,
U, V, normal. This retains signed zero and small translations. Existing JSON
and binary formats remain readable. Current entities and Undo/Redo history
share strict frame admission; extra sampled, fitted, parametric or CAD
metadata is rejected for coordinate systems.

This scope covers numeric detached datums and their existing alignment/sketch
consumers. Infinite line datums, relational coordinate-system construction,
and unrecovered native source-selection modes are not advertised. Native
acceptance and browser verification must be reported for their tested scope;
these contracts alone do not establish full M4 completion.
