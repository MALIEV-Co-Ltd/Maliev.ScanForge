# Canonical three-scan native controller capture

## Inputs and scope

This is a new controlled native case using the complete retained canonical STL
coordinates, connectivity and original computed vertex normals for the three
owner scans. It does not replace or resolve the separate raw-PLY input-normal
gap. The native reader and original GUI were not executed by this harness.
Retained carriers were hash-checked; the original source files were not freshly
rehashed during this run.

| Scan |  Vertices | Triangles | Native evaluator query controls |
| ---- | --------: | --------: | ------------------------------: |
| 1    |   139,338 |   273,139 |                              33 |
| 2    | 1,299,033 | 2,547,403 |                              33 |
| 3    | 1,683,605 | 3,326,910 |                              33 |

All complete evaluator index, facet-normal and neighbor-mask hashes matched the
retained per-scan native controls. The full original adjacency, evaluator,
angular/spatial preparation, sampler, local refinement and outer controller ran
in one mapped original image. Targets used the evaluator-only route. The numeric
cell callbacks were original code; an adapter executed them serially and merged
their records in original cell order. The original OS scheduler and merge
procedure were not executed. Controlled iterator/container, allocator, metadata
and progress adapters supplied the surrounding host interfaces. This is not
native physical multicore proof.
Visibility was controlled as all-visible, clock inputs were fixed to `424242`,
and CAD target lists were empty. Geometry setter calls were recorded, not run.

Original image SHA-256:
`e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`.
Capture SHA-256:
`cb20e80665fc88db98a1b61b663a876b526d80ae1258a1d8acfa5f032dc7a2a3`.

## Lifetime correction and bounded execution

The harness initially reserved 65,536 nodes in every target pool. It now executes
the original 8,192-node block growth instead. That allowed all three complete
evaluators and their 99 query controls to finish under the same allocation cap.

A subsequent run reached the cap during final-source angular preparation. The
common angular grid was still retained after its last layout copy. The original
layout-copy body copies scalar layout fields rather than sharing its point lists.
The harness now retires this dead grid with the original pool destructor
`0x140aed390` immediately after the last copy. This released 102,212,520 tracked
bytes (97.5 MiB). Source and target geometry stayed resident. This is a harness
lifetime correction, not a measured reduction in application/browser heap usage.

The successful run retained the 4,096 MiB start guard, 1,024 MiB runtime guard and
1,536 MiB tracked allocation ceiling. Its finite process lease was extended from
110 to 240 seconds after the shorter lease expired during outer pass 3. Peak
tracked allocation was 1,509.43 MiB; final tracked allocation was 1,458.80 MiB.
These totals exclude Python objects, input carriers, the image mapping and other
host overhead; they are not total process RAM or browser heap measurements.

## Observed controller result

The sampler selected 1,333 / 1,267 / 1,235 points. The original outer controller
completed 19 passes in 87.22 seconds after scene preparation and recorded six
geometry application commands. It returned zero; all final convergence and
stability flags were false. This identity-start case therefore does not establish
successful registration within tolerance. The capture retains the exact pass
states and application matrices for comparison, including that outcome.

The process exited. Cleanup confirmed release of the image and both helper
executable mappings, and removal of the vectored exception handler. Earlier cap
and timeout runs were preserved separately and released their allocations by
process exit; they are not described as explicit mapping-cleanup successes.

## Application verification and remaining boundaries

An isolated same-input application scene replay passed against the new capture.
It compared complete common/source angular-cell membership hashes and normal
bits, selected point IDs, bounds, grid layout bits and flags, complete label
hashes, sample counts and consumed clock streams for all three scans.

The physical browser replay also passed 64 native correspondence comparisons,
two pose and two fallback comparisons, two actual query workers, and cleanup of
all 71 worker handles. Its synthetic registration retained zero plane gap after
five query batches. These are independent checks; the small browser cases do not
prove physical-worker registration of all three large owner scans.

Production memory admission, physical-worker execution with all three large
scans, actual geometry setters and GUI/MCP acceptance of this complete owner case
remain unverified. The production 512 MiB query-pool admission was not relaxed.
No public command was enabled by this capture.

The subsequent isolated controller-core replay matched all 19 native pass
snapshots, final matrix/error/coverage bits, convergence/stability flags and all
six application matrix commands exactly. It executed 439 correspondence queries
across 57 local refinements on the complete three retained meshes. The initial
diagnostic took 181.25 seconds after input loading, including 4.51 seconds of
scene preparation. This is a local diagnostic timing, not a browser performance
claim or a comparison with the original product's normal runtime.

The retained [controller fixture](../tests/fixtures/global-fine-canonical-controller-native.json)
and [replay regression](../tests/scan-native-global-canonical-controller.test.ts)
bind the controller case to the independently verified coordinate, normal,
connectivity and evaluator hashes. The always-enabled metadata test verifies
these links; the large replay requires the retained carriers:

```powershell
$env:SCANFORGE_NATIVE_CANONICAL_CONTROLLER = 'B:\codex\artifacts\native-scan-analysis\rea-inventory-fix'
npx vitest run tests/scan-native-global-canonical-controller.test.ts --maxWorkers=1
```

This replay intentionally invokes the application kernels directly. It neither
uses nor changes the production query-pool admission. It proves controller-core
numerical parity for this input/configuration, including the non-converged
outcome, and does not prove successful coarse alignment, large-owner physical
multicore execution, geometry setters, browser responsiveness, import coverage,
combination into one mesh or GUI/MCP acceptance/history/cancellation.

External evidence is retained under the task's `native-scan-analysis/rea-inventory-fix`
directory as `global-fine-canonical-mesh-controller-*`; isolated scene and browser
replay reports are in the `scanforge-target-order-20261016` validation snapshot.
The retained fixture is portable metadata and expected output; the large source
carriers remain external. No new GUI/MCP behavior or public API schema is
introduced by this evidence slice.

## Regression validation

The tracked replay ran again after the production build and passed together with
local and outer-controller regressions: 48 tests across three files. This second
complete replay performed the same 439 queries and 57 local refinements, matched
all expected states and commands, and took 185.01 seconds including 4.53 seconds
of scene preparation. No numerical correction was required.

Validation uses an isolated snapshot of the committed application plus this
owned slice, preserving unrelated working-tree changes. The production build
passed with fingerprint `scanforge-cd1e69942faa6828`. The full default suite does
not load the large carriers unless the explicit replay environment variable is
set; the input-provenance metadata regression always runs.

The default suite subsequently passed: 46,383 tests passed, 53 skipped, zero
failures across 481 test files (466 passed, 15 skipped), in 258.27 seconds with one
active worker. The large replay is one of the default skips and was explicitly
executed in the 48-test focused run above. Build, focused replay and full suite
ran sequentially; unrelated source changes were excluded from this snapshot.
