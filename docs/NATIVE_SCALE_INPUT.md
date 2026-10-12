# Native Scale input semantics

## Recovered command and arithmetic

The retained ribbon builder `0x1402f09d0` binds the Scale label to command `0x8390`. Ordinary mapped-image WM_COMMAND inspection resolves its action to `0x140808640` and enabled state to `0x140808990`. Fresh REA extraction of the action yields Evidence `ev_885fcdb1f6490928f802794dde6e4922a037381618fce40fcdd799c897317b0e`; complete assembly is `ev_f2c41f8ad77c2ea7bc5ebd910104fb6fd342d582fbe2af0ed7e28004a59e6252`. These are tied to derived-image SHA-256 `f605d0e24564021d939ba8bfe458b91b498af420baed341f724ca3ed2be8a273`.

The generic dialog path uses resource `0x32b`. On acceptance, it reads a double value and a mode byte. Factor input is unchanged; percentage input is divided by the double constant 100. Instructions `0x140808872` and `0x140808876` narrow that result to Float32 and store it at `0x1415d87e4`. Only the non-mesh branch loads that value and calls slot `0x40` of the object at the selected owner's `0x160` field. The mesh branch enters an interactive mode. The slot `0x40` call is not evidence for the Scale Mesh coordinate routine.

## Dedicated Scale Mesh dispatch and coordinate kernel

Owner constructor `0x14088aac0` allocates its mesh through `0x140b353e0` and stores it at owner offset `0x160`. The constructor installs primary vtable `0x141248070`. The dedicated Scale Mesh dialog message map resolves Preview to `0x140646e90` and Accept to `0x140647060`. Preview clones the original owner mesh through `0x140b350e0`, converts its double factor (or percentage divided by 100) to Float32, and dispatches the clone's virtual slot `0x60`. That slot resolves to `0x1401de4c0`. Preview Evidence is `ev_e8e346c585d411db8f28fb158eefe68ec1bbff7b2d9df68dcf1c36f96fb9abf1`; its assembly is `ev_beec32239e15867b6adeac4ab2a33176d16e9e4ff90896baebb16dd4d57e876d`. Repeated preview transforms therefore start from an original-mesh clone; they do not repeatedly scale the previous preview.

The coordinate routine loads the vertex container at mesh offset `0x48`, obtains its count and indexed vertex pointers, and multiplies each of the three Float32 coordinates by the Float32 factor using `MULSS`. It clears the two-byte validity field at mesh offset `0x10` and tail-dispatches refresh through slot `0x28`. No center translation occurs in this routine. REA function Evidence is `ev_cb08a1656718ec17b3914289d8b9c8ddc651b583916f3f6565ec34f98d99bf0d`; assembly Evidence is `ev_c6dbe55fb89ef97898a74efa74e5df527f2bfcaf95eefb1c218056da06ce76e6`.

An isolated execution of the complete original coordinate routine, without instruction patches, captured 15 cases: the 96-facet annular source, a signed-zero triangle, and a Float32 rounding triangle at factors 0.001, 1, 1.1, 2 and 1000. All 4,410 coordinates and their raw output bits are retained in `tests/fixtures/scale-geometry-native.json`. Adapters supply vertex count/pointers and record the final refresh call; bounds/normal refresh arithmetic and native allocator lifetime are outside this probe. The probe verifies the mapped-image digest, preserves all vertex bytes beyond the coordinates, observes validity invalidation and one refresh dispatch, and releases its mapped allocation.

## Original-instruction verification

A bounded probe executes original instructions `0x140808859` through `0x140808876` from mapped-image SHA-256 `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`. An adapter supplies RBP, and a return boundary replaces the instruction immediately after the preference write. There are no numerical replacements, native imports, geometry calls, or native UI execution in this probe.

All 28 positive finite cases, covering factor and percentage input, match the Float32 output bits recorded in `tests/fixtures/scale-input-native.json`. Every caller-owned dialog byte and guard remains unchanged. The virtual allocation was released and the probe process exited. Original/replacement bytes and resource ledgers remain outside the repository.

## Application integration

`nativeScaleFactor` performs the same double percentage conversion and Float32 narrowing. `scaleScanMesh` normalizes its factor before multiplying coordinates. The panel now offers Factor and Percentage inputs; switching modes preserves the equivalent scale. Positive finite validation also rejects factors that become zero or infinite at Float32 precision before geometry is published. That validation is an application policy, not a claim about all native dialog validation branches.

Build passed with zero warnings/errors. Focused Scale, transform, and panel tests passed; the full suite passed 8,700 tests in 185 files. A fresh browser applied 110 percent to the 96-facet annular fixture as one history edit. All 864 exported coordinates matched the application transform using the original-instruction-verified Float32 factor. Browser warning/error logs were empty. Undo and input mode switching were checked separately.

## Scale preview and acceptance integration

