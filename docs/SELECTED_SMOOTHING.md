# Selected-area smoothing

Selected-area Smooth now marks every vertex referenced by selected facets, including vertices shared with unselected facets and open boundary loops. Interior targets use the neighboring vertex mean. Concave boundary corners use the distance-weighted endpoint target with a half step; convex and straight boundary corners remain unchanged. Each iteration computes all targets from the old coordinates before publishing Float32 coordinates. The edit command applies two iterations immediately, without the earlier invented strength and iteration controls.

Connectivity does not change. The successor retains indexed adjacency and refreshes geometric diagnostics without vertex welding. Cancellation preserves the input. Ambiguous or inconsistently oriented junction vertices remain fixed in this port; their full native fan behavior has not yet been validated.

## Extraction and observed comparison

The recovered edit handler is `0x1405b6280`, reached by command `0x838d` and control 1052. Although it reads a stored algorithm setting with default 3, assembly resets that dispatch variable to zero before choosing a kernel. The actual path calls `0x140a83c00`, which computes per-vertex targets through `0x140a827b0` and publishes them synchronously. The unused setting-3 kernel was rejected after its output failed the numerical comparison.

REA analysis Evidence IDs:

- Handler: `ev_6dfb699e85ab13cfa34c8a398c402a883165ff75e8dc4ea3b993ffeed0676f4d`.
- Dispatched kernel: `ev_a6a72db035d046d57989b5c87fa8002405e5093d95640695e376347329594faa`.
- Vertex target: `ev_e7cfd9e0e53a192cb8d95ed610e383f820967f655907f752fbd2897db4d4a268`.

The native run used the same 96-triangle noisy annular STL and the same 16-facet selection as the defeature comparison. One Smooth click retained 96 triangles and moved the 16 selected vertices, including the inner hole corners and vertices shared with unselected facets. Native export SHA-256: `864a7317c3427e697cf21448f170a8dc1e012127611ef4a3534d70a13403eb4a`.

`tests/scan-selected-smooth.test.ts` compares the application against that observed output, verifies consistent and injective native vertex correspondence, unchanged unmarked vertices, retained connectivity, two boundary loops and topology reuse. The coordinate tolerance is 0.000001 mm. Raw exports, canonical REA dossiers, tool ownership and runtime records remain outside the repository. This is fixture-specific numerical evidence; broader native parity remains to be verified.
