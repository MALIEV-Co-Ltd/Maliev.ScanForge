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

At this validation checkpoint, the public Global Fine Align command remained gated. This private routing fix
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

## Current common target-preparation binding

The current installed-image derivative independently confirms the same common
per-source preparation at `0x140aec260` (856 analyzed bytes, through
`0x140aec5b7`). This is not a CAD-only branch. With controller byte `+0x0d`
enabled, a child exposing `PointEvaluator` through virtual `+0x298` routes its
property pointer minus eight into the descriptor's evaluator vector at `+0x80`.
The adjusted evaluator's readiness word at `+0x98` is polled atomically before
insertion. The external polling call receives `0x32`; this check does not bind
its runtime identity or establish readiness under every edit.

Other admitted raw children contribute vertices to the descriptor's tree at
`+0x78`, with leaf capacity 48. Vertex flag bit zero excludes a record; the raw
loop increments its vertex index by the controller's U32 field at `+0x80`.
That is a stride use of this field in this procedure. It does not prove that
other preparation/query uses of the same field are masks or strides. Existing
observer names must not be promoted to runtime semantics without checking those
read sites. The application raw-ID helper supports explicit strides, while the
current public fixed-one route uses stride one.

Fresh REA evidence
`ev_efe807ef04e6644b8b211aa68c85178941187af2d5427b358e1c9d8370d6aab9`
has untruncated value-flow output but partial call relationships: two incoming
and 23 outgoing call references lack full ownership/destination coverage.
The reported terminal call at `0x140aec588` has an unknown no-return basis.
An independent byte decoder checked 18 instruction anchors, the evaluator
property text and three changed-instruction rejection controls. It executed
no target code. See [the structured binding](evidence/global-fine-target-preparation-20261023.json).

The current shared GUI/MCP command is enabled for eligible raw scan meshes.
Exact CAD admission remains rejected. Evaluator presence alone does not identify
a CAD class or prove an exact-surface query contract, so this analysis does not
justify removing that gate. No application operation, schema or runtime behavior
changes in this evidence update.
