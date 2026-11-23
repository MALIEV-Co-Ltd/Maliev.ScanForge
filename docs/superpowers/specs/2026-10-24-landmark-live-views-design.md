# Live N-point alignment

Approved by the owner in chat on 2026-10-24.

Keep the main viewport for the alignment result. Stack two smaller independently navigable views on its right: Moving and Reference. Each picking view shows its object at its original pose and numbered landmarks. An explicit reference selector isolates one object; retain existing unbound visible-reference sessions for agent compatibility.

Allow any number of ordered matching point pairs. Three complete pairs trigger an automatic preview; subsequent complete pairs recompute it. Edits invalidate the previous result and cancel outstanding calculations. Incomplete groups cannot be accepted. OK commits one history operation; Cancel preserves original geometry.

## Approaches

Reuse the existing Viewport and shared landmark operations (selected): preserves picking, native registration, geometry handling and navigation. A separate lightweight renderer would duplicate picking and scan rendering; a single canvas with mode switches would not meet the requested layout.

GUI and MCP must use identical session edits, automatic preview scheduling, cancellation, diagnostics and acceptance. Extend existing viewport contracts with main/moving/fixed selection, and publish preview status and view object IDs through landmark_get. Retain revision, retry, lock and resource protections.

No new dependencies. Preserve unrelated working-tree edits. Verify session and contract tests, type checking, production build and actual browser GUI/MCP outcomes.
