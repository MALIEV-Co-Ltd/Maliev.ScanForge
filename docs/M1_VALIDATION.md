# M1 scan import and selection acceptance

This candidate preserves the owner's complete pending tree on a separate branch.
M1 concerns scan import, source fidelity and point/mesh editing. Alignment quality,
scan reconstruction and the remaining domain milestones retain their own gates.
The source commit and measured results are recorded in the
[acceptance receipt](evidence/m1-acceptance-20261025.json) and its retained logs.

## Reproduce

Use Windows, Node 22, Python 3 and installed Chrome. Install locked dependencies
with `npm ci --ignore-scripts`. The original scanner files remain private and
outside Git. Set their directory explicitly; do not substitute sampled inputs.

```powershell
$env:SCANFORGE_ALIGNMENT_EXAMPLES = 'C:/repo/alignment-example-files'
npm run build
npm test
npm run test:cad
npm run format:check
npx --no-install vitest run --maxWorkers=1 tests/asc-owner-examples.test.ts tests/point-screen-owner-examples.test.ts tests/scan-native-stl-user-examples.test.ts tests/ply-binary-file.test.ts
npx --no-install esbuild tests/m1-import-core.ts --bundle --platform=node --format=esm --outfile=.resources/m1-import-core.mjs
python tests/m1-bounded.py .resources/m1-original-import/job.json node --max-old-space-size=2048 tests/m1-original-import-browser.mjs
python tests/m1-bounded.py .resources/m1-selection/job.json node tests/m1-selection-browser.mjs
```

Unset `SCANFORGE_M1_FILES` and `SCANFORGE_M1_SELECTION_FAST` for acceptance. They
are optional diagnostic filters, not complete verification. The retained source
helper is bundled into the ignored `.resources` directory before the original
import test. The bounded driver starts the child suspended in a 4 GiB Windows
Job, enforces a 15-minute lease and records aggregate peak memory, total owned
processes, exit status and zero remaining processes. Closing the Job releases
owned descendants on failure. Existing application admission guards remain active.
Each original uses a short-lived reference process, then streams upload chunks;
reference geometry is released before the browser imports its own geometry.
The earlier combined-reference run exceeded the same Job limit on PLY3 and is
retained as a failed harness run, not acceptance evidence.

The build typechecks every original source and test root. Fresh compiler processes
check the source plus batches of 64 tests with a 1536 MiB heap each, avoiding the
hosted runner single-process heap exhaustion without raising memory limits.
A deliberately invalid source assignment was rejected with TS2322 before the
guard was removed. The final bounded typecheck passed all 12 batches. Earlier 23-batch receipts
are retained as historical checks. This reduces redundant source checking while
preserving every source/test root and the unchanged hosted 15-minute job limit.

## Evidence boundaries

The receipt is the M1 feature inventory. Browser source/assets are unchanged from
`ade79d1` through final candidate `9958d8f`; rebuilding preserves the same 272-asset
identity, `scanforge-4fbb43e9361fae09`. The bridge correction rechecks actual
poll/session deadlines after an early timer wake and explicitly clears each
replaced timer. Deterministic regressions failed before their fixes; all 21 bridge
tests pass afterward. Previous failed hosted runs remain recorded and are not
counted as passing. The final compiler uses 12 bounded batches; earlier runs used 23. The complete-tree checkpoint is pinned on `codex/m1-verified-candidate`.
Final receipts are saved separately on `codex/m1-acceptance-evidence`; neither
branch has been merged into `main`. Exact source commits and check scopes are
retained separately.

| Capability                         | Application / MCP evidence                                                                                          | Native evidence boundary                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| STL / PLY / ASC source import      | All nine original files, complete buffers and source hashes                                                         | STL mapping and optimized-reader captures; independent PLY source read and ASC text tolerances |
| Point / mesh selection and editing | Shared operations, exact source slots, source normals, hidden/clip/occlusion, copy/cut/delete and selection history | No general native selection/processing equivalence claim                                       |
| Recovery and persistence           | Import cancellation/retry, malformed data, geometry Undo/Redo, project and backup recovery                          | Application integration evidence                                                               |
| Resource ownership                 | Finite aggregate Job receipts and worker cancellation/lifecycle tests                                               | Owned helper trees only; no user applications terminated                                       |

- All original STL/PLY/ASC files: complete input SHA-256; GUI/public-MCP imports;
  canonical complete buffer digests; import Undo/Redo; original-slot deletion with
  equal GUI/MCP output and complete source restoration. Large GUI imports and all
  MCP originals include in-flight cancellation followed by a successful retry.
- STL: all three indexed vertex/connectivity streams match the retained native
  topology fixtures for those exact file hashes. The native-compatible import
  rejects two collapsed facets in scan 2. STL facet-normal records are not PLY
  scanner-normal carriers; derived geometry normals are reported separately.
  The focused original-STL tests also compare the optimized-reader capture in
  `tests/fixtures/stl-owner-reader-native.json`. These are retained native runtime
  captures, not a new native execution during this acceptance run.
- PLY: an independent complete binary read verifies every XYZ/scanner-normal
  Float32 value and face index. Derived geometry normals are separate from those
  file-authored bytes.
- ASC: these particular originals use XYZ/scanner normals in columns 4–6.
  Both interfaces explicitly use the shared `xyz-normal` interpretation. Every
  parsed sample is checked against its corresponding original PLY within
  0.0006 mm coordinate and 0.0000006 normal-component text-rounding tolerances.
  The import parser's RGB mode and retained per-point RGBA are tested separately.
- Layered, analytic mesh/cloud fixtures: exact original source-slot equality for
  GUI/public-MCP rectangle, circle, filled/unfilled freehand and straight strokes;
  visible/through modes, GUI Alt/MCP subtraction, hidden/clipped regions,
  connected components, mesh wand threshold, boundaries, grow/shrink, selection
  Undo/Redo, selective reveal and copy/cut final object selection.
- Boundary highlighting is an edge overlay, not a triangle-mask replacement.
  GUI paths/counts are compared with the shared MCP inventory artifact. New
  selection clears stale boundary and wand previews through both interfaces.
- Rejected inputs, ownership/revision fences, request retries, worker cancellation,
  point/mesh counts, RGB/normal slot preservation, units and project recovery are
  covered by contract/behavior tests and browser replays. Full-suite opt-in skips
  are reported explicitly; they do not substitute for the original-file runs.

These checks establish the stated M1 source/selection behavior. They do not claim
native alignment convergence, general native processing equivalence, unlimited
file sizes, long-duration leak freedom, a release or a deployment.
