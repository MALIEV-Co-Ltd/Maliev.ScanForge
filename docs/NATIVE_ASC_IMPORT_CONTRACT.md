# Native ASC import: current evidence and remaining parity

This is a static contract investigation, not a completed ASC color feature.
The existing GUI and MCP importer both read XYZ or XYZ/NXYZ point clouds.
Their agreement does not establish native ASC attribute equivalence.

## Target identity

The installed QuickSurface executable inspected on 2026-10-22 is version
8.0.123.0, 13,617,424 bytes, SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`.
The retained original-process image has SHA-256
`a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`.
The metadata-only analysis derivative has SHA-256
`01612fc953b697abe2048a58891f4830de1215f5597501fc443f6b9ef8fd5e23`.
Its thirteen original sections remain byte-identical. Synthetic export metadata
seeds analysis; it does not establish an original export or runtime result.
The derivative was never executed or used as a replay module.

## Observed reader path

The retained ordinary ASC dispatcher constructs owner `0x14088cd80`, obtains
its geometry and calls `0x1408d9ae0`. The owner constructs geometry using
`0x14089e9d0`, with separate vectors for 48-byte point records and packed
four-byte colors. These bindings distinguish the actual ASC owner from a
generic point-cloud class used in earlier interface investigations.

The initializer `0x1408d8d90` examines at most fifty `fgets(..., 200, ...)`
chunks to find an XYZ record, trying whitespace, comma and semicolon formats.
It retains the detected separator and rewinds the file. It also tests a
six-float format, but that test does not make the load path a normal importer.

The line reader `0x1408d8900` first attempts a format composed of three `%f`
coordinates followed by three `%d` values using the detected separator.
On six successful conversions it appends the point and packs the low byte of
each integer into RGB, with alpha 255. If that attempt fails, a successful
three-float XYZ parse appends the point with the supplied default packed color.
The loader initializes that default to `0xffffffff`.

This establishes an XYZ/RGB interpretation in the observed native reader.
It does not establish exact integer overflow, locale, malformed-token or
non-finite conversion behavior. The three-value fallback and fixed separator
also differ from ScanForge's strict, consistent three-or-six-column parser.
Those differences require fixtures before a native-compatible parser is claimed.

The upload preparation path `0x14088e120` calls `0x14089f010`, which uploads
point records and visible indices. No normal-estimation call was observed in
that function. Later processing has not been completely traced, so this is
not proof that the native application never generates normals.

| Binding                  | REA Evidence                                                          |
| ------------------------ | --------------------------------------------------------------------- |
| Ordinary ASC dispatcher  | `ev_7879c4c0c4aa2b043ad303c52629c7141b2c16e811801b3a13290d7ab566cdad` |
| ASC owner constructor    | `ev_8d3fab9c6b748e80b50c5d35962a37b288754dc4964475425fafeb6a419d734e` |
| ASC geometry constructor | `ev_e87bf5066b50baddc38e8f6c00fb2ee4f8251e92cb2dccba8bce8c2536669bc1` |
| Reader initialization    | `ev_923e2e69d37558479d91eb932a5bd4236652f41f56004b9f001c6daf498298ea` |
| File load loop           | `ev_880a965bf741e1425bccdea7f5a8efa5646bcfdbaf49eea3e7b2f8098f5043c2` |
| XYZ/RGB and XYZ branches | `ev_2893fb3dd9268db8b6524b3ec123e14e691ecc522457a0052763aaae2437a7ec` |
| `%f`/`%d` literal bytes  | `ev_a6d3d49a4d99624d71de8dbe8e7b80ea82e6ff5f434c2d8e09f81d7fb8adc609` |
| Upload preparation       | `ev_3b6615f762eb066baee9c3dd6f786d6da5324849d93ab6b0b3b1b34c06f90994` |
| Point/index upload       | `ev_9bf17e832777c3f8886053ddc77cb7de507629f3c0c3d5c42125d484972f8180` |

## Current ScanForge behavior and required integration

`readAscPointCloud` treats every six-column record as XYZ/NXYZ. The original
`asc-3.asc` contains fractional values in the last three columns; preserving
those as normals is an existing ScanForge capability. The full-size GUI/MCP
comparison in [the import report](IMPORT_GUI_MCP_PARITY.md) verifies this shared
behavior, not native normal-import fidelity.

Six integer columns are ambiguous between colors and normals. A future color
implementation must preserve the existing interpretation explicitly rather
than silently guessing. It needs a shared GUI/MCP import option, persistent
byte colors, worker transfer, correct point-edit correspondence, transform
invariance, rendering and overlay restoration, JSON/binary backup and history,
canonical byte digests, bounded summaries, schemas, documentation and tests.
There is currently no general persisted color-attribute carrier to reuse.
Do not advertise ASC color support in discovery until that integration works.

Actual ASC admission to native Global Fine Align remains unverified. The owner
query thunk points to bytes at `0x14088d330`; those bytes include a delegated
query path. Ghidra has not defined that target as a procedure in this analysis.
A failed procedure lookup is not proof that code or an interface is absent.
The generic point-cloud null-interface fixture must not be used as proof of
the actual ASC owner's admission policy.

No application operation, MCP schema or advertised capability changes in this
documentation checkpoint. Native GUI import, full color outcomes and native
three-scan registration acceptance remain open.
