# Full-size GUI and MCP scan import

MCP transfer artifacts now admit up to 512 MiB total logical bytes. The former
64 MiB allowance rejected the larger original ASC, STL and PLY acceptance files
before their shared importer could run. Upload chunks remain bounded to 1 MiB,
the handle count remains 64, and the inactivity lease remains 900 seconds.
Capabilities report these limits. Completed transfers can be deleted to release
capacity without deleting imported objects. Failed appends preserve retained
content; expired uploads require a new handle instead of reviving old Blobs.

GUI scan imports previously centered every scan independently, whereas MCP
preserved source coordinates. Both now preserve file coordinates by default,
retaining a multi-scan source frame. The GUI Scan import settings panel exposes
**Place each scan on origin**; MCP single/batch imports expose `placeAtOrigin`.
Agents read the same preference as `project_get.settings.importPlaceAtOrigin`
and write it through `settings_set.patch.importPlaceAtOrigin`. The GUI checkbox
uses that shared operation. Omitted import options capture the current preference
once; explicit booleans override it without changing the preference. Preference
writes advance the revision without changing existing geometry or model history.
Explicit true retains the earlier GUI behavior: center XY bounds and put the base
on Z=0 after unit conversion. It translates indexed companion vertices too, while
preserving normals and orientation. CAD and saved-project placement are unchanged.

Both entry points use `prepareImportedScan`, the same worker/parser and existing
revision/cancellation/publication/history boundaries. Transfer capacity is a
logical byte allowance, not a process RSS/heap guarantee; geometry admission and
worker resource limits still apply. Artifacts above 512 MiB remain unsupported
through the automation transfer store. This change does not claim unlimited
manual/MCP input-size equivalence or native registration/reconstruction parity.

## Validation

Fresh build `scanforge-6ffdf8ee1283fd2d` passed with 1,847 compiler inputs identical
before and after compilation. The full suite passed 47,579 tests with 61 existing
skips; 90 focused tests passed across nine files. Regressions cover aggregate
capacity, handle/chunk limits, rejected append preservation, expiry, capabilities,
placement defaults/overrides, readable and writable preferences, revision guards,
jobs and retry protection. Existing origin-worker tests cover translation
arithmetic and indexed-carrier consistency. Capacity boundary tests use logical
Blob sizes; the browser checks below transfer actual original file bytes.

Each full-size original was imported through the real GUI and through chunked MCP
artifacts in a separate disposable browser and a hard 4 GiB Windows Job:

| Original file | Actual bytes | Full geometry                                                | Peak Job memory |
| ------------- | -----------: | ------------------------------------------------------------ | --------------: |
| `asc-3.asc`   |  100,922,768 | 1,865,848 points with normals                                |    1,066.07 MiB |
| `scan-3.stl`  |  166,345,584 | 3,326,910 triangles; 1,683,605 indexed vertices              |    1,731.75 MiB |
| `ply-3.ply`   |   92,765,339 | 3,691,133 triangles; 1,865,848 indexed vertices with normals |    2,020.37 MiB |

Every uploaded artifact was read back completely and matched its original SHA-256.
Complete canonical geometry, normal and placement hashes matched between GUI and
MCP. GUI/public preference changes worked in both directions, advanced revisions
and preserved model history. Each import created one undo step; Undo/Redo retained
exact geometry, including after transfer-artifact deletion. All 19 owned processes
exited in each case, all listeners closed, and retained-handle Job cleanup checks
passed without errors.

STL indexed vertex and triangle hashes also matched both retained native reader
and topology fixtures for the exact original source file. This does not establish
current native GUI parity, ASC/PLY native normal equivalence, or native registration
and reconstruction quality.

The first STL diagnostic timed out with Chromium's DevTools pending-write queue
above 256 MiB, at a recorded Job peak of 2,215.84 MiB, below its 4 GiB allowance.
A controlled replay of the unchanged application disconnected DevTools during
bulk artifact transfer and then recovered the same browser process, target and
document before import. That replay passed. Final-build format checks use this
bounded diagnostic approach, preserve page-side error observation during the
explicit DevTools gap, and retain full byte and geometry checks. CDP target
lifetimes during that gap are not claimed; physical process cleanup is verified
separately by the retained Windows Job handles.

The same final build also completed the original-three full PLY workflow with
source coordinates preserved: GUI Global Fine Align preview, cached Apply,
complete input/aligned/Undo/Redo hashes, and GUI/MCP reconstruction at 0.5 mm.
All 6,663,164 input triangles were retained. Reconstruction results matched
exactly: 334,288 triangles, four closed components and zero boundary,
non-manifold, inconsistent, duplicate or degenerate topology defects. Geometric
self-intersections were not checked. Peak Job memory was 2,869.83 MiB under the
unchanged 4 GiB cap; all 17 owned processes exited and cleanup checks passed.
The five complete pre-alignment PLY3 buffer hashes also matched the independent
single-format GUI/MCP comparison.

This workflow result is not a registration-quality pass: the controller stopped
after two passes with all three scans stable but `converged:false`. Reported mean
distances were approximately 0.038907, 0.023589 and 0.038663 mm. Independent native
controller/GUI comparison and strict convergence remain unresolved.

## Original-three STL follow-up

The [full three-STL replay](ORIGINAL_STL_WORKFLOW.md) verifies all imported
vertex/index hashes against retained native topology fixtures, cached Apply,
GUI/MCP reconstruction and history under the unchanged 4 GiB cap. It does not
pass registration quality: all three local refinements fail without iterations
at 0.5 mm, all poses remain identity and the source geometry does not move.
The two-component reconstruction is not proof of one usable solid or native
reconstruction equivalence.
