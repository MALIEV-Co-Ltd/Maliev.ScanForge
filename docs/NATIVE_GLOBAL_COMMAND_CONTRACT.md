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
| Source mask                  | 1                                                               | 6                                         |
| Coverage tolerance           | Constructor value retained                                      | Float32 `0x3d4ccccd`                      |

The dialog says **Search tolerance**, is titled **Global Fine Align**, and
formats the entry with `%.3f`. Address `0x1415d87dc` contains Float32 `0.5` in
the retained loaded image. That is an observed persisted setting, not proof
of the factory default. A public adapter must deliberately supply the command
parameters rather than silently inherit private evaluator or constructor
defaults. The existing canonical controller fixture uses radius 5; it does
not establish the dialog's factory default or verify a run at radius 0.5.

## Non-convergence and publication

The handler calls `0x140af89d0` without assigning or testing its return, then
records elapsed time and releases its temporary adapters. No convergence gate
appears at that call site. Independently, the existing complete canonical
three-scan fixture records 19 passes, three non-converged final states and six
transform commands delivered to recording adapters.

Those commands establish dispatch despite non-convergence. They do not prove
the original geometry setters' output, installed UI behavior, or successful
alignment. Public diagnostics must preserve this distinction. Preview/Apply
remains a proposed application workflow, not an extracted native interaction.

## Point-cloud admission boundary

The retained original `cVectorPointCloudObject` query fixture returns null for
the command-required mesh-wrapper interface in all six combinations of payload
presence and virtual-base displacement (`0`, `16`, `-16`). This establishes
exclusion of that tested wrapper from this handler's collection. The actual
ASC importer class has not been established; the result must not be widened
into a claim about every native point-cloud import path.

## Remaining integration checks

The seeded full native three-scan comparison remains outstanding. The mapping
from hidden triangles to native vertex flags also requires verification before
the public adapter can reproduce hidden-region admission. Shared GUI/MCP
preview, Apply, cancellation, stale-input checks and a single history transaction
remain to be implemented and verified for this controller. Existing coarse
alignment commands do not establish those behaviors for Global Fine Align.

This evidence-only slice changes no application source, command availability,
GUI behavior or MCP schema. Validation consists of streamed image hashing,
decompilation equality, exact dialog-byte checks, six query-case assertions,
fixture readback and scoped formatting. Build and application tests are not
applicable because no executable input or application source changes.
