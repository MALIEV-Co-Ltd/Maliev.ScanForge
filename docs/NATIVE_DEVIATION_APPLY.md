# Native deviation Apply workflow

## Recovered dispatch

The retained mapped-image message tables at `0x1411a9af0` (polygon reduction) and `0x1411c5670` (Reduce Noise) bind command `0x41b` to `0x140598b80` and `0x14064bc80`, respectively. The same tables bind Preview command `0x452` to the independently recovered preview handlers and distinguish the deviation checkbox command `0x455`. This is ordinary offline message-entry parsing, not an observed UI event. The control label association uses the retained native dialog observations; no new native UI session was captured.

Both Apply handlers read dialog fields with `UpdateData(true)`, update the tolerance, write the controls with `UpdateData(false)`, convert the value for preference storage, format/save that setting, and invoke comparison. Polygon reduction uses Float32 field `0x2a8` and calls `0x140598310(dialog, 1)`; Reduce Noise uses field `0x280` and calls `0x14064b190(dialog)`. Complete handler assembly contains no reduction or smoothing call. Apply therefore updates comparison of the existing preview; it does not produce another geometry edit or commit the preview.

Polygon handler REA Evidence is `ev_fb848040419ec29b8b97bac0a202db5885b9fad5d164a0497a258e4fedf9cb1e`; its complete assembly Evidence is `ev_39665070f1207c1b724e5ede59ba7528875221bdd43eb7255336116e9ca9ffc3`. Noise handler and assembly Evidence are `ev_3d60aefed45808299e0903e36acd5cd4c89b1aca4860d7abec4d3b3268d9b7db` and `ev_2326d4354c3233bae1af14374d89b9af5d393b66b11c19e1666b7c9a63645efe`. All extracted handlers are tied to derived-image SHA-256 `f605d0e24564021d939ba8bfe458b91b498af420baed341f724ca3ed2be8a273`.

## Retained preview search structure

Polygon comparison creates its search object only when dialog pointer `0x270` is null; noise comparison uses pointer `0x170`. Their recovered routines call builder `0x140a7f470` only inside those null checks. Fresh previews release/reset the old pointer. Reapplying a threshold to the same preview reuses its search structure; it does not weld vertices, construct mesh adjacency, or reduce/smooth geometry again. Comparison sample queries and colors still need recomputation when thresholds change.

This is static lifecycle evidence. It does not establish allocator behavior under memory pressure, full native dialog performance, or the contents of a live preview object in an arbitrary session.

## Original instruction probe

A bounded isolated probe executes both original Apply handlers from mapped-image SHA-256 `e10b727582bc2b59f2e243ee7f247642957e388fc6bb995d7931afb9e77f78d1`. It supplies adapters for dialog data exchange, identity unit conversion, string formatting, preference storage, comparison dispatch, and the security-cookie check. It neither executes comparison algorithms nor runs the full native UI. Handler arithmetic and control flow remain original instructions.

All 14 cases preserve every supplied dialog byte outside the four-byte tolerance field, including the polygon target count. Each dispatches comparison exactly once after the two data-exchange calls and preference write. Positive finite tolerances remain unchanged; a negative finite input becomes positive zero. The native `MAXSS` instruction also preserves a negative-zero second operand, positive infinity, and the supplied quiet-NaN bits. These latter cases correct the stronger clamp implied by decompiled C; they do not prove that downstream native comparison safely supports nonfinite inputs. Application input validation should remain explicit.

The complete probe, original/replacement bytes, event sequences, output bits, process ledger, and virtual-allocation cleanup remain outside the repository. Both REA and probe processes exited. No target binary or user mesh was modified.

## Application gap and required implementation

The application currently combines geometry processing and optional comparison in its Scan Tools Apply action. That does not replicate the recovered Preview / deviation Apply / final acceptance workflow. The next integration must retain immutable original and preview coordinates plus a comparison search structure, update comparison without rerunning geometry processing or adding a history entry, replace the search structure when preview geometry changes, and publish a geometry edit only on final acceptance. Cancel must discard the preview. The existing exact native geometry, comparison, cancellation, and multicore gates must remain intact. Full UI parity is still incomplete.
