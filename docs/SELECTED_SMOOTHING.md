# Selected-area smoothing

## Actual CPU-thread verification

The selected-area pool is integrated into the processing worker. A real-thread
regression gate now executes the production child entry point and target kernel,
including structured cloning and transferred output buffers. Connected fixture
vertices cross the two worker partitions; isolated zero-area padding admits the
existing 300,000-selected-vertex threshold without changing fixture neighborhoods.
Both workers initialize connectivity once and are reused for iteration counts
2, 1, 3, 5 and 2. Every operation must finish on both threads, with exactly one
joined target phase per iteration; serial fallback cannot satisfy this gate.

All threaded outputs are byte-identical to the serial kernel. Two-iteration
outputs also match the retained native annular export within 0.000001 mm and the
disconnected-fan export exactly. The other iteration counts verify serial/thread
equivalence, not additional native exports. Input coordinates remain unchanged,
and the gate awaits both thread exits. This is correctness coverage of the
already integrated multicore path, not a new measured speedup or arbitrary-mesh
parity claim.

Selected-area Smooth now marks every vertex referenced by selected facets, including vertices shared with unselected facets and open boundary loops. Interior targets use the neighboring vertex mean. Concave boundary corners use the distance-weighted endpoint target with a half step; convex and straight boundary corners remain unchanged. Each iteration computes all targets from the old coordinates before publishing Float32 coordinates. The application edit command defaults to six iterations at strength 0.5, with the same parameters exposed through GUI and MCP. A native Smooth click applies two iterations; the application preset corresponds to three native clicks, rather than one. Explicit two-iteration requests retain the one-click comparison below.

Connectivity does not change. The successor retains indexed adjacency and refreshes geometric diagnostics without vertex welding. Cancellation preserves the input. The ordered neighborhood follows only the fan attached to the first incident facet, including native traversal limits. Disconnected fans sharing a vertex are not averaged together. Pairing at edges with more than two incident facets or inconsistent orientation remains unverified; these edges are treated as open in the port.

## Extraction and observed comparison

The recovered edit handler is `0x1405b6280`, reached by command `0x838d` and control 1052. Although it reads a stored algorithm setting with default 3, assembly resets that dispatch variable to zero before choosing a kernel. The actual path calls `0x140a83c00`, which computes per-vertex targets through `0x140a827b0` and publishes them synchronously. The unused setting-3 kernel was rejected after its output failed the numerical comparison.

The boundary investigation on 2026-10-27 corrected the endpoint distance used by
this shared target kernel. Native helper `0x14017b820` multiplies each Double
coordinate difference by its Float32 copy, sums Y then X then Z in Double, and
returns the Double square root. Rounding a Euclidean distance to Float32 changes
the weighted endpoint target. The new 32-point inner-rim control matches every
unprojected native Float32 coordinate after twenty passes exactly; the later
curve-projected head is checked separately. GUI, MCP and smoothing workers use
the same corrected helper. This stage result does not close whole-boundary
smoothing or M2; see `docs/evidence/native-boundary-smoothing-20261027.json`.

REA analysis Evidence IDs:

- Handler: `ev_6dfb699e85ab13cfa34c8a398c402a883165ff75e8dc4ea3b993ffeed0676f4d`.
- Dispatched kernel: `ev_a6a72db035d046d57989b5c87fa8002405e5093d95640695e376347329594faa`.
- Vertex target: `ev_e7cfd9e0e53a192cb8d95ed610e383f820967f655907f752fbd2897db4d4a268`.
- Ordered fan helper `0x1401df9c0`: `ev_ca44aae7f34ee1016b834a69b76b3a18dc830323d96b45e2756f9d02790878b6`, assembly `ev_267ca2fbef6dc8abb49cfc27e3a76d02fcb2ca3ef568fd8a1bcb448bbd0bf20d`.

The native run used the same 96-triangle noisy annular STL and the same 16-facet selection as the defeature comparison. One Smooth click retained 96 triangles and moved the 16 selected vertices, including the inner hole corners and vertices shared with unselected facets. Native export SHA-256: `864a7317c3427e697cf21448f170a8dc1e012127611ef4a3534d70a13403eb4a`.

`tests/scan-selected-smooth.test.ts` compares the application against that observed output, verifies consistent and injective native vertex correspondence, unchanged unmarked vertices, retained connectivity, two boundary loops and topology reuse. The coordinate tolerance is 0.000001 mm. Raw exports, canonical REA dossiers, tool ownership and runtime records remain outside the repository. This is fixture-specific numerical evidence; broader native parity remains to be verified.

A second native run selects all eight facets of two asymmetric closed tetrahedra sharing one vertex. One Smooth click moves that shared vertex to `(0.8888888955, 1.3333333731, 1.7777777910)`, confirming first-facet fan traversal. The application matches every exported Float32 coordinate exactly and reuses topology without welding or rebuilding. Input SHA-256: `a11aa5209e91deda3bdad0e80cdbd97925240c803a3e780c53ee5d7d13d808fd`; native output SHA-256: `de0f9698f637beaf001ff9f3b8d9f712352eb83f17e49c686649758bd034e73a`.

A fresh native three-click run on the eight-facet disconnected-fan control matches the application six-pass default at every ordered Float32 coordinate. `tests/fixtures/smooth-six-passes-observed.json` pins the observed output (native STL SHA-256 `90f746b5e68ce06dee90293ba29b0011b6bf19579699862a046a5ddaa6d8f357`); `scan-smoothing-defaults.test.ts` verifies this comparison. This is a selected-all fan fixture, not evidence for every nonmanifold edge or winding case.

## Current rendered GUI and public MCP replay, 2026-10-26

The shared browser driver `tests/defeature-curvature-browser.mjs` accepts
`SCANFORGE_EDIT_ACCEPTANCE=smooth`. This mode uses the retained eight-facet
three-click native control for the six-pass GUI/default MCP route, checking exact
coordinates, unchanged camera, cancellation rollback, undo/redo and binary
save/reopen. It additionally imports the original 96-facet annulus with its exact
16-facet selection for explicit two-pass public MCP, checks native coordinates
within 0.000001 mm and unchanged unmarked corners, and captures fitted rendering.
`SCANFORGE_QA_DIST` can pin the frozen production build and
`SCANFORGE_DEFEATURE_OUTPUT` keeps each browser receipt in a separate directory.
See [the current lifecycle evidence](evidence/m2-selected-smoothing-lifecycle-20261026.json).
This does not establish arbitrary native mesh, nonmanifold/winding or performance
parity. The default mode of this driver still validates Defeature.

## Stationary source-corner preservation

Welded adjacency guides smoothing, but stationary vertices keep their original
raw per-corner coordinates. Vertices that move publish one Float32 target to all
aliases, including corners on adjacent unselected facets. This applies to both
selected-area and boundary smoothing. Representatives and connectivity survive,
so compatible successor adjacency remains reusable. Warm/cold regressions and
binary-reopened production-scan diagnostics agree.

The browser's optional `SCANFORGE_DEFEATURE_CASE_DIR` can supply a digest-pinned
available-scan input/selection with `SCANFORGE_EDIT_ACCEPTANCE=smooth`. This route
checks exact preservation outside the selected-face bounds expanded by 0.001 mm, GUI/MCP
equality, cancellation/history/reopening, and topology consistency. It makes no
native-six-pass claim for that production scan. See
[the source-preservation evidence](evidence/m2-smoothing-source-preservation-20261026.json).
