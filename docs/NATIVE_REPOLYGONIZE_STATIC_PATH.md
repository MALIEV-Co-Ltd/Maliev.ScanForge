# Re-polygonize static path investigation

On 2026-10-24, focused static analysis identified a candidate Re-polygonize
command, reconstruction coordinator, spatial constructor, source encoder and
output extraction path in the historical analysis image. Six selected functions
decompiled successfully. An independent decoder checked 1,614 reported
instruction addresses against the digest-bound archived bytes.

The installed executable still matches the source executable recorded in that
capture. This connects the investigation to the shipped version; it does not
establish a fresh runtime observation, complete function boundaries or numerical
parity. No native application or helper was executed, instrumented or mapped for
execution. The exception directory was not captured, so function extents remain
inferred from code flow. Stack-probe handling also degrades some decompiled local
variable expressions; inspect the instruction evidence before deriving formulas.

## Findings and implementation implications

The candidate command reads and stores a Float32 point-resolution setting. The
coordinator loads that setting and passes it to a spatial reconstruction
constructor. Encoding and output extraction are separate stages. The constructor
initializes reciprocal spacing and half-spacing values. Those internal values
do not establish a final surface offset.

The source encoder conditionally marks triangle boundary vertices when
mesh-specific data is present. It obtains the source data iterator outside that
conditional branch. The [deeper field trace](NATIVE_REPOLYGONIZE_FIELD.md) found
that the subsequent encoder consumes triangle records with three vertex
pointers. The initial point-data lead therefore does not establish point-cloud
support; that native contract remains unverified.

The current ScanForge implementation uses a dense occupancy grid and a shell
radius of `0.75 * resolution`. The native path identified here does not yet
justify that radius, enclosed-void filling, disconnected-component handling or
the output interpolation. Preserve the existing measured candidate and both
components while investigating those differences. The native constructor's
half-spacing must not be substituted for the shell radius without tracing its
use in encoding and extraction.

## Validation and MCP coverage

Both owned static-analysis jobs completed under the unchanged aggregate 4 GiB
and 25% CPU limits. Their peaks were 836,812,800 and 844,906,496 bytes. Both roots
exited, both descendant jobs ended with zero active processes, owned handles
closed and cleanup errors were empty. The original image remained analysis data.

No application behavior or MCP contract changed. GUI and agent reconstruction
continue to use the shared `mesh_process` operation. Point-cloud reconstruction
remains unsupported. Any implementation derived from this investigation must
reach that shared operation, its schema and agent documentation, with GUI/MCP
comparison and full-input validation before completion.

The [follow-up investigation](NATIVE_REPOLYGONIZE_FIELD.md) identifies signed
corner distances, boundary-aware reduction and projected edge positions, with
all 256 oriented Marching Cubes cases checked. Grid rounding, distance
classification and degenerate cases still require investigation. This checkpoint
does not pass native numerical acceptance, self-intersection checks, point-cloud
acceptance, M3 or the broader reconstruction objective.

See [structured evidence](evidence/repolygon-static-path-20261024.json) and the
[measured combined-output candidate](ORIGINAL_STL_COMBINED_OUTPUT.md).
