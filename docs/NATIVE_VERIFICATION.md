# Native Scan Data verification

The early inventory below is historical. Subsequent mapped-image extraction recovered defeature and selected smoothing, documented in [DEFEATURE_FIX.md](DEFEATURE_FIX.md) and [SELECTED_SMOOTHING.md](SELECTED_SMOOTHING.md). Reduce Noise numerical, octree and default-palette verification is in [MESH_PARALLELISM.md](MESH_PARALLELISM.md). Current polygon reduction tracing and percentage verification is in [NATIVE_POLYGON_REDUCTION.md](NATIVE_POLYGON_REDUCTION.md). Scale factor/percentage input verification is in [NATIVE_SCALE_INPUT.md](NATIVE_SCALE_INPUT.md). Full tool equivalence remains incomplete.

## Evidence obtained on 2026-10-12

REA 6.4.0 successfully used the existing isolated Ghidra 12.1.4 and JDK 21
installation. No additional installation or global configuration change was
needed. Binary analysis and recovered pseudocode are retained outside this
repository.

The main executable's SHA-256 is
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
A bounded procedure-name search for defeature, reduction, smoothing, noise,
scale, mirror, unroll, averaging, holes and polygons returned the CAD helper
`BRepFill_OffsetWireEx::FixHoles` at `0x1401b4f60`. This is not a recovered
Scan Data handler. Missing names do not demonstrate missing implementations.
Search evidence:
`ev_adb9436377cb23b6652d3a3f8466f8c1cafe7524b132a8a7a1153fb99fd43c58`.

The companion `flatten.exe` has SHA-256
`372d7b739b72b9cd510965ad1004e31f451c512883b30715ec1e086ddebbcbb6`.
String search found its usage text; incoming-reference analysis resolved
`0x4031b9` inside function `0x403190`. REA recovered that complete 133-byte
function's pseudocode and assembly and identified its caller at `0x402c80`.
The recovered function prints OBJ input/output arguments and options for cone
count, disk flattening, sphere mapping and UV normalization. It is a usage
formatter, not a recovered geometric algorithm. Its existence does not link
this companion to the application's cylindrical Unroll command.

- String search:
  `ev_2d6fd802fdc3d071cdf997ce58097b51fb7da631e2dea8750a48972604a6f808`.
- Incoming reference:
  `ev_559a2cb27dddb51ac268dbea424d37c5df6e5232b8c11974a81506bbfa81e663`.
- Complete function:
  `ev_c91d69f62e794d9e7359d248a86fb7b964a668b46c91d13e05842a471049f2a8`.

Following the caller recovered three more complete functions:

- `0x402c80` parses OBJ paths and the four options. A positive cone count
  clears the disk/sphere flags. Evidence:
  `ev_506d4941d6d85166cb268fd8e2d41aa2f208be0d6bb28ebfd507a2d4c38fb476`.
- `0x4035b0` initializes the flags, calls the parser, processes mesh records,
  invokes `0x4026c0` and then the output routine. Its closed-surface branch
  raises a cone count below three to eight when sphere mapping is disabled.
  Evidence:
  `ev_98d4d5dfe9894eefb1c6dd4f61daa5eeec35e93bb1f84b62ac1631c1bc50092b`.
- `0x4026c0` iterates mesh records and dispatches cone, open-surface disk or
  closed-surface sphere branches. Without cones, a closed surface requires
  sphere mapping or it reports an error and exits. Calls to `0x408400`,
  `0x408680`, `0x408920` and `0x408f30` identify the next mapping routines;
  their numerical bodies have not been recovered in this investigation.
  Evidence:
  `ev_0676675067346da76bfef809bff4f0ac0491facedd6810e15b557313502bdc0e`.

This recovers actual companion control flow, rather than interpreting option
names alone. It still does not establish a connection to cylindrical Unroll.

## What remains unresolved

No recovered function in this investigation has been connected to the Scan
Data defeature or Tools UI command. No same-input native/browser numerical
comparison was performed, so algorithm parity is not verified.

Earlier retained evidence records a failed main-function recovery at
`0x140520530`: the decompiler exceeded its memory budget, with no pseudocode
recovered. That function has not been established as a mesh handler. Protected
section layout suggests that ordinary static analysis may be incomplete; it
does not identify where any particular operation resides.

Further native work requires the existing 3,072 MiB free-memory admission
guard. The next session must trace the relevant UI command to its actual
handler, follow the geometry-producing calls and parameter policies, then
compare native and browser results on identical reproducible fixtures. Checks
must include topology, untouched geometry, deviation, normals, seam handling
and failure behavior appropriate to each operation. Manufacturing a passing
browser-only fixture cannot establish native equivalence.

These findings leave the independently implemented MVP's documented behavior
unchanged. They replace an unsupported implication of equivalence with a
specific recovery record and explicit remaining evidence requirements.
