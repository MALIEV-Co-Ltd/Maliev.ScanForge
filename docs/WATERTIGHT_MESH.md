# Watertight meshes and native reference evidence

The reference application's shipped `QSHelp.pdf` documents **Reference Mesh > Edit > Fill holes > Fill multiple holes** for boundary repair, and **Reference Mesh > Re-polygonize** for creating a single mesh from aligned, overlapping scans (PDF pages 13 and 243). Its Search tolerance controls the reconstruction density. These are distinct workflows: repairing existing boundaries preserves more of the scan; reconstruction can close gaps by changing the surface.

## ScanForge workflow

- For boundary repair, open **Edit scan > Holes**, leave maximum diameter at **0** to include every closed boundary, and choose **Fill multiple holes**. Invalid boundaries may be skipped; open chains and nonmanifold defects need separate repair. This command already existed.
- For reconstruction, select a raw mesh and open **Scan Data > Re-polygonize**. Optionally check additional aligned mesh objects. Set Point resolution in millimetres and Apply. The selected mesh is replaced in one undoable history step; additional inputs are retained unchanged. Original scans should be aligned first.
- Successful reconstruction now includes a measured topology check: no boundary edges, nonmanifold edges/vertices, inconsistent winding, duplicate faces or degenerate triangles. Disconnected regions can remain separate closed components; the result reports their count. This is a topological closure check, not a self-intersection or manufacturing certificate.
- The existing independent voxel algorithm samples a shell about 0.75 times the resolution, fills enclosed cavities and extracts its surface. Small gaps/features can merge; open sheets become thick shells. It does not reproduce the native numerical kernel. Large holes are not guaranteed to preserve their intended interior surface.
- Limits are one billion grid points, 3 million aggregate input triangles, 16 million output triangles and at most 32 additional meshes. Sampling has a 500-million-candidate work budget and exterior flooding has a bounded frontier. Increase point resolution when the grid limit is exceeded. Cancellation, validation errors and verification failures leave the workspace unchanged.

MCP uses the same binding, worker and verification:

```json
{
  "entityId": "scan-a",
  "targetIds": ["scan-b"],
  "operation": {
    "kind": "scanTools",
    "operation": { "kind": "repolygonize", "resolution": 0.5 }
  }
}
```

Use normal `expectedRevision` and unique `requestId`, then poll `job_get`. Omit `targetIds` for one source. References must be distinct raw mesh workspace IDs, excluding the source; CAD requires an explicit mesh copy. `createNew:true` is available to agents. Results include `topology` counts and `diagnostics.watertight`, `inputMeshes`, `resolution`, `weldTolerance`, and `selfIntersectionsChecked:false`.

## Native investigation, 2026-10-16

Installed reference executable, file version 8.0.123.0, SHA-256 `0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`. Directory naming alone does not establish a different binary version. REA 6.4.0 PE-resource Evidence `ev_023ef9c9c1c3f76257418c68a0f481b9a7c202c04c03f8a3571f304bcfbdc526` identifies this protected executable; no dialog resources are exposed in its on-disk tree.

Authenticated retained mapped image SHA-256 `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`, derived PE SHA-256 `f605d0e24564021d939ba8bfe458b91b498af420baed341f724ca3ed2be8a273`. Static resource parsing finds Fill multiple holes in dialog528 and command33760 string "Creates single mesh from multiple overlapping meshes / Re-polygonize". The MFC command map binds33760 to handler `0x14080b320` and enable handler `0x14080bc60`.

Fresh focused REA/Ghidra static Evidence:

- Handler: `ev_afd1d3b7b3bd0adf0fe0ae4d5931f1ae7bd8c3ddb8a14960eb41254177835b52`.
- Enablement: `ev_d6f8b7090fb8cd2317c956f2c4bb7c3cb5b151857fbc02341c6ca825c8191c08`.

Both enumerate document objects, query an interface and test virtual slot +0x230. Enablement requires at least one qualifying object. The handler gathers all qualifying objects, reads and normalizes a numeric dialog field, calls `FUN_140af4ee0` with the source list and output geometry, and creates a result object on success. A false-valued source setter plausibly hides inputs; virtual method names and qualifying predicate semantics are unresolved. Search-tolerance terminology comes from the manual, not recovered names. The reconstruction kernel itself was not decompiled and numerical parity was not established. No native target execution was performed this turn.

Local evidence is retained under `.resources/watertight-*`, including resource/command-map digests, handler decompilation, assembly, process ledgers and verified cleanup. The owned native session was closed and its Node/Java helpers exited.

