# Persistent reference construction design

Status: approved by the repository owner on 2026-10-23 for implementation;
not yet an implemented or advertised capability.

A fresh-context builder check found nothing important left unanswered for
planning this architecture. The native evidence work listed below remains
required; that review is not user approval or feature validation.

## Intent and scope

Complete the reference-point and reference-line portion of M4 as real project
objects. Users and agents must be able to create, preview, edit, inspect, use,
save, reopen and undo these objects through the same application operations.
This design is part of the full reconstruction goal; it does not replace the
remaining alignment, scan, sketch, surfacing, freeform or analysis requirements.

The behavioral authority is [the reconstruction contract](../../NATIVE_REFERENCE_GEOMETRY.md)
and its digest-bound native evidence. Static findings, analytic tests, native
execution results and rendered GUI/MCP acceptance remain separate claims.

Required construction modes include typed/picked line endpoints, two-primitive
lines, average lines, typed/picked points, single-primitive midpoint/center,
two-primitive points and three-plane points. CAD vertex/curve/face inputs and
retained scan picks are part of the input-resolution work, not silently omitted
alternatives. A mode is not published until its whole lifecycle works.

## Approaches and proposed choice

1. **Semantic entities with retained construction definitions:** preserve precise
   geometry, sources, mode, picks and evaluation state. Extend the existing
   project, history, viewport and shared API boundaries. This is the proposed
   choice because the native records preserve both geometry and construction
   state, and later construction and alignment consume these objects.
2. **Mesh or point-cloud substitutes:** simpler initial rendering, but would
   require fake triangle/scan semantics, lose the definition and make downstream
   references ambiguous. Rejected because it contradicts the observed behavior.
3. **CAD-kernel-only objects:** might reuse some display/export code, but current
   parametric recipes require kernel outputs and do not represent the native
   point/line lifecycle or its numerical fallback state. Rejected as the primary
   representation; exact CAD inputs still use the existing kernel resolver.

The owner approved this architecture after reviewing the proposal. The earlier
combined normals/memory approval remains separate.

## Persistent model and identities

Add explicit `referencePoint` and `referenceLine` entity kinds. Their geometry
uses finite Float64 coordinates in millimeters. A point owns XYZ. A line owns
start, direction and length, preserving the native stored representation;
endpoint calculation uses the recovered arithmetic. Display buffers are derived
and may use Float32, but never replace these authoritative numbers.

The existing required `positions` field is an empty compatibility carrier for
these kinds. Every consumer must branch on semantic geometry before accessing
triangle/scan positions. This is not permission to teach individual operations
to interpret empty geometry as a valid mesh. Provide shared kind/eligibility,
bounds, geometry-copy and count helpers to make the distinction explicit.

Each reference retains a versioned discriminated construction definition:

- Mode and explicit numeric parameters, including endpoint settings. Preserve
  derived length separately from any independently editable length control;
  the latter requires native evidence before it is exposed.
- Source object IDs and exact subfeature identities where the mode uses them.
- Retained pick coordinates with their coordinate space and precision. Preserve
  the distinction between the common input set and ordered pick records.
- Evaluated geometry and outcome diagnostics; prior geometry is an evaluator
  input for branches that retain it.
- Stable source-order keys and resolved evaluation order, without native memory
  addresses, raw code or opaque executable payloads.

Public entity IDs remain unchanged. Existing projects accept arbitrary unique
strings, so construction must not introduce a UUID-only project restriction.
Use explicit persisted 16-byte ordering identities for entities participating
in native-style source sets. New identities are assigned once; legacy objects
receive keys in the same accepted history transaction as their first dependent
construction. Preview holds provisional keys and never mutates the project.
Reopen, undo/redo and repeated preview must reuse the recorded keys. Collision
and duplicate-key validation are mandatory.

For a legacy object with no saved key, derive its provisional key deterministically:
the first 16 bytes of SHA-256 over the ASCII domain
`ScanForge construction-order v1` followed by one zero byte and the exact entity
ID's UTF-16LE code units. Do not normalize the ID text. This reuses the existing
SHA-256 dependency and preserves arbitrary accepted string IDs, including their
code-unit distinctions. Check key uniqueness across the whole scene before
publishing; report a collision rather than changing the ordering silently.
Cancelling and beginning again therefore produces the same order even before a
key has been saved. This is an application migration rule, not an asserted native
GUID conversion. Test it across cancellation, undo, JSON/binary reopen and legacy
IDs. New objects may receive random raw keys at creation; keys are never mutable.

The raw-byte comparator is lexicographic over 16 unsigned bytes. Do not infer a
Windows GUID memory layout from UUID text. Existing UUIDs may only be converted
after the layout is established; otherwise generate and persist raw keys
directly. Order keys are identity data, not user-reorderable controls. Native
comparison fixtures provide explicit raw identities on both sides.

