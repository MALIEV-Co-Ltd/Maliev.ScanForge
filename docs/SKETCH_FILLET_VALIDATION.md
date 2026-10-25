# Fixed-radius sketch fillet validation

On 2026-10-22, `sketch_corner_fillet` and the actual GUI Corner Trim controls passed a synthetic fixed-radius workflow on offset OXY, OYZ and OXZ planes. The documented scope and remaining native requirements are in [the fillet evidence record](NATIVE_SKETCH_FILLET.md).

Production build `scanforge-424084a9d82ff442` passed TypeScript and Vite; all 1838 compiler inputs matched before/after. The affected focused run passed 458 tests across nine files. The full suite passed 47463 tests with 61 skipped across 570 passing and 17 skipped files. The real CAD smoke test also passed, including 338 native datum placement matrices and exact topology/handle cleanup checks.

Each browser fixture was a closed 10×10 mm rectangle. Public MCP rounded the bottom/right corner with radius 2 mm; independent checks required intersection `(10,0)`, tangent points `(8,0)` and `(10,2)`, center `(8,2)` and a counterclockwise analytic arc. Actual GUI line/end selectors, radius input and Create fillet action produced the same authored result. One GUI sketch Undo restored the rectangle; MCP sketch Redo restored the fillet. Model history stayed unchanged. Invalid/excessive radius, affected constraints and stale revisions failed atomically; identical request retries reused their result. Public export/reopen preserved saved sketches and CAD object count.

GUI extrusion and public `cad_create` both produced exact CAD from the same analytic profile. Independent kernel face inspection found the expected six planes and one cylinder with radius `1.9999999999999998` mm and axial length 5 mm, bounds `(0,0,12)` to `(10,10,17)`, and identical GUI/MCP descriptors. Mesh volume was `495.70165578477327` mm³, with error `-0.00630748317570351` mm³ relative to the analytic expected volume. This is tessellation-derived volume, not exact kernel mass.

The kernel reader previously returned a placeholder zero cylinder radius. A physical-radius assertion failed before the reader fix and the actual CAD smoke passed afterward. The additive shared `radiusMm` observation leaves existing axis/plane mathematics, geometry, revision and history unchanged.

Accepted browser run: `20261022T112340610991Z`. Browser errors were empty. The 4 GiB aggregate Windows Job peaked at 1363152896 bytes; all 17 observed processes exited, final active count was zero, handles closed and cleanup errors were empty. Fresh source/build/tool pins were checked before and after execution.

This is synthetic application validation. Native automatic radius fitting, area-selection gestures, automatic dimensions, line/arc fillets and numerical/constraint policy equivalence remain open. The broader construction/sketch milestone remains open; no release or deployment is implied.