## Initial validation (before fine-grid implementation)

- Production build: `npm run build` passed without compiler or bundler warnings/errors.
- Focused reconstruction, MCP operation, panel/reference and worker ownership checks: 351 tests passed in 26 files.
- `node tests/watertight-browser.mjs`: two open cube scans reconstructed to 1,764 faces, one component, zero boundary/nonmanifold/winding/duplicate/degenerate defects. GUI and MCP geometry matched exactly; additional scan geometry was unchanged; Undo/Redo passed. No page errors. All owned helpers exited and ports closed.
- Independent review verified shared binding, copied ownership and result parity; its aggregate-input admission finding was fixed before completion.
- Full suite: `npm test` passed 45,624 tests in 461 files; 49 tests in 15 files were skipped by existing suite conditions.
- User export `Z:/scanforge (2).stl`, SHA-256 `d25fb01797575f1824483752e7992f59512fbf58216cc987a6e4ed0aefb48f32`: 1,998,344 input faces reconstructed at **5 mm** resolution to 261,784 faces, one closed component, zero detected boundary/nonmanifold/winding/duplicate/degenerate defects. This coarse test establishes closure, not preservation of fine scan detail; the shell offset is approximately 3.75 mm. The source STL was only read.
- Prettier validation of all 18 staged files and `git diff --cached --check` passed. Native, browser and suite resource cleanup was verified.

## Earlier 1 mm implementation, 2026-10-16

The original implementation queried a BVH for every point in the entire bounding volume, stored per-point exterior queue entries and built a general adjacency graph for verification. These costs forced a one-million-point cap. The replacement preserves the same distance-shell definition and marching-tetrahedra extraction while rasterizing only expanded triangle boxes. Two bitsets store occupancy/exterior state; an x-span ring replaces the per-voxel flood queue; Float32 chunks replace boxed output coordinates. Typed numeric hash tables verify edge pairing, orientation, duplicates, connected vertex fans and face components without per-edge JavaScript objects. Float32 half-grid precision is checked before sampling. The existing source input limit remains three million faces; other tools retain their own limits for large outputs.

GUI and MCP retain the same resolution parameter, defaults, target binding, worker, history and cancellation behavior. No operation silently coarsens the requested resolution. New diagnostics are `gridPoints`, `distanceTests`, `samplingCandidates` and `verification:"typed-edge-pairing-and-vertex-fans"`. Resolution is sampling spacing, not a maximum-deviation guarantee. Features and gaps below approximately 1.5 times the spacing can still merge. The shell offset remains approximately 0.75 times the spacing; open scans become thick shells. Self-intersections are not certified.

The full exported `Z:/scanforge (2).stl` (same SHA-256 above) reconstructed at **1 mm**, using 98,584,992 grid points but only 4,377,064 triangle-distance tests. Output: **6,263,004 triangles, two closed components**, zero boundary edges, nonmanifold edges/vertices, winding conflicts, duplicate or degenerate faces. The finer reconstruction retains separated regions that coarse reconstruction may fuse. It does not promise one solid object.

A deterministic 4,096-point sample in each direction compared the result with the original scan using independent BVH nearest-surface queries:

| Sampled distance (mm)               | 5 mm reconstruction | 1 mm reconstruction |
| ----------------------------------- | ------------------: | ------------------: |
| Result to original, RMS             |              3.9826 |              0.7945 |
| Result to original, 95th percentile |              5.9417 |              1.1989 |
| Original to result, RMS             |              2.7152 |              0.5365 |
| Original to result, 95th percentile |              4.1607 |              0.8192 |

These samples demonstrate improved fidelity, not a global Hausdorff bound. Full reconstruction took about 12 seconds in the recorded local run; timing depends on the machine. Peak RSS for reconstruction plus both-direction BVH validation was about 1.34 GiB. The input coordinate buffer was hashed before and after and was unchanged; the STL was only read. Reports, output coordinates and helper cleanup evidence are retained under `.resources/fine-*`.

Regression coverage includes a mostly empty grid above the old cap, a retained 2 mm gap that coarse sampling merges, triangle-distance comparison against an independent implementation, span flooding versus dense flood filling, topology agreement with the independent mesh analyzer, and rejection of malformed surfaces. `SCANFORGE_FINE_RECONSTRUCTION=1 node tests/watertight-browser.mjs` exercises GUI/MCP parity above the old grid cap, unchanged reference geometry, undo/redo and helper cleanup.