Deduplicate common source sets by object identity before sorting. Preserve
ordered pick records separately and consume them according to each native mode.
The point evaluator uses the first ordered input for its single-source mode,
the first two for its pair mode and exactly three for three-plane construction.
Exposing the resolved order in inspection makes order-sensitive results auditable.

Line pair and average evaluation instead consume retained record-vector order.
The pair uses its first two records; average iterates all its records. Do not
deduplicate these records just because their dependency identities collapse in
the common input set. Preserve repeated-record weighting and the 12-byte pick
suffix as described by the line-state evidence.

## Resolver, evaluator and evaluation outcomes

One pure evaluator receives the construction definition, resolved immutable
primitive inputs, prior geometry and evaluation state. Exact CAD resolution and
scene lookup happen outside it. Reuse `reference-geometry-numerics.ts` and the
existing native datum feature adapters where their contracts match.

Preserve instruction-level arithmetic order, native thresholds, strict versus
inclusive comparisons, normalization, source ordering and finite line extent.
Do not replace the recovered plane anchor or closest-line result with a more
conventional formula. Do not average direction vectors before the native
running-sign adjustment.

Return structured outcomes distinguishing:

- Geometry updated normally.
- Geometry updated through a native fallback, with the fallback identified.
- Origin written by the native invalid-input branch.
- Prior geometry retained, with the reason and native state transition retained.

The point implementation must distinguish a nearly parallel axis/plane pair
from a failed three-plane construction. The former skips both the coordinate
write and the completion-word store; the latter can write zero coordinates and
the ordinary completion word. Preserve this distinction internally rather than
turning both into an exception. The internal native flag word is not an API
setting; agents receive meaningful evaluation status and diagnostics.

API contract errors (malformed input, stale source, missing object, lock conflict,
unsupported requested mode, non-finite coordinates) remain structured failures.
They must not be confused with a valid request whose native geometric evaluator
chooses a fallback or retains prior geometry. Recovery of broken saved links and
native UI admission rules must be resolved before finalizing that boundary.

## Shared editor operations

Introduce one host-scoped reference-construction session family, following the
versioned interactive-editor pattern rather than duplicating logic in React.
Proposed discoverable commands are:

| Command                          | Responsibility                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference_construction_sources` | Paged eligible inputs and exact subfeatures for a specified object/mode, with stable identities, units and unsupported reasons.                 |
| `reference_construction_edit`    | Begin a new/edit session or change its mode, numeric inputs, sources, picks or endpoint/length controls; resolve and evaluate an owned preview. |
| `reference_construction_get`     | Return session/version, revision binding, definition, ordered inputs, evaluated semantic geometry, diagnostics, expiry and staleness.           |
| `reference_construction_apply`   | Validate and consume the exact cached preview, atomically publishing definition, geometry, identity migration and dependency changes.           |
| `preview_discard`                | Extend the existing command with an owner-scoped construction target; cancel/release only that session.                                         |

Use existing API revision checks, canonical retry receipts, request conflict
detection, one execution lane, cancellation and `context.mutate`. Editing and
applying an existing object require it to be unlocked. Source-resolution work
checks cancellation and resource admission. Apply never silently recomputes a
different result. Repeat apply with the same request ID returns its original
receipt; stale session versions and consumed previews fail predictably.

One session belongs to one workspace host. Join all existing competing-preview
admission checks, `inspectApplication().previews`, cancellation and API disposal.
Use a finite lease, with the existing 60-second cached-preview lease as the
initial proposed policy; a successful edit renews it. Geometry changes, recipe
changes, source deletion/replacement, project changes or undo/redo invalidate a
session. Selection-only changes do not change a definition already captured.

GUI controls invoke these commands through a small editor adapter with fresh
request IDs, current revision and expected session version. Numeric fields,
object selectors, canvas picks and endpoint handles edit the same draft. Apply
creates one history step. Cancel, expiry, failure and disposal create none and
release owned display/resources without clearing another workflow's preview.

## Project and workspace integration

The same coherent implementation must include these boundaries:

| Boundary                                           | Required behavior                                                                                                                                                                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`, `io.ts`                                | Explicit validated semantic geometry/definitions; preserve arbitrary legacy entity IDs; reject malformed definitions and incompatible geometry kinds.                                                                                  |
| Project binary codec and encoding/decoding workers | Preserve semantic fields and identity keys for live state and all undo/redo snapshots, without serializing derived display buffers as authoritative geometry.                                                                          |
| History and API revision                           | Definition-only edits count as changes even when resulting XYZ is identical. Immutable nested metadata must not alias mutable drafts.                                                                                                  |
| Digest and object inspection                       | Digest semantic geometry; expose definition, inputs, order, status, point/line counts and millimeter bounds. No triangle counts for references.                                                                                        |
| Viewport and agent picking                         | Render point markers and finite lines directly; share semantic hit IDs between GUI and MCP; support selection, visibility, clipping, appearance, bounds and disposal without mesh BVHs/normals.                                        |
| Alignment references and datum picker              | Expose stable point/direction references from the semantic objects; admit them in GUI selectors and shared datum operations using existing native feature conversions.                                                                 |
| Dependency graph                                   | Extend `datumEntityDependencies`; schedule and evaluate affected constructions in graph order after accepted source changes. Reject cycles before mutation. Store recipes separately from CAD parametric features.                     |
| Transforms                                         | Transform precise geometry and mode-specific numeric/pick state with recovered order; preserve links or bake only when the native command does so. Do not transform only the display buffer.                                           |
| Duplicate/delete                                   | Give duplicates new identities and preserve/remap source links according to recovered behavior. Apply the recovered dependent-deletion policy; no silent dangling links.                                                               |
| Mesh, scan, CAD and analysis operations            | Centralize eligibility so references cannot accidentally enter triangle processing. Unsupported operations report explicit structured reasons.                                                                                         |
| Export and downstream consumers                    | Preserve references in project export; define format-specific point/curve export from verified behavior. No malformed STL facets or silent solid conversion. Integrate construction inputs into the relevant sketch/pattern workflows. |
| Catalog and documentation                          | Publish only working commands/modes; update the agent guide with schemas, units, status, limits and recovery, and the architecture guide with ownership/dependency behavior.                                                           |

