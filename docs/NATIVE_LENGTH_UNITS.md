# Native length units and default-value formatting

This is a recovered native contract for duplication and other length controls,
not an implemented ScanForge preference or completed numerical acceptance test.
All current ScanForge workspace coordinates remain millimetres. No new GUI or
MCP operation is advertised by this investigation.

## Conversion binding

The digest-bound private analysis image has SHA-256
`a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`.
REA binds constructor `0x1404040e0`, unit setter `0x140404570` and startup
initializer `0x1407b9ad0`. The setter maps the following IDs to concrete virtual
tables. The double-valued display and internal conversion slots are `+0x10`
and `+0x20` respectively.

| ID  | Unit | Virtual table | Internal mm to display      | Display to internal mm |
| --- | ---- | ------------- | --------------------------- | ---------------------- |
| 0   | mm   | `0x14117b590` | identity                    | identity               |
| 1   | in   | `0x14117b620` | multiply by `0.03937007874` | multiply by `25.4`     |
| 2   | m    | `0x14117b5d8` | multiply by `0.001`         | multiply by `1000.0`   |

The inch multiplier is the stored binary64 representation of the literal shown;
it is not the binary64 result of `1 / 25.4`. An independent negative check
rejects that exact-reciprocal substitution. The setter's internal fallback for
an unknown ID constructs the millimetre converter and records ID zero; this
alone does not establish the public UI's invalid-input contract.

Ghidra does not recover function owners for these very short conversion methods.
Their byte sequences, constants and virtual-table slots were checked separately
with Capstone 5.0.6. This is not a complete Ghidra function-body claim.

## Default spacing formatting

Duplication activation passes the internal value 10 through helper
`0x140404310`. It invokes the display conversion, formats the result, and parses
it back to double. The formatting manipulator at `0x1404040c0` clears bit
`0x1000` and sets bit `0x2000`. These match scientific and fixed float formatting
in [Microsoft's STL definitions](https://raw.githubusercontent.com/microsoft/STL/main/stl/inc/xiosbase).
The precision is the wrapper's integer field at `+0x20`, with one extra decimal
place when the unit ID at `+0x10` equals one (inches). Startup initializes that
precision to six. The generator later converts displayed spacing back to
millimetres through slot `+0x20`.

Thus the default passes through unit conversion and decimal formatting before
translation generation. Replacing this path with an exact unit ratio, a
32-bit extraction, or an unconditional literal 10 loses observed behavior.
Locale, rounding ties, overflow and the native UI matrix across units/precision
settings still require numerical replay.

## Current runtime observation and validation

A passive Windows read bound to the installed executable SHA-256
`0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`
and exact process creation time found unit ID zero, millimetres, precision six.
Two independent settings reads agreed, and the live conversion method bytes
matched the digest-bound static method. The helper used query/read access only;
it called no target function and read no scan geometry. This observation does
not prove that duplication or an alignment controller executed.

Verification covers 34 instruction anchors, four binary64 constants, six
virtual-table slots, three decoder cases and three negative decoder cases.
The runtime helper made 12 region queries and peaked below 15 MiB under its
existing 4 GiB/25% CPU limits. Process and Job handles closed. The analysis
provider closed with no pending cleanup and no remaining owned Java process.

See [structured facts](evidence/native-length-units.json). Full duplication,
picked-line eligibility/frame fixtures, curve-category behavior, relation equations
and native numerical acceptance remain open. The picked-line arithmetic is now
bound in [duplication evidence](NATIVE_SKETCH_DUPLICATION.md).