Fine-grid validation completed: `npm run build` passed; 315 focused tests passed in 22 files; `npm test` passed 46,032 tests in 465 files, with 49 tests in 15 files skipped under existing suite conditions. Fine-grid browser validation passed above the old cap with bitwise GUI/MCP geometry equality, two reported closed components, unchanged references, undo/redo and no page errors. Independent review found no important correctness defects; it noted the bounded typed-table memory cost, which is included in the measured full-STL validation above. Formatting and staged whitespace checks passed. Owned validation helpers exited and browser ports closed.

## Requested 0.5 mm reconstruction, 2026-10-16

The full exported headlight scan now supports the existing **0.5 mm** default without silently coarsening it. Surface-local sampling and bitsets remain, while face-consistent cube contours replace redundant tetrahedral subdivisions. Shared faces make the same diagonal decision in both cells, including ambiguous corner configurations. Simple projected contour loops are triangulated; the remaining cases use an interior pole. Lookup-derived Float32 separation and cell-margin guards prevent different vertex identities from collapsing at large coordinate magnitudes.

Verification now pairs edges and checks orientation, duplicates, connected vertex fans and face components incrementally in extraction order. A vertex and its incident edges leave the frontier only after their last possible incident cell. Compact chunked disjoint sets retain connectivity. This removes whole-output edge hash tables and caps the active frontier at two million edges. The worker drops unused prior adjacency before reconstruction, keeping the canonical source intact for failures and cancellation. Exterior fill drains its connected padding before the remaining seeds, and uses word-level bitset filling.

Current bounds: one billion lattice points, three million aggregate input faces, sixteen million output faces, two million frontier edges and 500 million sampling candidates. Oversized work fails with source geometry unchanged. Follow-up tools keep their independent limits; agents can use the verified topology returned by the reconstruction job instead of rebuilding dense adjacency.

The unchanged export, SHA-256 `d25fb01797575f1824483752e7992f59512fbf58216cc987a6e4ed0aefb48f32`, reconstructed at **0.5 mm** using **765,604,350 grid points**, 13,023,800 triangle-distance tests and 30,241,123 sampling candidates. Result: **8,264,330 triangles, three closed components**, zero boundary edges, nonmanifold edges/vertices, winding conflicts, duplicates or degenerate triangles. Only 9,862 topology edges were active at peak. Separate components are retained and reported; no single-solid guarantee is made.

Deterministic samples of 4,096 indexed vertices in each direction used independent BVH nearest-surface queries:

| Sampled distance (mm)               | Earlier 1 mm tetrahedral result | New 0.5 mm contour result |
| ----------------------------------- | ------------------------------: | ------------------------: |
| Result to original, RMS             |                          0.7945 |                    0.3900 |
| Result to original, 95th percentile |                          1.1989 |                    0.5549 |
| Original to result, RMS             |                          0.5365 |                    0.3130 |
| Original to result, 95th percentile |                          0.8192 |                    0.4364 |

These are vertex-sample measurements, not an area-weighted or global maximum-deviation certificate. The shell still offsets the surface by approximately 0.375 mm; small features can merge. Self-intersections are not certified. The source coordinate buffer was hashed before and after and remained unchanged; the STL was only read. Core reconstruction took about 40-46 seconds in the recorded runs with roughly 0.8 GiB RSS; full two-way BVH validation peaked around 1.62 GiB. Hardware and concurrent workloads affect timing. Reports, output coordinates and verified process cleanup are retained under `.resources/half-*`.

Independent regressions verify all 256 cell patterns and every one of the 4,096 shared-face configurations in each axis against the general mesh analyzer. They also cover grid admission above the previous 128-million-point cap, Float32 precision rejection, canonical-source preservation after worker failure, and dropping unused adjacency. `SCANFORGE_HALF_RECONSTRUCTION=1 node tests/watertight-browser.mjs` exercises the same 0.5 mm workflow through GUI and MCP above the previous grid cap, including geometry equality, reference preservation, undo/redo and helper cleanup.

Half-millimetre validation completed: production build passed; 320 focused tests passed in 25 files; the full suite passed 46,432 tests in 470 files, with 52 tests in 15 files skipped under existing suite conditions. Browser validation at 0.5 mm used 149,721,291 grid points and confirmed bitwise GUI/MCP geometry equality, two closed components, unchanged references, undo/redo and no page errors. Independent review found no important defects. Staged formatting and whitespace checks passed. Full-STL, browser and suite helpers exited; browser ports closed.
