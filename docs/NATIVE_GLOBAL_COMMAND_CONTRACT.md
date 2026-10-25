# Native global alignment command contract

The retained command handler at `0x14080bd60` (command `33762`) enumerates scene
objects, queries mesh-wrapper interface `0x14115ca98`, and tests its visibility
virtual at `+0x230`. It proceeds with at least two eligible visible wrappers.
Admission is independent of the current selected-object count. Each admitted
wrapper receives a temporary group adapter before the solver runs.

[The evidence record](evidence/native-global-command-contract.json) pins the
loaded-image hash, the two retained REA decompilation hashes and Evidence IDs,
dialog bytes, and the existing native runtime fixtures. The decompilation text
was checked against the retained REA normalized pseudocode. This capture reads
existing artifacts; it does not execute the native application.

## Command parameters differ from constructor defaults

| Parameter                    | Command handler                                                 | Solver constructor                        |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Parallel and evaluator flags | Both enabled                                                    | Both enabled                              |
| Budget                       | 1000                                                            | 1000                                      |
| Spacing                      | 12                                                              | 12                                        |
| Local tolerance              | Float32 `0x3a83126f` (approximately 0.001)                      | Float32 `0x3d4ccccd` (approximately 0.05) |
| Search radius                | Absolute unit-converted Float32 dialog entry, widened to double | 5                                         |
| Raw target index stride      | 1                                                               | 6                                         |
| Source mask                  | Constructor value retained: 0                                   | 0                                         |
| Coverage tolerance           | Constructor value retained                                      | Float32 `0x3d4ccccd`                      |

The dialog says **Search tolerance**, is titled **Global Fine Align**, and
formats the entry with `%.3f`. Address `0x1415d87dc` contains Float32 `0.5` in
the retained loaded image. That is an observed persisted setting, not proof
of the factory default. A public adapter must deliberately supply the command
parameters rather than silently inherit private evaluator or constructor
defaults. The existing canonical controller fixture uses radius 5; it does
not establish the dialog's factory default or verify a run at radius 0.5.

The source-mask row in the original evidence record was misidentified. The
`+0x80` field holds the target stride; the actual source mask is `+0xa8`,
initialized to zero and copied to preparation field `+0x60`. The command copies
settings only into `+0x68..+0x87`. A later passive native GUI run observed zero
at `+0xa8` and null mesh-interface results for all three temporary groups.
See [the corrected source preparation evidence](GLOBAL_ALIGNMENT_SOURCE_FLAGS.md).
The retained original evidence record remains historical, not the current mask
contract.

## Non-convergence and publication

The handler calls `0x140af89d0` without assigning or testing its return, then
records elapsed time and releases its temporary adapters. No convergence gate
appears at that call site. Independently, the existing complete canonical
three-scan fixture records 19 passes, three non-converged final states and six
transform commands delivered to recording adapters.

Those commands establish dispatch despite non-convergence. They do not prove
the original geometry setters' output, installed UI behavior, or successful
alignment. Public diagnostics must preserve this distinction. Preview/Apply is
the owner-approved, implemented application workflow; it is not an extracted
native interaction. Its verified scope is recorded in
[the public workflow checkpoint](evidence/global-alignment-public-workflow.json).

## Point-cloud admission boundary

The retained original `cVectorPointCloudObject` query fixture returns null for
the command-required mesh-wrapper interface in all six combinations of payload
presence and virtual-base displacement (`0`, `16`, `-16`). This establishes
exclusion of that tested wrapper from this handler's collection. The actual
ASC importer class has not been established; the result must not be widened
into a claim about every native point-cloud import path.

## Remaining integration checks

The [seeded three-scan numerical controller comparison](NATIVE_SEEDED_GLOBAL_ALIGNMENT.md)
matches the retained native and private browser executions. Shared GUI/MCP
preview, cached Apply, cancellation, stale-input checks and a single history
transaction are implemented. A separate two-scan synthetic browser replay
verified Preview/Cancel, mismatched-job cancellation, cached Apply, one history
step and exact undo/redo. A subsequent immutable-source replay of the full
retained three-scan public controller matched all native diagnostic bits and
all six native final indexed position/normal fields, plus their expanded
geometry/scanner-normal carriers. See the
[full public comparison](evidence/global-alignment-full-native-public.json).
That replay preserves the distinction between scanner normals and derived
viewport shading; it establishes neither full-size GUI behavior nor successful
alignment from the supplied coarse poses.

Retained routine `0x14088aeb0` establishes hidden-face admission to vertex bit
`8`: vertices start with `(old & ~2) | 8`, visible incident faces clear bit `8`,
and selected visible faces set bit `2`. Vertex bit `1` is preserved. Preparation
task `0x140aeb010` clears flags and calls the boundary-marker virtual only when
its source returns a mesh interface. The observed temporary groups return null,
so that path is skipped. The earlier inference from ordinary owner geometry
to actual group-command dispatch was incorrect. Passive owner adjacency
readiness does not prove that the group command calls the owner's marker.

These findings do not establish partially hidden mesh behavior across evaluator
construction and edit invalidation. The public adapter continues to reject
partially hidden meshes; that GUI/MCP capability boundary is unchanged.

## Application coverage default

The shared private outer controller now defaults coverage tolerance to Float32
`0.05`, matching the native constructor's field at `+0x88`. It previously used
`0.001`, which is the command's separate local-fit tolerance. The complete
canonical three-scan replays supplied coverage explicitly and therefore did not
test that default.

The outer-controller regression replays all 17 captured native cases both with
the recorded explicit tolerance and with the option omitted. Before correction,
16 default-path cases failed against their native coverage and subsequent call
records. Explicit caller values retain their existing behavior. This internal
fix changed neither public GUI/MCP schemas nor command availability at that
checkpoint. The subsequent seeded numerical comparison is recorded in the
linked verification report; the later public workflow has the separate scope
described above.

The correction passed an isolated TypeScript/Vite build with zero warnings or
errors, 73 focused tests (3 skipped), and the full suite of 46,461 passing tests
(54 skipped; zero failures). The full suite completed in 219.46 seconds.
Scoped Prettier and diff checks passed. These checks verify the default-path
regression against retained native fixtures; they do not prove full three-scan
public GUI/MCP workflow equivalence. The subsequent seeded three-scan numerical
comparison has its own evidence and remaining boundaries in the linked report.

The original evidence-only capture changed no application source, command
availability, GUI behavior or MCP schema. Its validation consists of streamed image hashing,
decompilation equality, exact dialog-byte checks, six query-case assertions,
fixture readback and scoped formatting. Build and application tests were not
applicable to that original evidence-only capture. The later controller fix
requires separate build and test validation.
