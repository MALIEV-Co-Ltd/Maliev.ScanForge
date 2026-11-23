# Browser screened Poisson engine

ScanForge builds the actual MIT/BSD-noticed [upstream PoissonRecon](https://github.com/mkazhdan/PoissonRecon/tree/262b0f539d404057d1f36e1adc07fc9388678899), commit `262b0f539d404057d1f36e1adc07fc9388678899`, solver version 18.76. No CloudCompare source is linked or copied. This engine solves a general three-dimensional screened Poisson surface from oriented points. Application GUI/MCP integration belongs to the shared `pointCloudPoisson` operation; this document describes the independent engine and its evidence.

`src/poisson-reconstruction.ts` exports `reconstructPoisson`, synchronous `validatePoissonInput`, and resource constants. Admission happens before WASM loading. Positions and normals must contain matching finite XYZ triples, with nonzero normals and at least three points with nonzero spatial extent. Normals are normalized before solving. Consistent orientation remains a meaningful prerequisite; the engine cannot infer it from an arbitrary provided normal array.

Parameters are depth integer 6–10 (default 8), point weight 0–100 (2), samples per node 0.1–100 (1.5), and density threshold 0–32 (0). Internal settings are degree 2, Neumann boundary, scale 1.1, float32, one thread, confidence weighting disabled and manifold extraction enabled. Input is limited to 500,000 points. Native output limits are 2,000,000 vertices and 4,000,000 triangles. The WASM heap begins at 64 MiB and grows to at most 1 GiB, with an 8 MiB stack. JavaScript arrays, mesh expansion and the application scene consume additional memory outside that heap; this is not a total browser process-memory guarantee.

Native allocation/solver failures become deterministic errors with no partial returned mesh. The owning disposable processing worker must be terminated for cancellation; the synchronous native solve has no cooperative cancellation callback. Source positions/normals are never mutated by the engine. Application history and revisions are the shared operation's responsibility.

`src/poisson-mesh-cleanup.ts` independently exports `normalizePoissonMesh` with no runtime dependencies. It validates finite coordinates/density and bounded topology, welds exactly equal Float32 coordinate tuples (no tolerance), assigns the minimum density to a welded vertex, removes exact zero-area/repeated-index faces, removes duplicate unordered index faces, applies the explicit density threshold and compacts unused vertices. It reports merged vertices, removed degenerate faces, removed duplicate faces and density-trimmed faces separately. This normalization does not certify manifold vertex fans or repair self-intersections, holes, unsupported closure or normal orientation. A density threshold retains a triangle only when all three vertex densities pass; threshold zero disables density trimming. Density quantiles in engine diagnostics describe the original untrimmed solver output.

## Reproducible build and verification

The checked-in generated JS/WASM are used during ordinary builds; Emscripten is not needed to verify them:

```powershell
node scripts/verify-poisson.mjs
```

The verifier checks the pinned upstream/toolchain/configuration and SHA-256 of the generated JS, WASM, retained license notices, native adapter and build recipe against `public/poisson/provenance.json`. These are local artifact integrity checks, not a cryptographic publisher signature.

Install the official Emscripten SDK 6.0.13, Python and Git, then run:

```powershell
$env:SCANFORGE_EMSDK = 'C:\tools\emsdk-scanforge'
# Optional: a dedicated upstream checkout at the exact pinned commit.
$env:SCANFORGE_POISSON_SOURCE = 'C:\tools\PoissonRecon-scanforge'
node scripts/build-poisson.mjs
node scripts/verify-poisson.mjs
node scripts/poisson-wasm-smoke.mjs
```

Without `SCANFORGE_POISSON_SOURCE`, the recipe clones into `.resources/poisson-upstream` and checks out the pinned commit. Use a dedicated checkout: the recipe writes its two deterministic portability patches into it. It validates the commit and patch anchors, and takes the original files directly from that commit before patching. First, `NestedVector` default block logarithm is reduced from 20 to 15 so its depth-one capacity uses 30 bits instead of an invalid 40-bit wasm32 shift. Second, `ThreadPool::ParallelSections` explicitly honors `NONE` with serial calls; upstream otherwise attempts unavailable threads even with serial parallelization selected. Neither patch changes the reconstruction equations. Native compilation uses standard floating-point semantics and exceptions, without fast-math. Source license notices and root MIT license are retained in `public/poisson/LICENSE.txt`.

Full compiler arguments, toolchain paths and source pin are recorded in `docs/evidence/cloudcompare-20261029/poisson/build-provenance.json`; `compile.log` retains the latest compiler diagnostics. The first wasm32 compile refusal is retained separately as `compile-failure-wasm32-indexing.log`.

## Validation and remaining quality scope

Unit tests cover synchronous admission/defaults/resource rejection and exact normalization, including duplicate-coordinate collapse, conservative density and source preservation. The normalization tests were observed failing before implementation, then passing.

`node scripts/poisson-wasm-smoke.mjs` runs the compiled native engine in Node against the retained 1,200-point radius-10 mm sphere. The current output has 3,990 vertices, 7,976 triangles, vertex radial RMS 0.00518829 mm and maximum vertex radial error 0.01835254 mm, with a 64 MiB heap and no warnings. Timing is an individual local run, not a general performance promise.

`node tests/poisson-engine-browser.mjs` runs the exported TypeScript entry in an actual browser module worker on isolated Vite port 5192. Its receipt is `docs/evidence/cloudcompare-20261029/poisson/browser-engine-smoke.json`. This proves browser loading, real WASM execution and output normalization; GUI/MCP parity is validated by the application integration harness, separately.

The installed CloudCompare plugin generated 3,992 vertices and 7,980 faces for the same sphere; its separate native report is [CLOUDCOMPARE_POISSON.md](CLOUDCOMPARE_POISSON.md). Different counts and solver versions preclude a claim of exact native output equivalence. Real owner-scan evidence, bidirectional geometric error, density sweeps and topology classifications are recorded by the independent quality harness in the same evidence directory. The untrimmed depth-8 real scan has good source-to-mesh distance but unsupported closure gives poor reverse distance. The closed sphere does not establish full real-scan reconstruction quality.

## Bundled runtime notices

The loader resolves `../poisson/poisson.mjs` from the actual worker URL. Current
development `src/` and production `assets/` worker entries are one level below
the application root. This preserves nested deployment prefixes without changing
the existing IIFE worker output format. `tests/poisson-production-browser.mjs`
serves the actual compiled build under `/scanforge/`, runs the real processing
worker and checks both JS/WASM requests plus sphere geometry. It reproduced the
former `assets/poisson/` lookup failure before the correction; the red and green
receipts are retained. Re-run it if the worker output directory layout changes.

The generated minified JavaScript has no license header, so distribution uses the adjacent `public/poisson/LICENSE.txt` notice bundle. The build recipe now copies the pinned SDK's complete Emscripten dual MIT/NCSA notice, musl `COPYRIGHT`, and LLVM Apache-2.0-with-LLVM-exceptions license files for libc++, libc++abi, compiler-rt, llvm-libc and libunwind (the latter retained conservatively). It also retains the SDK musl source files' additional copyright/license comment blocks, including its permissively licensed math and qsort contributions, and Doug Lea's default allocator public-domain provenance declaration. Existing PoissonRecon MIT/BSD notices remain intact.

These texts come directly from the installed Emscripten 6.0.13 tree used by the compiler. The provenance records SHA-256 of its seven primary runtime notice files; the generated combined notice bundle and build recipe remain included in the ordinary five-file integrity check. `verify-poisson.mjs` additionally refuses a bundle missing the expected runtime sections, preventing a hash-only update from silently dropping them. This documents the dependency's selected runtime-notice route; it is not an unrestricted legal-compliance or complete toolchain supply-chain certification claim.
