# Separate source records from raw global-alignment targets

Original preparation `0x140aec260` routes a child with an enabled, present
evaluator property into the evaluator vector instead of inserting that child's
raw vertices. The retained REA evidence is
`ev_7e484b0f8dcae63b2a5f7f99d982e26b6fb1c1c1d008115161ea70ac8d4c1e6c`.
The existing target-preparation fixture covers 48 original routing cases.
The source records still supply sampling coordinates, normals and labels.

Previously query geometry used its source records for the raw target index
unconditionally. Supplying a mesh evaluator did not distinguish evaluator-only
children from separate raw children. This allowed unwanted raw fallback and
built raw point indexes that native evaluator-only routing excludes.

The private geometry carrier now accepts immutable ordered `rawTargetIds`.
Undefined retains the original visible-raw-child loop, an empty array means no
raw targets, and a subset retains original source IDs through index lookup.
IDs must be increasing, in range and visible under raw flag bit zero. Other flag
bits do not exclude a record. Coordinates, normals, source sample IDs and labels
are unchanged. Geometry identity remains the cache key; editing routing requires
a new carrier, just as editing coordinates or sidecars does.

The shared registration driver defaults ordinary mesh entities with supplied
evaluators to an empty raw-target list. Explicit raw IDs preserve mixed-child
inputs. Point-cloud raw routing remains unchanged. The driver creates new
geometry descriptors without mutating authored inputs. Scene preparation still
sees every source record; query workers receive the raw ID sidecar, including
through shared prepared-target handoffs.

Pool admission includes the explicit ID payload and estimates raw index work
from the admitted raw record count. The 32-byte raw-record estimate,
384-byte mesh-face estimate and 512 MiB ceiling are unchanged. This avoids
budgeting a nonexistent full raw tree for evaluator-only children; it does not
prove a lower whole-process peak or admit the full owner mesh set.

## Validation boundary

Before implementation, 25 new regressions failed: source records remained in
raw target trees and the driver omitted evaluator-only routing. The final
focused run passed 394 tests. Composed native-boundary checks retain source
records while comparing evaluator-only output against recorded original mesh
correspondence bytes. Existing raw/mixed native query and target insertion cases
remain covered. Invalid IDs, original-ID mapping, shared worker transport,
source immutability, explicit mixed-child IDs and point-cloud defaults are
tested separately.

The browser replay passed 64 native case comparisons, two pose comparisons and
two one-worker fallback comparisons. It also ran the real scene preparation,
two-worker query pool, local/outer solver and staged mesh setters on two offset
mesh planes. Their final plane gap was zero after five query batches, authored
buffers were unchanged, and all 71 workers terminated. The synthetic registration
is an application integration check, not an original full-controller capture of
that scene. Native normal-group admission was preserved; the fixture contains
144 points per plane to exceed its 100-point requirement.

The public Global Fine Align command remains gated. This private routing fix
adds no GUI-only behavior or public MCP parameter. Complete original multi-scan
registration, import/controller publication and production memory admission
remain separate requirements.

The fixed validation snapshot used parent `f95ef09` plus this slice's source and
test files. Production build passed without warnings or errors
(`scanforge-2bd042f772140978`). The full suite passed 45563 tests with 49 optional
tests skipped and no failures. Formatting, whitespace, source/snapshot identity
and owned-file branding checks passed. Optional large-owner evaluator tests were
not repeated: their evaluator implementation is unchanged, and their prior
original captures remain recorded separately. This slice tests the changed raw
routing, worker protocol and registration boundaries directly.