Exact files and reusable editor contracts are recorded in the existing
reconstruction contract. Implementation may split internal modules to avoid
expanding `App.tsx` and the central operations file unnecessarily.

## Evidence work that precedes dependent behavior

These are required implementation work items, not requests for the user to choose
native semantics:

1. Finish mode-specific input eligibility and CAD/curve/scan pick resolution,
   including the remaining persisted point fields and line pick-record meaning.
2. Recover line extent defaults, endpoint resize anchoring, and all pair/average
   fallback branches, including their state transitions. Constructor/command
   defaults and finalization thresholds are now statically established by the
   line-state audit; endpoint drag anchoring and editable-length admission still
   require evidence. Keep typed-endpoint and general setter arithmetic orders
   distinct.
3. Establish specialized source-change propagation, duplicate/delete, missing-link
   recovery and transform/bake semantics. Generic DAG scheduling evidence alone
   does not prove specialized construction evaluation.
4. Obtain original-code point/line outputs and actual native save/reopen outcomes
   for the modes and degenerate cases. Static instruction checks remain valuable
   but do not substitute for these comparisons.

Do not guess an unresolved branch to get a green test. Foundations and coherent
internal integration can be built while a remaining mode is researched, but
unsupported modes remain unavailable and the full reference capability is not
declared complete until every required mode and lifecycle gate passes.

## Acceptance and resource limits

Build first, then run the focused affected suites and static/formatting checks.
Heavy validation is serialized in owned Jobs under the approved 4 GiB / 25% CPU
policy with existing free-memory/disk guards, finite leases and cleanup receipts.
Do not relax limits to obtain a pass. Keep native code/assets and raw analysis
private. Do not commit unrelated dirty changes or publish/push without authority.

Required evidence includes:

- Native numerical fixtures for every input category and mode, both source orders,
  duplicate-source collapse, near-threshold/equality cases, skew/parallel/coincident
  geometry, fallback and unchanged-state paths, and repeated edits using prior state.
- Public MCP contract tests plus GUI-adapter tests for every action, parameters,
  outputs/errors, units, stale/retry/cancel behavior, locks and competing previews.
- Definition-only history/revision changes; dependency chains and cycle rejection;
  transforms, source edits, deletion/duplication and recovery.
- JSON and binary project round trips, including undo/redo, precise geometry,
  source keys, ordered picks and legacy IDs. No silent downgrade to coordinates.
- A rendered GUI/MCP comparison from the same real scan through construction and
  a downstream alignment/sketch use, including preview, cancel, apply, undo/redo,
  save/reopen and agent picks. Current browser access restrictions remain in force.
- Repeated preview/apply/cancel/reopen resource checks with all owned handles,
  buffers, sessions and jobs retired. Large-scan tests retain original buffers.

The present design and static evidence do not satisfy these implementation or
acceptance gates. No new construction command is advertised by this document.

## Builder decisions and approval boundary

The semantic kinds, separate recipe/geometry, raw ordering keys, session operation
family and shared editor are the proposed architectural decisions. Local module
names, UI layout details consistent with existing dialogs, and test organization
may be settled during implementation. Recovered native semantics are not optional
preferences and cannot be replaced by convenience behavior.

Design approval authorizes implementation of this architecture and its required
evidence work. It does not authorize bypassing browser/native restrictions,
changing resource caps, calling unfinished modes verified, committing unrelated
work, pushing, deploying or releasing.
