# Poisson reconstruction and native acceptance implementation plan

> Execution continues under the owner's instruction to complete the previously listed open work. Preserve unrelated working changes; do not commit.

**Goal:** Add actual general 3D screened Poisson reconstruction with shared GUI/MCP behavior, and finish reproducible real-scan quality and native convergence comparisons.

**Architecture:** Compile pinned independent MIT/BSD PoissonRecon to bounded WebAssembly. A disposable processing worker prepares oriented normals, reconstructs, optionally trims by density, validates output, and returns a distinct mesh. The existing revisioned `mesh_process` executor owns publication, history, cancellation, retry protection and source preservation.

**Stack:** Existing TypeScript/React/Vite worker transport and tests; upstream PoissonRecon 18.76; portable Emscripten. No CloudCompare GPL implementation is copied or linked.

## Scope and acceptance

- Public operation `pointCloudPoisson` processes a whole visible raw cloud and creates a mesh. Existing projected meshing remains available.
- Explicit normals mode: provided oriented normals, PCA with graph-consistent outward orientation, or PCA with graph-consistent scanner-viewpoint orientation. Preserve positions, normals, placement and source history.
- Bound inputs at 500,000 points, depth 6–10 (default 8), WebAssembly heap at 1 GiB, and output geometry before expansion. Defaults: point weight 2, samples per node 1.5, scale fixed at 1.1, density threshold 0 (no trimming).
- Missing/invalid normals, degenerate input, invalid parameters, allocation failure, output limits, cancellation, revision/lock changes and failed trimming must fail without publication.
- GUI and public MCP expose the same meaningful controls and diagnostics; source geometry cannot be supplied through operation parameters.
- Validate known sphere geometry and at least one complete owner scan, including all-source point-to-surface errors, topology, orientation and trimmed open-surface limitations. A sampled patch cannot close the full-scan gate.
- Native convergence acceptance uses known transforms and independent full-point metrics. Owner scans have no physical truth; distinguish empirical stability and native agreement from physical accuracy.

## Tasks

1. **WASM engine:** `src/poisson-reconstruction.ts`, native adapter/build recipe, pinned source and license receipts. Demonstrate real reconstruction before application integration; test limits and invalid geometry.
2. **Normals preparation:** `src/point-cloud-normals.ts`, bounded kNN/PCA and graph-consistent orientation. Tests cover sphere/concavity, viewpoint plane, invalid supplied normals, determinism and unchanged input.
3. **Shared application operation:** `src/point-cloud-poisson.ts`, `processing-client.ts`, `processing-worker.ts`, `automation/operations.ts`, `catalog.json`. Add failing contract/publication tests first; bind workspace normals internally, publish exactly one new mesh, preserve revision/retry/cancel/lock semantics.
4. **GUI:** Reuse the cloud editing panel and application job command. Add the same depth, normals, viewpoint, density and advanced fitting options. Verify actual browser controls, source/history, cancellation and exact GUI/MCP geometry.
5. **Acceptance evidence:** Retain native and ScanForge input/output identities, settings and independent full-scan metrics under `docs/evidence/cloudcompare-20261029/`. Diagnose substantive failures instead of weakening thresholds or substituting sampled checks.
6. **Documentation and verification:** Update agent guide, architecture, third-party notices and evidence index. Run relevant tests, type checking and production build, and report every remaining unproven claim explicitly.

## Review focus

The reconstructed mesh must use current world coordinates once; never apply the cloud pose twice. Validate normals before allocating the WASM heap. Worker cancellation must actually terminate computation and allow a clean successor. Density trimming may open boundaries and disconnect components; report these rather than declaring all output watertight. Normal orientation assumptions and physical scanner uncertainty must remain visible to both GUI users and agents.
