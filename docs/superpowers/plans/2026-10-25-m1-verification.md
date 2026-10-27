# M1 verification plan

**Goal:** Verify and close GitHub issue #1 and milestone #2 without weakening their acceptance criteria.

**Scope:** Original STL/PLY/ASC import fidelity; mesh and point selection; GUI/public-MCP parity; cancellation, history, errors and resource cleanup. Alignment quality belongs to M3.

**Execution:** Inline verification using the existing application and public MCP bridge. Preserve unrelated working changes. Record build identity and source hashes; never attribute local results to pushed main.

- Compare all three original STL and PLY files against retained native topology/source data and the public geometry digest, through GUI and MCP imports; verify undo/redo and source hashes.
- Exercise visible/through, hidden/clipped, subtract, filled/unfilled freehand, line, rectangle, circle, wand, boundary and connected selection. Compare public MCP results and source IDs, selection history, editing and persistence.
- Repair concrete parity/correctness defects through shared operations; update catalog, adapter, contract tests and agent documentation together.
- Build the final candidate; pass focused tests, required full suite, CAD smoke and formatting; repeat affected browser acceptance and verify owned helper/listener cleanup.
- Retain evidence, reconcile every M1 acceptance item, update issue #1 and close it and milestone #2 only after all gates pass.

Execution results and final source identity are retained in [the M1 acceptance receipt](../../evidence/m1-acceptance-20261025.json). The live GitHub tracker records the final closure state.
