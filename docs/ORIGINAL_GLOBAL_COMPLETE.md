# Original-three alignment workflow validation

The original three PLY files completed GUI Global Fine Align Preview, shared MCP Apply, Undo and Redo. All four checkpoints hashed all 15 full-resolution numeric carriers (640,860,696 canonical bytes per checkpoint). Undo exactly restored baseline hashes; Redo exactly restored applied hashes. Triangle hashes remained unchanged. History traversed 3 → 4 → 3 → 4, with the Global Fine Align timeline step active after Redo.

The preview used current GUI defaults: millimetres, placeAtOrigin true, tolerance 0.5 and parallel processing. Apply returned the exact staged settings, diagnostics and controller transform receipt without another alignment worker or public job. One exact built viewport-picking worker performed post-commit indexing. The new existing MCP preview/state/Apply outputs expose copied row-major 3x4 poses and ordered application stages, with exact little-endian Float64 hex bits. GUI and agents continue using the same staged geometry operation.

Controller result: stable, **not converged**; 3 outer passes, recorded seed 88941. Search tolerance does not define convergence. The GUI exposed Apply anyway, and the test explicitly exercised that supported path. This workflow pass does not establish good registration quality or native numerical equivalence.

The 4 GiB aggregate Windows Job peaked at 3,053,297,664 bytes (2.84 GiB). All 17 observed processes exited, final Job active count was zero, all handles closed and cleanup had no errors. Instrumented workflow time was 186.609 seconds; this is not a production performance benchmark. Existing launch headroom, CPU/process guards and absolute cleanup leases remained in force.

Validation: 52 focused tests passed across five files; TypeScript and production build passed. All 1,832 compiler inputs matched before/after build. Build manifest: scanforge-e2f8a3ff493850de. No full-suite rerun for this receipt-only change. The combined candidate includes five preexisting alignment revision files/hunks excluded from the local change. Native GUI capture remains unavailable in the validation session; no native three-scan numerical comparison was performed.

The first full attempt reached Preview and Apply, then stopped because a test incorrectly rejected the expected viewport-picking worker. It is retained separately. The corrected harness allows only that exact pinned worker and rejects new solve workers, unknown workers or public jobs. The accepted run is 20261022T095008344192Z.

The coordinator retains the structured evidence, source/build receipts and original-file hash pins outside the repository.