Fresh REA extraction of dialog helper `0x140647280` yields function Evidence `ev_7f4e5217d231527bba64b6040251846e74361af0fe14ecb187b35100fc5d3917` and assembly Evidence `ev_84bd343d49755d5446d236a4f73d290c2f11044be8ead4963227fc2739d21351`. Accept calls this helper with flag one; the zero-flag path removes the preview property. The accepted path handles owner state and preview ownership, removes the preview property and sends a notification. It contains no direct invocation of the coordinate scaling routine. The branch controlled by dialog offset `0x9c4` can create another mesh owner and transfer the preview pointer; The pointer-adoption stage now has the runtime gate below; notification/history internals and full native dialog execution remain unverified.

The application now routes Scale through its existing Preview/Accept/Cancel lifecycle. Each preview starts from canonical source coordinates; Accept publishes the prepared output once and creates one history edit. Cancel discards it. Scale preview requires neither welding nor adjacency construction, and it exposes no deviation comparison. Fifteen original-coordinate captures also gate the preview session, and a worker regression sends successive factors using the same retained original to detect compounded scaling. Preview source bytes remain unchanged, including signed zeros.

Build passed without warnings/errors, all 75 focused tests passed, and all 9,227 tests across 191 files passed. Scoped formatting and diff checks passed. The fresh browser build `scanforge-7acdedd34e229e6d` verified that saving during preview exports the original geometry. Previewing 1.1 followed by 2 and accepting produced the native factor-two bytes for all 864 coordinates, with one history edit. Cancelling a subsequent factor-ten preview retained those same accepted bytes. Cache bypasses used for verification were restored, and the temporary REA helpers exited. This verifies the application lifecycle and native coordinate correspondence; it does not establish complete native history or new-object parity.

## New-object acceptance and ownership verification

The owner constructor's primary vtable is `0x141248070`; `0x140ebfcf0`
belongs to the mesh object, not the owner. Following the actual owner slots
resolves `0x140406060` to state toggling, not geometry adoption. Promotion helper
`0x140597190` queries the preview property and swaps its mesh through
`0x14034aba0`, retaining the previous mesh in the property. REA promotion Evidence
is `ev_8f4de5dd62ffe31e843c858159049f5d573c904b1bb788b01c92b7a1f7ca6f42`.

The complete pointer-adoption routine `0x14034aba0` detaches the previous mesh's
owner reference, replaces owner field `0x160`, attaches the new owner reference,
and returns the previous mesh in RAX. The decompiler's void return is misleading;
assembly Evidence `ev_4e6184dc71bb1cd069a66527ba90efefaf7b6e4d55a7e8fbb78e983aee9496dc`
proves the return value. Sixteen original-instruction executions cover null and
present old/new meshes with four signed virtual-base offsets. No instructions
are patched; all guard bytes remain unchanged, and the allocation was released.
These are synthetic ownership structures, not native UI or history execution.

The application reads Create new object at acceptance, adopts the prepared Scale
preview into a distinct entity, and retains the original. The native dialog's
`0x9c4` branch similarly constructs another owner and transfers the preview;
there is no second coordinate scaling call. Application naming and metadata
cleanup remain explicit implementation choices. Fifteen captured coordinate
cases verify adoption without recomputation, including signed zeros.

The production build and 58 focused tests pass; the unchanged implementation
also passed the full 9,245-test suite. Browser validation enables Create new
object after Preview, accepts factor two, and exports two distinct objects:
original bytes and native factor-two bytes both match. Undo exports only the
original; Redo restores the copy. Cancelling a factor-ten new-object preview
retains both accepted objects and one history edit. Native full-dialog
notification/history parity remains unverified.

## Scope still requiring evidence

The geometry gate now verifies native origin-coordinate output on the 15 captured cases through both the direct transform and production Scan Tools dispatch. The five signed-zero cases initially failed because subtracting and adding the zero center erased sign bits; origin scaling now performs direct multiplication and preserves them. This is a numerical-kernel comparison, not a full native UI export or verification of every mesh, refresh implementation, or Accept/history branch. The application's configurable nonzero center remains an independently implemented extension. The wider reverse engineering goal remains incomplete.

The new fixture stores raw source bytes as well as coordinate values, because JSON module compilation can normalize negative zero. Regression tests decode those source bytes and compare raw published bytes, including explicit zero-center dispatch and source immutability. Fresh validation passed: build with no warnings/errors, 68 focused tests and all 9,210 tests across 190 files, scoped formatting and diff checks. The rebuilt browser applied 110 percent to the same annular source and exported 864 coordinates matching the original coordinate kernel byte-for-byte (SHA-256 `962287c3e6a1bf7a993960bb0a5fbe2cdd72247da1b5d1dea9c746bf71a09a43`). Its verified build is `scanforge-dea4125377d72898`; browser warning/error logs were empty. A stopped previous localhost host initially left the page on an offline cached build and its worker failed to load. A bounded static preview host and temporary cache bypass loaded the fresh build; the bypass was restored after verification. Both native probe processes exited and their mapped allocations were released.
