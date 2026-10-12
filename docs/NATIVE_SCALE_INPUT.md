# Native Scale input semantics

## Recovered command and arithmetic

The retained ribbon builder `0x1402f09d0` binds the Scale label to command `0x8390`. Ordinary mapped-image WM_COMMAND inspection resolves its action to `0x140808640` and enabled state to `0x140808990`. Fresh REA extraction of the action yields Evidence `ev_885fcdb1f6490928f802794dde6e4922a037381618fce40fcdd799c897317b0e`; complete assembly is `ev_f2c41f8ad77c2ea7bc5ebd910104fb6fd342d582fbe2af0ed7e28004a59e6252`. These are tied to derived-image SHA-256 `f605d0e24564021d939ba8bfe458b91b498af420baed341f724ca3ed2be8a273`.

The recovered dialog path uses resource `0x32b`. On acceptance, it reads a double value and a mode byte. Factor input is unchanged; percentage input is divided by the double constant 100. Instructions `0x140808872` and `0x140808876` narrow that result to Float32 and store it at `0x1415d87e4`. Dispatch later loads the stored Float32 into XMM1 and calls slot `0x40` of the object at the selected owner's `0x160` field. No scaling center is supplied by this particular call.

## Original-instruction verification

A bounded probe executes original instructions `0x140808859` through `0x140808876` from mapped-image SHA-256 `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`. An adapter supplies RBP, and a return boundary replaces the instruction immediately after the preference write. There are no numerical replacements, native imports, geometry calls, or native UI execution in this probe.

All 28 positive finite cases, covering factor and percentage input, match the Float32 output bits recorded in `tests/fixtures/scale-input-native.json`. Every caller-owned dialog byte and guard remains unchanged. The virtual allocation was released and the probe process exited. Original/replacement bytes and resource ledgers remain outside the repository.

## Application integration

`nativeScaleFactor` performs the same double percentage conversion and Float32 narrowing. `scaleScanMesh` normalizes its factor before multiplying coordinates. The panel now offers Factor and Percentage inputs; switching modes preserves the equivalent scale. Positive finite validation also rejects factors that become zero or infinite at Float32 precision before geometry is published. That validation is an application policy, not a claim about all native dialog validation branches.

Build passed with zero warnings/errors. Focused Scale, transform, and panel tests passed; the full suite passed 8,700 tests in 185 files. A fresh browser applied 110 percent to the 96-facet annular fixture as one history edit. All 864 exported coordinates matched the application transform using the original-instruction-verified Float32 factor. Browser warning/error logs were empty. Undo and input mode switching were checked separately.

## Scope still requiring evidence

This verifies input conversion and application dispatch, not complete native mesh-coordinate output parity. RTTI-based candidate slot inspection resolved unrelated matrix/container functions and was discarded as a mesh-method binding. The actual object at owner offset `0x160`, its dispatched implementation, and native coordinate output still require tracing. The application's configurable center remains an independently implemented extension; this trace does not prove native center selection or transform order. No native geometry fixture is claimed by the browser export check. The wider reverse engineering goal remains incomplete.
