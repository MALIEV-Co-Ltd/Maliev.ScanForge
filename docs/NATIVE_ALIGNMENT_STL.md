# Native alignment on owner STL scans

The three full-resolution STL sources in `alignment-example-files` now have
original source-preparation and two-lane refinement captures. Their source SHA-256
identities and mapped topology digests are retained in the fixtures; scan geometry
remains outside the repository.

`alignment-user-stl-source.json` records execution of original face preparation
`0x140b35d90`, vertex normals `0x140b375e0` and sampling `0x140a95520` on each
scan. The imported port must match normals and complete sampling flags byte for
byte, selected vertex IDs, level counts and node counts. Input topology matches
the complete optimized-reader captures documented in `NATIVE_STL_IMPORT.md`.

`alignment-user-stl-multicore-refinement.json` records scans 2 and 3 moving against
scan 1 as the fixed target. The original target builder, global adjacency rebuild,
objective, optimizer and matrix construction execute. The original Concrt
imports are rebound to the installed runtime and the objective uses two logical
lanes. Both refinements are accepted. Tests require exact parameters, initial
error, best objective value, matrix, acceptance and final lane flags.

The probe adapts mesh collection storage, allocation, CRT lifecycle, tracing and
stack probing. Native source sampling comes from the retained captures. It does
not execute the complete application constructor or capture the native GUI.
Consequently these results verify the recovered refinement stage on raw STL
coordinates, not every alignment mode, GUI import placement or origin/reference
alignment. Automatically centering imports changes the refinement input poses.

Run the owner-file tests with `SCANFORGE_ALIGNMENT_EXAMPLES` set to the scan
folder. Default CI skips these external, full-resolution cases. The serial
baseline remains in the tests to constrain acceleration; its scan-3 verification
takes minutes on this host and needs a bounded five-minute test timeout. This is
a performance limitation, not an interactive latency target.

The owned browser validation additionally invokes the shared MCP application
operation on these same imported meshes through the real processing worker. Two
physical alignment workers execute two logical lanes. Both cases exactly match
the native parameters, matrices, acceptance and objective values, preserve matching
render/indexed topology, leave the fixed scan unchanged and commit once. The
validation confirms that processing and alignment workers are released afterwards.

Observed operation durations are about 44 seconds for scan 2 and 119 seconds for
scan 3, excluding browser import. The serial scan-3 test took about 173 seconds
including its import. These are different execution contexts and are not a
controlled speedup benchmark. The remaining performance work includes target-query
acceleration and source-preparation costs. No GPU execution is claimed.
