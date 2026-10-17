# Complete seeded geometry-setter verification

The application now matches the original native mesh setters byte for byte on
the complete retained three-scan inputs and all six matrix applications from
the [seeded controller capture](NATIVE_SEEDED_GLOBAL_ALIGNMENT.md).
The [evidence record](evidence/native-seeded-global-setters.json) retains every
stage's position and normal hashes, matrices, source identities, resource
measurements and cleanup receipts.

## What was executed

The original mesh setter at `0x14088b070`, reached through vtable
`0x141248370 + 0x250`, dispatched its geometry operation through
`0x141155e60 + 0x38` to `0x1401de8d0`. The original vertex and face workers ran
using the system concurrency runtime with two observed native worker threads.
The probe supplied indexed record containers, an empty attachment tree,
notification observers and a cached status interface. It did not replace the
scheduler.

Each scan applied both captured controller matrices sequentially. Float32
storage was preserved between the two native calls. Nine retained position,
normal and triangle carriers were freshly hash-checked. These inputs contain
3,121,976 vertices and 6,147,452 triangles; this does not revalidate the original
STL import or rehash the original customer files.

| Scan  |  Vertices | Triangles | Compared indexed field bytes over both stages |
| ----- | --------: | --------: | --------------------------------------------: |
| 1     |   139,338 |   273,139 |                                     6,688,224 |
| 2     | 1,299,033 | 2,547,403 |                                    62,353,584 |
| 3     | 1,683,605 | 3,326,910 |                                    80,813,040 |
| Total | 3,121,976 | 6,147,452 |                                   149,854,848 |

## Independent application comparison

The independent verifier executed the current `transformDatumCoordinateStages`
kernel and `transformDatumScanStages` integration. Every indexed position and
vertex-normal byte matched after each native stage. Every final expanded render
position and normal matched its native indexed counterpart for all triangle
corners. The original coordinate and normal buffers remained unchanged, and the
triangle-index reference was preserved. This fixture contains no unused indexed
vertices; preservation of unused vertices is therefore not established here.

The verifier requires exact source IDs `[0, 1, 2]`, stage IDs `[1, 2]`, carrier
identities and output filenames. Its regression check accepts a valid receipt
and rejects five malformed variants, including duplicate scans, duplicate stages
and output files belonging to another scan. Verifier source hashes are retained
and checked again before writing a passing result.

These are shared application transform kernels used by GUI and MCP operations.
This evidence-only slice adds no public tool or schema and does not establish
that either public workflow is complete.

## Resources and execution status

The native probe's peak tracked raw storage was 692,157,184 bytes. The verifier's
observed ArrayBuffer peak was 741,491,440 bytes; its largest conservative staged
estimate was 1,034,529,032 bytes. The unchanged guards required 4 GiB host
headroom at admission, at least 1 GiB at runtime and a 1.5 GiB raw-storage cap.
The independent verifier used a 768 MiB JavaScript heap limit. These measurements
exclude unrelated applications, GPU memory and untracked allocator overhead.

The initial parent wrapper lost the redirected native child's exit code after
the child exited. This orchestration error is recorded rather than represented
as a successful process exit. All native output and cleanup receipts completed,
native stderr was empty, and the process was independently absent. The wrapper
was repaired to retain the process handle before waiting. The independent
verifier then ran separately, exited with code zero and was confirmed absent.
Native mappings, exception handlers, allocations and source file mappings were
released; no verifier carrier handles or workers remained.

Validation consists of the complete native capture, independent byte comparison,
receipt regression, syntax checks and evidence readback. An application build
and suite are not applicable to these documentation/evidence changes. The
pending public alignment implementation has its own build and test evidence.

## Remaining boundaries

Controlled face normals were initialized from each source triangle's first
vertex normal. Face-output parity is not claimed. This run does not exercise the
installed native UI, automatic command dispatch, original import, physical
browser workers, public preview/Apply/Cancel, undo/redo or timeline rendering.
It also does not turn the non-converged seeded controller result into a successful
alignment. Mixed STL/PLY/ASC workflows, combining/exporting scans and final
accuracy against the independent reference remain required.
