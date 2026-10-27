# M5 exact sketch surface implementation

Follow the existing sketch-surface specification. Start after the compatible
blend implementation and review are coherent. Use one implementation worker at
a time; all test/build/browser/native execution requires a coordinated slot.

## Task 1: Native analytic planar face

Files: `public/cad-worker.js`, `src/cad/client.ts`, focused kernel helper/tests.

- [x] Prepare rectangle, two-arc circle and rotated-frame analytic face tests;
      observe missing-operation failure before implementing.
- [x] Extract the existing closed analytic profile wire/face builder from
      extrusion without changing extrusion behavior. New sketch surface transfers
      the validated face to ordinary registration; explicit ownership prevents
      temporary wrapper or face double deletion.
- [x] Verify exact areas/edge kinds, invalid profile/frame failures, cancellation
      cleanup and existing analytic extrusion regression tests.

## Task 2: Shared editable recipe and MCP

Files: recipe definitions/validation/evaluation in `src/parametric.ts`, both
catalog recipe schemas, agent guide, API tests.

- [x] Test the new `sketchSurface` recipe through ordinary CAD creation/rebuild,
      including an embedded sketch snapshot, constraints, scan references and frame.
- [x] Solve centrally and reject unconverged constraints; use the same existing
      single closed analytic profile contract as extrusion.
- [x] Verify unchanged authoring on success/failure, one model history step,
      retry/revision/lock/resource rules, rebuild, cancellation and late cleanup.

## Task 3: Application workflow and real scan acceptance

Files: `src/ui/App.tsx`, ribbon model/admission, dedicated sketch surface panel,
browser replay and evidence.

- [x] Observe missing GUI action, then enable From 2D sketch using the active
      editable sketch. Saved-sketch selection must work without object selection.
- [x] Use the shared CAD job with a cloned snapshot; own cancel/close/source
      change lifecycle and retain reachable cancellation while busy.
- [x] Compare GUI/MCP geometry, frame, analytic area, history, errors, source
      preservation, deterministic rebuild and exact project/STEP persistence.
- [x] Run the real scan section-reference → authored closed editable profile →
      exact surface → thickened valid solid → STEP chain and retain receipts.
- [ ] Independent full-change review, required checks and exact-head hosted CI.
      Native comparison and M4 acceptance remain separate milestone gates.
