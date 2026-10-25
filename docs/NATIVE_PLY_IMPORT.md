# Native PLY import finalization

Static analysis of the retained current-version code image recovers the PLY import dispatcher, reader and geometry finalizer. The reader requests XYZ and nx/ny/nz, then calls geometry virtual slot +0x58 with flag 1. The associated retained geometry vtable points to a finalizer that unconditionally calls the previously recovered angle-weighted Float32 vertex-normal producer. The dispatcher also regenerates normals after non-unit import scaling. File normals therefore do not establish post-finalizer native normals.

The finalizer first enumerates a mesh-owned container and writes sequential int32 ordinals to returned items. Its direct body has no XYZ or topology writes, but the concrete current container binding and iterator effects remain unresolved. The next virtual call clears two state bytes and dispatches bounds work: eight ranges, copied matrix state, identity-dependent parallel templates and a final bounds merge. Two task thunks lead to bodies not yet reviewed. That work must not be declared geometry-preserving from the dispatcher's name or bounds stores alone. The final conditional virtual call is a three-byte return-true stub in the retained table.

Analysis used a reviewed static-only PE metadata derivative with byte-identical original code/data sections; it was never executed or used as a replay image. Synthetic export labels identify analyst-selected entry points, not original public exports or verified calling conventions. Historical process import pointers and unresolved indirect calls limit the retained image. No native runtime or finalizer was invoked by this analysis.

The retained source image SHA-256 is `a82f29917eae7fdc4ea1f34785f734fb0ba0981c916043cd4b1fffbddd7fbd90`, with analysis base `0x140000000`; installed version 8.0.123.0 has executable SHA-256 `0e356623a92089001fa464da8f899fb645cd927e63eed002f6a06386257c8f2d`. The reviewed three-entry metadata derivative is `b49ef4b1780030c0251b8c42ebd3a99d3393a970555335c1f8dc5c0439454995`. Addresses below are static analysis coordinates, not permission or proof to call them.

| RVA        | Observation                               | Retained REA evidence                                                 |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------- |
| `0x8d9da0` | PLY reader and finalizer dispatch         | `ev_b573709f331f8fab516cb97763d833f1fb338b8093018e4284fb0436a6cb25ae` |
| `0x1de640` | Normal generation is unconditional        | `ev_e9996a5c0f06b73a2dd942203907a30969491fca8d468f3a96a4714a828f878e` |
| `0x1dd8d0` | Container enumeration and ordinal stores  | `ev_aee725bda886b18de688a75a5d5b24aadb23d4cccdbc6f1b4660a61d6e262c2b` |
| `0x1de5d0` | State-byte clear and bounds dispatch      | `ev_9a37aa50457d251fb0f39d27780068cd98bae3b6d7bf6612440c5359161696ca` |
| `0xb2f7e0` | Range/matrix descriptors and bounds merge | `ev_ccb9994c074da806ab02a9a324320638e8b59c51ecbcf9fc099a1f5d14512975` |
| `0x166530` | Return-true stub                          | `ev_a0e67cf657ef1a09dc93f22f27996124ceaf79369e24b1ce437f572e31a2731d` |

Full streaming comparison separately found exact Float32 XYZ and U32 triangle bytes between the original first/second PLY scans and all three stored geometry records in two historical backups. The second backup is cumulative. Four full pre/post file identities and SHA-256 hashes matched. There is no third-scan backup; producer binary/settings and prepared normals remain unverified.

The application already preserves authored scan buffers and derives command-local alignment normals. These observations do not change that behavior or close native three-scan acceptance. See [the original preparation boundary](ORIGINAL_ALIGNMENT_PREPARATION.md). Live imported geometry, post-finalizer normals, actual controller settings/order/clocks and final setter stages still require a bound runtime comparison.
