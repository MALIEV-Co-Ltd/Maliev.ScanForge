# Captured native fit comparison

Native session r2 accepted Fit Surface Simple on the connected 200-facet scan
region: UI U4/V4, explicit degree3, OXY, expansion0, smoothness0. It saved a QSF
project and actual STEP AP214. STEP contains one cubic 5×5 surface, not a4×4
control net. Preserve UI labels and serialized control counts as separate facts.

- [x] Use a fresh owned native instance only after explicit coordinator release;
      retain4GiB/25% Job and finite lease, exact PID/HWND and authenticated cleanup.
- [x] Accept the native fit, save fresh QSF and export native STEP without mapping
      axes; preserve the original scan and previous native input project.
- [x] Parse bounded native STEP data, inspect/rebuild exact geometry and compare
      analytic properties; verify source hashes and zero remaining native handles.
- [x] Compare projected scan residuals and common-domain geometry/normal samples
      against actual ScanForge output, with domain inversion and parameter-count
      distinctions explicit. Do not infer closest-point RMS or general equivalence.
- [x] Verify native STEP import/inspection/modeling through GUI/public MCP, retain
      exact persistence/exchange and history evidence, then review the measured gap.

Only run numerical/kernel/browser work after a newly reserved heavy slot.
Native thicken/trim/continuity/blend operations, the complete real sketch chain,
M4 acceptance and hosted CI remain independent M5 gates.

The bounded fixture reader is `tests/helpers/native-step-patch.mjs`; the numerical
generator is `tests/helpers/native-fit-comparison.mjs` (bundle with esbuild for
its TypeScript evaluator import). Inputs are hash-pinned private fixtures at the
paths in the generator. Preserve the resulting bundle inside `.resources/m5/`
so its kernel-relative paths remain correct. Run under the existing bounded Job
wrapper with a768MiB Node heap and unchanged90-second kernel lease. The browser
phase uses the existing `tests/surface-fit-browser.mjs` with
`SCANFORGE_TEST_NATIVE_STEP` pointing to the captured native STEP, an owned
loopback preview, a disposable browser and the existing180-second outer lease.

Retained run r1 passed exact geometry inspection but failed browser replay at a
BUSY response because the harness did not await GUI import settlement. Fix the
harness wait, retain the failure and rerun. The revised numerical comparison
also requires inverse XY residual<=1e-5mm at every rectangle/centroid/source
sample and reports maxima. Earlier r1 rectangle metrics lacked this guard and
remain preliminary; do not promote them to native-equivalence evidence.

Run r4 passed guarded numerics and GUI/public-MCP native-input replay after fixing
shared project restoration in `e1a4a9a`. The restore kept saved numeric/BREP data
and adopted only refreshed kernel handles; cache stores IDs only. Red regression
failed both project and backup restore, green passed5tests. GUI/MCP imports,
thickening, history, GUI/MCP project reopen and solid STEP exchange passed on the
rebuilt app. A prior r3 console failure due to omitted normal postbuild generation
is retained separately. M5's broader native matrix and dependency gates remain open.
