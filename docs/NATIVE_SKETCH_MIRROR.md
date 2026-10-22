# Sketch mirror evidence and implementation scope

The retained reference manual, SHA-256
`acaeb787431300f8fbeaf0f12845d35008f0732b6d938e011c9798db014a6018`,
printed pages 82–83, describes selecting sketch primitives and a straight
construction reference line, then creating their reflected copies. It explicitly
describes copies without new symmetry relations. This is documented workflow
evidence, not a live numerical controller capture.

`mirrorSketch` reflects analytic line endpoints and arc endpoints/centres in
sketch-local UV. The same copied point is reused by selected curves that shared
that source point. Copies use new IDs, including when a selected endpoint lies
on the axis. A circle represented by two semicircles is copied by selecting both
arcs; reflection reverses each arc's direction. Originals, existing constraints,
construction flags, sketch placement and scan references are preserved.

The GUI and MCP `sketch_mirror` share this helper through one guarded operation
and the existing sketch-history adapter. No automatic symmetry relation or
constraint solver mutation is added. The API returns source-to-copy maps and
created IDs; the copied graph remains inspectable through `sketch_get`.

Collection limits, a 2000000-unit work allowance, ±1e9 mm coordinate bounds,
1e-10 mm minimum axis length, new-ID generation and explicit axis/curve selectors
are implementation choices. Native numerical thresholds, selection ambiguity,
coincident-copy handling, ID order and original-window pixel parity have not
been measured. Manual workflow evidence and mathematical regression checks do
not establish full native equivalence.

Mirror does not weld coincident endpoints. An open half-profile can therefore
look closed while extrusion rejects its disconnected point-ID graph. Coincident
constraints alone do not join topology. Existing GUI segment endpoint selectors
can relink lines; `sketch_set` can relink general line/arc graphs. Automatic
profile joining and GUI arc-endpoint relinking remain separate workflow gaps.

Validation passed: 36 mirror tests, 92 focused sketch tests, the complete suite
(47656 passed, 64 skipped), production build and native CAD smoke checks.
The public browser integration compared actual GUI and MCP graphs on offset
OXY, OYZ and OXZ planes, including literal coordinates, arc direction, original
constraints, retry receipts, stale revisions, atomic failures, scoped history
and one-step undo/redo. The browser run used a 4 GiB Windows Job and peaked at
623394816 bytes; all 17 owned processes exited and its three ports closed.

No page exceptions occurred. Headless GPU readback warnings occurred during the
workflow; two bridge console errors occurred during teardown. A pre-existing
service-worker CacheStorage initialization error also appeared in browser stderr;
offline caching is not validated by this workflow. The source tree tested also
included five pre-existing viewport-revision changes outside this mirror commit.
See [structured browser evidence](evidence/sketch-mirror-gui-mcp.json).
The broader reconstruction and alignment gates remain open.
