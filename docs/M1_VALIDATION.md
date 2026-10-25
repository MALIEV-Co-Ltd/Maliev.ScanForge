# M1 scan import and selection acceptance

This candidate preserves the owner's complete pending tree on a separate branch.
M1 concerns scan import, source fidelity and point/mesh editing. Alignment quality,
scan reconstruction and the remaining domain milestones retain their own gates.
The final source commit and measured results are recorded in the accompanying
`docs/evidence/m1-acceptance-20261025.json` receipt after validation completes.

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

## Evidence boundaries

- All original STL/PLY/ASC files: complete input SHA-256; GUI/public-MCP imports;
  canonical complete buffer digests; import Undo/Redo; original-slot deletion with
  equal GUI/MCP output and complete source restoration. Large GUI imports and all
  MCP originals include in-flight cancellation followed by a successful retry.
- STL: all three indexed vertex/connectivity streams match the retained native
  topology fixtures for those exact file hashes. The native-compatible import
  rejects two collapsed facets in scan 2. STL facet-normal records are not PLY
  scanner-normal carriers; derived geometry normals are reported separately.
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
