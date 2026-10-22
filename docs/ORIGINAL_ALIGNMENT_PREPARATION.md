# Original-file alignment preparation boundary

The opt-in `tests/original-global-preparation.test.ts` exercises the shared PLY reader, millimetre/origin placement and `executeGlobalAlignmentInputPreparation` on the three original acceptance scans. It does not run the registration controller or native reference application. File identities are checked before and after each read; command-local indexed topology is copied and prepared sequentially, while hashes of all five authored carriers per scan must remain unchanged.

| Input     | Source SHA-256                                                   | Vertices  | Triangles |
| --------- | ---------------------------------------------------------------- | --------- | --------- |
| ply-1.ply | e2fc6d49404977638222be9d31b63dedbc7c0a4adca4aba4af711168d5783c05 | 140,113   | 274,154   |
| ply-2.ply | 3acf90227bea8e98e97d0eddeb57324d6c29767d622c86d65337d927bca5e75f | 1,375,494 | 2,697,877 |
| ply-3.ply | bf738cb1da7aa2e2d26bc143c33e04313ad5096069d91cc22338cd0b01e9dcc2 | 1,865,848 | 3,691,133 |

Set `SCANFORGE_ORIGINAL_GLOBAL_PREPARATION=1` and `SCANFORGE_ALIGNMENT_EXAMPLES` to the original folder. Run this test alone with one Vitest worker and `--pool=threads`; use the coordinator-owned finite Windows Job with the owner-authorized 4 GiB aggregate cap. The test itself only checks free-memory admission and cooperative deadlines; it does not install an OS cap. The isolated runner retains its 5376/5120/4608 MiB launch guards and a 200-second total work/cleanup budget. The default suite skips the expensive opt-in case.

The 2026-10-22 run passed all three original inputs in one isolated test. All 15 authored carrier hashes were unchanged; prepared vertex and triangle hashes matched the imported topology, and normal arrays had the expected lengths, separate ownership and finite values. The Job-accounted peak committed memory was 743,792,640 bytes under its 4 GiB cap. All seven observed processes exited, final Job accounting was zero, retained handles closed and cleanup had no errors. Source/tool/test identities and per-input command-normal hashes are retained in the candidate evidence report.

Two earlier attempts stopped before the test because the private runner had omitted normal Windows/Vite helper executables from its identity allowlist. Their owned Jobs reached zero active processes and all observed children exited; they are retained as failed harness attempts, not successful validation. The final runner pins the exact Node, esbuild and Windows helper executables, plus the Vite module that invokes its literal drive-detection command. No unknown executable is admitted and no existing resource guard is lowered.

This verifies bounded input reads, data ownership and the real-file preparation handoff only. Finite normals do not prove their numerical correctness. Sequential preparation is not a three-scan browser memory benchmark, worker-transfer verification, successful registration, final-transform comparison or native equivalence. Those remain separate M3 gates.
