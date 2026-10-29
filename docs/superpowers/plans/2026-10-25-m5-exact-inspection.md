# Exact CAD inspection for M5

Authority: M5 issue #5 requires analytic geometry, valid solid boundaries and exact exchange verification through GUI and MCP. Display tessellation and maker completion do not prove those properties.

Design: add read-only `cad_inspect` with entityId. The shared operation snapshots BREP, inspects it in a disposable CadClient worker, checks cancellation/revision before returning, and always disposes that worker. The live modeling client and its handles are never reset by diagnostic timeout or failure. The GUI properties panel invokes the same public application operation on demand. Report millimetre units, BRepCheck validity, topology counts, analytic area and solid volume; distinguish surfaces from solids. Bound BREP input and topology work. Never claim native QuickSurface equivalence from OpenCascade inspection.

Implementation plan:

- [ ] Add failing kernel/client/operation tests for exact box and face inspection, invalid BREP, unchanged scene/history, cancellation/revision fencing and worker cleanup.
- [ ] Add isolated BREP parser/inspection worker operation and typed CadClient method. Keep virtual-file and native-handle cleanup in finally.
- [ ] Add shared operation and catalog schema; expose results through a small GUI properties panel using the same API and normal job cancellation.
- [ ] Verify exact properties on analytic fixtures, real-region thickening and STEP/project round-trips through public MCP and GUI. Invalid topology must be reported without mutation.
- [ ] Update agent/architecture documentation, run affected verification and independent review, and retain immutable candidate evidence.

Native computer-use currently fails during kernel asset initialization (os error 3); no native window was opened. Native capture remains an independent gate once the runtime works.
