# M5 acceptance ledger

Status: in progress. Issue [#5](https://github.com/MALIEV-Co-Ltd/Maliev.ScanForge/issues/5), milestone 6. This ledger is not a milestone closure receipt.

## Operation matrix

| Required area                                           | Application/shared MCP path                                                   | Evidence and remaining gate                                                                                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan fitting                                            | Fit Surface / `surface_fit`                                                   | Both projected-grid and approximate GUI/public-SDK equality passed on an authored planar region. A 200-facet region of original scan-1.stl also passed GUI/MCP equality and exact-face conversion. Full native fitting initialization/iteration is not established. |
| Patch/control edits                                     | SurfaceTools / `surface_set`, `surface_operation`                             | Shared mesh write, source association, derived-cache invalidation, one history entry, exact display equality and source immutability covered. Knot/crease/snapping/C0/C1 joins retain existing numerical suites; complete native workflow comparison remains open.  |
| Exact surface editing                                   | SurfaceTools / shared rebuild helper / `cad_rebuild`                          | GUI/public-MCP exact tessellation equality, BREP retention, STEP export and project reopen passed on an authored fitted patch. Real whole-part seams/normals/topology still need acceptance evidence.                                                               |
| Loft/sweep                                              | AdvancedCadTools / `cad_create` recipes                                       | Exact kernel smoke passes analytic volumes, straight/bent sweeps and invalid inputs. Real-input GUI/MCP/native operation-matrix replay remains open.                                                                                                                |
| Surface trimming/blends                                 | Existing joins and solid split/Boolean recipes                                | General surface trimming is not implemented according to CAPABILITIES.md. C0/C1 joins do not establish a general surface-blend implementation. Reconcile and complete the release requirement; do not mark it covered by solid-only tests.                          |
| Extrude/revolve, Boolean, fillet/chamfer, shell/thicken | GUI CAD tools / shared recipes / `cad_create`, `cad_rebuild`                  | Kernel smoke passes these operations and exchange. Complete real scan-to-sketch-to-solid workflow, explicit recovery, GUI/public-MCP/native parity and solid boundaries remain open.                                                                                |
| Persistence/exchange                                    | Shared project codec and kernel exchange / `project_import`, `project_export` | Exact surface recipe and BREP survive project save/reopen in browser; STEP export header verified. Kernel smoke covers STEP round-trips. Real scan-derived whole-solid STEP/BREP acceptance remains open.                                                           |
| Resources                                               | Existing admission guards, owned browser/MCP process leases                   | Successful browser replays verified browser/server exit and bridge closure; port 5173 preserved. Failed receipts retained. Full workflow peak and failure/timeout/cancellation gates remain open.                                                                   |

## Candidate history and validation

Initial isolated source base: `e367262fc46b2fee8588c7b3c84ccd41fa7424fa`.
Baseline build: `scanforge-137c079968291db3`; 49 focused tests passed.
Surface-edit candidate build: `scanforge-ce836e872afca62d`; 71 focused tests in eight files passed, including retained native arithmetic fixtures. CAD smoke passed. Changed-file formatting and `git diff --check` passed. Full formatting found two pre-existing files: `docs/FEATURE_EVIDENCE.md` and `docs/evidence/global-fine-wrapper-dispatch-20261023.json`.

First full-suite run encountered a newly added test during its intentional red phase: 47,695 passed, one failed, 64 skipped. It is excluded from passing acceptance. The subsequent frozen-source run passed 47,697 tests, with 64 skipped, across 588 passed and 18 skipped files (275.49 seconds). This predates integration of the newer remote main.

Browser ledgers (ignored raw artifacts):

- `.resources/surface-fit/73274cb7-7ae0-47fc-94e7-f90cb3b053e2/ledger.json`: projected fit, control edit, exact CAD edit, STEP export and project reopen.
- `.resources/surface-fit/8c81c42e-f216-424e-a515-4f6ea9bd594c/ledger.json`: same exact workflow with approximate fitting.
- `.resources/surface-fit/77555041-e3cb-4e67-85fa-17fdef8bcbc6/ledger.json`: additional original scan-1.stl region. File SHA-256 `6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9`, 13,657,034 bytes. 600 selected vertex samples, projected RMS 0.24469684494336 mm, maximum residual 0.8491197149648428 mm. These are measured residuals, not an accepted native tolerance or whole-part fit certificate.

Browser errors/warnings were empty on these passing runs. Raw failed locator/schema/admission receipts remain in `.resources/m5`; their retries do not erase them. Browser plugin was unavailable; the repository Playwright and official MCP SDK harness was used on separate loopback port 5195 with disposable profiles.

Independent static review found no actionable defects in the initial patch; subsequent test expansion and point-cloud-target guard require final review. No whole-milestone acceptance is inferred from that scoped review.

## Integration and closure gates

Remote `main` was refreshed and is `7e42e81da07d9677a24b8d17c07aecf3e94456ec` (M1 merged). Integrate it into this isolated branch and repeat source/build, application and public MCP checks before any final merge. Earlier evidence belongs to its earlier source only.

M1 issue #1 is closed with reviewed evidence and merge #10. M4 issue #4 remains open as of this audit and must satisfy its dependency gate. The native QuickSurface window is shared with M2–M6 coordination; do not clear or operate it without an ownership handoff. M5 needs a dedicated native scan-fitting/surface/CAD/exchange validation window.

Remaining: complete the approved operation matrix and prepared fixes, real scan-to-sketch-to-surface-to-solid workflow, matching native settings/tolerances, solid validity/seams/normals, complete exact exchange round-trips, resource/recovery coverage, final review and exact-candidate CI. Merge and tracker closure follow verified acceptance; neither has been performed for M5.
