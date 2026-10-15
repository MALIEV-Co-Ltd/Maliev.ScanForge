# Native Interactive mirrored-point rendering

The [trace index](evidence/interactive-mirror-point-native-trace.json) binds the original image hashes, retained REA/Ghidra evidence and renderer dispatch. This is internal rendering groundwork; the public Interactive command remains gated.

## Dispatch and recovered rules

Original mirror callback `0x14069e900` snapshots each mesh style, sets the base RGBA to `(Float32(0.8), Float32(0.8), 0, 1)`, selects mode 2 and point size 2, calls renderer `0x140836100`, and restores the style. The renderer's embedded object at `+0x280` is initialized by `0x140ac9070` with vtable `0x141269518` (`cM2SMeshGLRenderer`). Its `+0x8` dispatch is `0x1408c00f0`; mode 2 selects slot `+0x18`, original point loop `0x1408c04e0`.

The point loop submits `GL_POINTS` and applies these rules in order:

- Skip vertex flags masked by `9` (bits 0 and 3).
- In selected-only mode, require flag bit 1.
- Apply the separate stride field when its signed 32-bit interpretation is at least 2. The modulus uses the unsigned field. High-bit values therefore take the original all-points branch.
- An unselected candidate changes the current GL color before normal culling. A selected candidate inherits the current color; the loop does not restore the initial selected color for every selected vertex.
- Unless backfaces are enabled or the view direction is zero, require a positive Float32 dot product. Products and additions are rounded in native Y/X/Z order. The original comparison rejects unordered products, including overflow cancellation from otherwise finite inputs.
- With zero view direction, multiply both colors by Float32 `1.8`, rounding and clamping their upper components to 1.

The argument `1,000,000` passed by the mirror wrapper is **not a one-million-point cap**. The point loop compares it with elapsed milliseconds after submitting all eligible points. A smaller allowance changes its completion flag, without truncating the point list. The wrapper also has an equality check for this value; that check does not establish a point limit.

## Direct original-code verification

[The retained fixture](../tests/fixtures/interactive-mirror-point-selection-native.json) contains 2,160 complete executions of original `0x1408c04e0`. Cases cover zero, 16 and 32 source vertices; flags and selected-only filtering; nine stride values including signed-boundary cases; five view directions; normal culling and backfaces; Float32 cancellation/overflow; color inheritance; and four time allowances.

The harness executed the original mapped procedure with controlled source-vertex interfaces, GL state/submission sinks and performance counters. Only external callbacks and the security-cookie exit were redirected. It recorded point indices, Float32 color bytes, point submissions, GL primitive mode and completion status. The production helper in `src/interactive-mirror-selection.ts` matches all captured indices, color bytes and completion flags.

This did not create a real OpenGL context, execute the wrapper's reflection/model-view matrix stack, or use the owner scans. It does not prove pixel-identical rendering, the application's facet-mask to native vertex-flag mapping, or a complete Interactive GUI/MCP workflow. Those remain integration requirements before enabling the command. The helper is internal and is not exposed as a separate agent math tool.

## Performance boundary

A local Node CPU benchmark on one million synthetic points retained 909,090 points and prepared their index/color arrays in approximately 29–40 ms over six runs. This measures CPU preparation, not browser rendering or native application speed. The verified loop must not be run synchronously on every viewport frame; cached buffers and off-thread or GPU preparation need their own parity and browser measurements.

## Shared background preparation

`InteractiveBoundsPool.mirror` now runs the recovered point loop in the same pool used for measured bounds. A session owns at most two physical workers. Concurrent bounds and mirror requests share one source preparation per worker; original position, normal and flag buffers remain attached. A failed worker generation cannot terminate its replacement through a late error event. Explicit cancellation permanently closes the pool, and idle/request/self leases remain bounded.

Partitioning preserves global stride indices and the original color-state transition across worker boundaries. Each partition receives whether an earlier eligible unselected vertex changed the current color, including candidates rejected by normal culling. The optional source-indexed color output stores candidate colors before normal culling, allowing the renderer to retain colors while view direction changes. Colors must be rebuilt when flags, stride, selected-only mode, RGB values or zero-direction brightness change. An indices-only request returns no color buffer. Worker failure or unavailability uses a cooperative fallback with at most 32,768 points per task, rather than processing the whole scan synchronously.

The [owner-source native capture](../tests/fixtures/interactive-owner-mirror-points-native.json) executes the complete original point loop over all 3,381,455 source vertices from the three supplied PLY scans. It records deterministic test flags, source-file/coordinate/normal/flag hashes, and native index/color/submitted-position hashes. These are the same buffers and recorded test selections supplied to the port; they do not establish native importer parity or the native UI's facet-selection mapping.

The [real-worker browser replay](evidence/interactive-mirror-background-browser.json) matches those three native output digests and all 2,160 smaller native cases. It also retains the 99 bounds-kernel and 18 owner PLY/ASC pose comparisons. Bounds followed by mirror preparation reuses the same cached worker sources. Fifteen warm, changing-direction requests transfer indices only, without new source preparation or color arrays. Those requests measured approximately 3–23 ms, with no observed main-thread long tasks during the short warm-update sample. At most two workers were live, and zero remained after close. These are preparation timings, not complete rendering or native application timings.

This backend remains internal. The public Interactive dialog, mirrored GPU display, GPU integration of the wrapper matrix stack, actual native UI selection mapping and end-to-end GUI/MCP publication are still unfinished. No unsupported public descriptor or enabled ribbon command is introduced by this checkpoint.

### Background preparation validation

The build passed with zero warnings/errors (`scanforge-68f6a51bfa5ad801`). Focused validation passed 2,170 tests across three files. The default suite passed 33,020 tests across 384 files, with 31 optional checks skipped across seven files. The owner-source replay used the production-compiled worker and retained the hashes and timings above. Formatting, whitespace and the repository-wide forbidden-token audit, including decompressed gzip fixtures, passed. The temporary browser, input server and regression-suite processes exited. Port 5173 continues serving the application.

## Earlier point-loop validation checkpoint

The build passed with zero warnings/errors. Focused validation passed 2,860 tests in four files. The default suite passed 32,905 tests in 381 files, with 31 optional owner-data checks skipped in seven files. Formatting, staged whitespace and forbidden-token checks passed. All owned REA processes and native probe processes exited, and the mapped probe image was released. The [CPU preparation measurements](evidence/interactive-mirror-cpu-benchmark.json) are retained separately from the native output captures. Port 5173 remains available; this internal helper does not enable the unfinished Interactive dialog or add an unsupported public MCP command.
