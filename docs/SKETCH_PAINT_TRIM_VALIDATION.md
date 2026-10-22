# Sketch paint-trim validation

The shared `sketch_trim_stroke` operation and actual canvas gesture passed a synthetic three-plane workflow on 2026-10-22. This validates the documented application contract; native numerical equivalence and undocumented brush/constraint policies remain unverified. See [implementation evidence](NATIVE_SKETCH_PAINT_TRIM.md) and the [agent guide](AGENT_GUIDE.md).

Production build `scanforge-2358069efeaf2d7b` passed TypeScript and Vite. All 1835 compiler inputs matched before and after the build. The full suite passed 47418 tests with 61 skipped across 568 passing and 17 skipped files. An initial passive-pointer regression was fixed with explicit active-drag/pointer guards; the accepted full suite and build include that fix.

Public MCP created concentric circles intersected by a line on offset OXY, OYZ and OXZ planes. An analytic MCP trim removed only the interval between radii 2 and 3. Actual unsnapped canvas drags with grid snapping enabled produced exactly the same authored sketches. One GUI sketch Undo restored the source; MCP Redo restored the result. Model history stayed unchanged.

An independent canvas pixel check on OXY observed both baseline gap probes, neither probe during the held preview, and both after Escape. Six retained line and six circle probes stayed visible throughout; authored sketch and project revision stayed unchanged. The check completed in 511 ms. A first attempt stopped before any gesture because a threshold rejected antialiased baseline line pixels; the corrected detector and bounded workflow were independently reviewed.

The browser also verified tool-change cancellation, intervening public source replacement, no-hit revision/history preservation, atomic rejection of affected constraints, identical-request retry and public project export/reopen. Projection used copied public camera matrices, without private application getters or assumed FOV. Browser errors were empty.

The 4 GiB aggregate Windows Job peaked at 785719296 bytes. All 17 observed processes exited, final active count was zero, handles closed and cleanup errors were empty. Fresh source/build/tool pins were checked before and after the run. Accepted run: `20261022T104856716766Z`.

The saved example contains synthetic sketches, not original scan acceptance evidence. Native policy comparison, sketch fillets and broader construction/sketch acceptance remain open. No release or deployment is implied.
