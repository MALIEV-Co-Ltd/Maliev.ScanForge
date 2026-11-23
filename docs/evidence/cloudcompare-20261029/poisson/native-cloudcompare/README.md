# Full owner-cloud native Poisson comparison

Native CloudCompare 2.13.2 reconstructed the complete 140,113-point oriented PLY 1 input through its actual Poisson GUI. The retained input SHA-256 is `98d483766c41107207e5d5d116bcde84005066e06ed7af83456cfc01c9df4656`; XYZ and NX/NY/NZ were mapped explicitly. GUI settings were depth 9, Neumann, samples/node 1.5, point weight 2, one thread, density enabled and linear fit unchecked. Screenshots/text trees retain those values. Console output reports 4.4 s,267,986 vertices and 535,815 triangles. The native project and raw binary PLY, including `scalar_Density`, are retained.

**Raw native output fails the unchanged quality gates.** It contains 16 degenerate triangles and 8 duplicate coordinates. Reverse-distance p 95/p 99 are 1.67005/6.40540 mm at vertices and 1.66018/6.35420 mm at face centroids. Complete self-intersection analysis reports 51 nonadjacent contacts/unclassified cases, with no proper crossings or positive-area coplanar overlaps. Raw geometry was preserved.

An explicitly scripted copy then used the same existing ScanForge `normalizePoissonMesh` and density threshold 7. This merged 8 identical Float32 vertices, removed 16 degenerate triangles and 43,887 low-density triangles, retaining 248,547 vertices and 491,912 triangles. This is **scripted postprocessing of native geometry**, not a claim about native GUI trimming.

Both native-postprocessed and ScanForge degree 2 outputs pass the same predeclared full-reference gates:

| Metric, source coordinate units treated as mm                                    | Native + identical cleanup/density 7 | ScanForge pinned WASM + cleanup/density 7 |
| -------------------------------------------------------------------------------- | -----------------------------------: | ----------------------------------------: |
| Source vertex→mesh p 95 / p 99                                                   |                   0.020928 /0.035959 |                        0.027850 /0.043905 |
| Mesh vertex→source p 95 /p 99                                                    |                   0.397824 /0.757163 |                        0.447277 /0.786901 |
| Mesh centroid→source p 95 /p 99                                                  |                   0.326275 /0.663323 |                        0.386168 /0.706154 |
| Vertices /triangles                                                              |                       248547 /491912 |                            249999 /495378 |
| Components /boundary edges                                                       |                              7 /5198 |                                   7 /4636 |
| Nonmanifold edges/vertices, inconsistent winding, duplicate/degenerate triangles |                                all 0 |                                     all 0 |
| Nonadjacent intersections, complete analysis                                     |                                    0 |                                         0 |

Native trimmed self-intersection verification completed 14,819,253 candidates within the unchanged 20-million work cap. Every original 140,113 source vertex, every output vertex and every output face centroid was checked against the complete 274,154-face original reference. These are finite sample sets, not a continuous Hausdorff or physical ground-truth certificate. Both accepted results are open meshes; boundaries/components are reported rather than hidden.

**Hidden algorithm settings differ.** Released CloudComparev 2.13.2 points to PoissonRecon submodule `d215dbaa8ba6139e7b48113365f25ada3663bb98`. Its retained wrapper defines FEM degree1 and uses it in Neumann execution; header default scale is1.1. These are [released-source corroboration](https://github.com/cloudcompare/PoissonRecon/blob/d215dbaa8ba6139e7b48113365f25ada3663bb98/Src_CC_wrap/PoissonReconLib.cpp#L37), an inference for the installed binary rather than binary-verified hidden parameters. Native GUI exposes no FEM degree setting. ScanForge deliberately retains its pinnedv18.76 degree2 engine. This comparison matches prepared input, visible settings, explicit cleanup/density policy and acceptance gates; it does not claim version, FEM degree, algorithm or bitwise equivalence. Small metric differences do not establish a general ranking.

Released source copies used only for corroboration are retained outside the
application repository; [their location/hash manifest](../../native-source-locations.json)
preserves exact identities alongside the pinned public source links.

See [provenance](provenance.json), [raw failed quality](raw-quality.json), [density 7 passing quality](density 7-quality.json), [postprocessing receipt](owner-ply 1-native-depth 9-density 7-normalized.ply.json), and the [ScanForge comparison](../ply-1-depth 9-density 7-native-normalized-quality.json). Native GUI screenshots/trees are retained alongside these files. Main viewport capture was white, so no visual surface appearance is certified; readable dialogs/console, actual saved geometry and independent analysis establish the recorded behavior. REA native Windows process capture was unavailable; CLI receipts are direct native execution evidence.

Reproduce the explicit native-output postprocessing and independent verifier from repository root:

```
node scripts/normalize-cloudcompare-poisson.mjs docs/evidence/cloudcompare-20261029/poisson/native-cloudcompare/owner-ply1-native-depth9.ply docs/evidence/cloudcompare-20261029/poisson/native-cloudcompare/owner-ply1-native-depth9-density7-normalized.ply 7 scalar_Density
node scripts/verify-poisson-quality.mjs --source C:/repo/alignment-example-files/ply-1.ply --mesh docs/evidence/cloudcompare-20261029/poisson/native-cloudcompare/owner-ply1-native-depth9-density7-normalized.ply --acceptance docs/evidence/cloudcompare-20261029/normals/ply-1-quality-acceptance.json --report docs/evidence/cloudcompare-20261029/poisson/native-cloudcompare/density7-quality.json
```

Raw native project export arguments and success are in `native-export-receipt.json` / `native-export.log`. No original owner file or QuickSurface scene was changed. Task-owned CloudCompare remains saved; native desktop input stopped for the parent's handoff. No application behavior changed in this evidence continuation; parent-owned shared GUI/MCP Poisson operation supplies application parity.
