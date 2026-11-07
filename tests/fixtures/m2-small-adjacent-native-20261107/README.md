# Small adjacent native component control

`source.stl` contains original `scan-1.stl` facets 263015 and 263016 in that order; its SHA-256 is `29f3e48716eb2d27f0e14ef49cf9a58a3d3d9819003bbb13439f06cdc36e5530`. They share an exact edge. QuickSurface Pro 8.0.123 imported the file in millimetres, reported four points and two triangles, and its Edit Scan dialog reported one individual mesh and one hole. The imported object was left hidden in the unsaved native scene. No native output export or algorithm trace was captured.

The shared ScanForge inventory at 0.001 mm reports two one-triangle components; at 0.000001 mm it reports one two-triangle component. This is an input-specific observed divergence, not proof of a general native weld threshold. The expected-failure regression records the gap until the native rule is established and implemented.

REA's PE resource inspection identified the executable as SHA-256 `0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`. That inspection identifies the binary; it does not recover the component-grouping algorithm.

An REA Ghidra 12.1.4 search of this exact executable's defined string inventory found no `Individual meshes`, `Create new object`, or `small meshes` strings, and a procedure-name search found no component or cluster procedure names. The installation's separate `language.txt` contains those UI labels. These negative searches cover provider-defined strings and procedure names only; they do not establish that the algorithm is absent. REA's attached runtime module inventory showed an MFC-based process without Qt Core or Widgets modules. The analysis session and instrumentation were detached after inspection. A native component handler and its algorithm remain unidentified.
