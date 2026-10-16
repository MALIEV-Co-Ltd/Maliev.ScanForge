# ShrinkWrap self-intersection validation plan

> For agentic workers: use superpowers:executing-plans for the implementation steps; predicate implementation and independent review may be delegated with disjoint file ownership.

**Goal:** Exhaustively verify the accepted exported-scan result, and prevent ShrinkWrap from returning newly intersecting geometry through either GUI or MCP.

**Architecture:** A bounded BVH candidate traversal uses exact Float32 orientation predicates. The shared whole/local kernel refuses intersecting results before the existing GUI/MCP result or preview lifecycle can accept them.

**Tech Stack:** TypeScript, Three.js, three-mesh-bvh, Vitest and the existing browser/MCP parity harness.

**Spec:** [ShrinkWrap workflow](../../SHRINKWRAP.md); this validation extends the approved shared-operation design.

## Steps

- [x] Add and red/green test exact Float32 triangle contact predicates, allowing only shared topology.
- [x] Add bounded BVH broadphase and compare exhaustive candidate coverage with brute force on small fixtures; cancellation and limits must never claim verification.
- [x] Audit the saved 8,319,632-triangle result without modifying input/output. Record geometry hash, complete pair count, examples, runtime and owned-process cleanup.
- [x] Integrate the same verification in the shared whole/local kernel. Whole checks all pairs; local checks generated/changed facets against the parent, preserving unrelated outside geometry and avoiding claims about pre-existing outside intersections.
- [x] The unchanged saved scan has zero self-intersections; no geometry repair was required. Fixed the missing validation gate and two index-integrity failure modes, retaining earlier topology and source-fit evidence for the identical geometry hash.
- [x] Build the scoped intended commit, focused and full suites, formatting and GUI/MCP browser parity; review, commit only scoped changes, no push.

Use exact original face IDs, bounded reports and cancellation/progress. Global verification is exhaustive for the supplied Float32 surface, not a claim about reconstruction accuracy or nested solid orientation. Preserve unrelated working-tree changes. Heavy validation is serialized under the unchanged resource guard.
