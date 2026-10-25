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

### Integration follow-up

Local commit `3fa039e` integrates that main into the M5 branch. The only merge
conflict was an additive documentation section; both sets of content were kept.
M1's shared hidden-selection admission is retained; the browser test now expects
hidden facet 0 to be filtered from explicitly requested selections.

Actual browser project reopen then found a release-relevant codec failure:
shared BREP text bytes reached TextDecoder, which browsers reject. The codec now
copies only shared text bytes for decoding. Numeric shared buffer reuse and
aliasing remain intact. A browser-contract regression failed before the fix;
33 project/transport/surface tests passed afterward. The actual browser exact
CAD reopen passed after the fix. Independent review found no actionable defect.

Integrated development-source replay:
`.resources/surface-fit/25e27b87-6bf9-4004-8370-468b272ec431/ledger.json`.
Both GUI and public MCP thickened the real scan region by -0.1 mm and produced
identical complete geometry digests. The original full scan digest was unchanged.
Browser errors/warnings were empty and both owned browser/MCP processes exited.
This remains a local real region, not whole-part reconstruction or native
application parity. Final frozen-source build/suite and exchange/solid-validity
acceptance remain separate gates.

The final integrated build passed all 12 bounded typecheck batches and Vite,
with 272 offline assets and identity `scanforge-0cfe7f2dc3750e24`.
Its production preview on port 5195 passed the same real-region replay:
[built application receipt](evidence/m5-20261025/built-real-region.json).
[Build](evidence/m5-20261025/integrated-build.log),
[CAD smoke](evidence/m5-20261025/integrated-cad.log),
[formatting](evidence/m5-20261025/integrated-format.log),
[BREP failure](evidence/m5-20261025/brep-browser-failure.log),
[red regression](evidence/m5-20261025/brep-shared-red.log) and
[green regressions](evidence/m5-20261025/brep-shared-green.log) are retained.
This production check is application/public-MCP evidence; it does not run the
native reference application or certify exact solid validity.

Candidate `be256edce438e3767fd609147d7d1a2dcd8ad506` passed the final
[integrated full suite](evidence/m5-20261025/integrated-unit.log): 48,968 passed,
64 skipped, 668 passed files and 18 skipped files, in 274.81 seconds. The skipped
entries are not substitutes for any required M5 acceptance replay. This candidate
includes main `7e42e81`, the shared freeform fix and the BREP decoder fix. It has
not been pushed, merged to main or used to close M5.

Next verification gap: thickening currently checks the maker's completion and
non-null result, but `register` does not expose exact validity, solid/shell counts
or exact mass properties. Matching display digests alone does not certify a
valid solid boundary. Add shared exact inspection needed by GUI/MCP acceptance,
then verify the real-region output and exchange with that stronger evidence.

### Exact inspection and real-region exchange

The shared `cad_inspect` operation and Properties inspection panel now expose
saved exact BREP validity, unique topology counts and analytic mass properties.
Inspection runs in a disposable kernel, so cancellation or timeout does not
reset the live model. Source limits, cancellation, stale revision rejection,
read-only history/revision behavior and native-handle/virtual-file cleanup are
covered. Box area/volume and topology, surface-only zero volume and reversed
signed solid volume passed actual OpenCascade tests. Static review found no
actionable defect.

Build `scanforge-b3dd01c1e92112e4` passed all 12 bounded typecheck batches.
The full suite passed **48,974 tests / 64 skipped**, across 669 passed and 18
skipped files, in 277.99 seconds. CAD smoke and repository formatting passed.
Retained [build](evidence/m5-20261025/inspection-build.log),
[unit](evidence/m5-20261025/inspection-unit.log),
[CAD](evidence/m5-20261025/inspection-cad.log) and
[format](evidence/m5-20261025/inspection-format.log) receipts identify this
inspection slice. Earlier suite counts above remain historical.

The [public-MCP/browser exchange receipt](evidence/m5-20261025/exact-inspection-exchange.json)
and [GUI inspection screenshot](evidence/m5-20261025/cad-inspection.png) verify:

- GUI and MCP exact inspection agree and leave revision/history unchanged.
- The real 200-facet region produces matching GUI/MCP fitted patches and
  thickening digests, including Undo/Redo. Kernel inspection reports valid BREP,
  one solid, one shell, six faces, twelve edges and eight vertices.
- Analytic area is 156773.02271710781 mm² and signed volume is
  7849.205500441478 mm³. STEP reopen retains those topology counts and properties
  within 1e-8 relative / 1e-6 absolute tolerance. Project reopen reproduces them
  exactly and retains the editable thickening recipe and original scan digest.
- The native-input STL is exported through shared selection copy, then reopened
  and refitted to prove identical controls. Source/region digests and derived
  STL/STEP file hashes are retained. Inputs and expected outputs are saved outside
  Git at `C:/repo/alignment-example-files/m5-native-validation-20261025-01a1737c-r1`.

An earlier expanded replay exceeded the fixture's five-second job observation
budget during project reopen. The failed receipt remains in `.resources/m5`.
The harness now polls within the existing 90-second kernel lease plus five
seconds for settlement; application/resource guards and the three-minute outer
browser lease are unchanged. The complete replay subsequently passed.

Native capture remains unrun: both computer-use runtimes fail initialization
with `failed to write kernel assets: The system cannot find the path specified.
(os error 3)`, including after reset. No native window was opened or operated.
The coordinator's M2/M4/M6 exclusive native input slots remain respected.
Exact OpenCascade inspection is not native QuickSurface workflow equivalence or
a global self-intersection certificate. General trimming/blends, complete
scan-to-sketch/whole-part operation-matrix acceptance and M4's dependency gate
remain open; M5 merge and closure are still pending.

M1 issue #1 is closed with reviewed evidence and merge #10. M4 issue #4 remains open as of this audit and must satisfy its dependency gate. The native QuickSurface window is shared with M2–M6 coordination; do not clear or operate it without an ownership handoff. M5 needs a dedicated native scan-fitting/surface/CAD/exchange validation window.

Remaining: complete the approved operation matrix and prepared fixes, real scan-to-sketch-to-surface-to-solid workflow, matching native settings/tolerances, solid validity/seams/normals, complete exact exchange round-trips, resource/recovery coverage, final review and exact-candidate CI. Merge and tracker closure follow verified acceptance; neither has been performed for M5.
