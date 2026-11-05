# Adjacent cutter seam native control

These binary STL files are manufactured inputs, not native outputs. Import both
in millimetres with origin placement disabled, verify their positions and
orientation, then split `source.stl` with `cutter.stl` as a mesh using the same
native settings as the other Split controls. Record the native version, import
settings, observed object selection and any warnings. Export the result and
record its SHA-256 before comparing unordered facets, winding, coverage and
seam points. Record whether native import itself preserves the two coordinates.

| Input        | Facets | SHA-256                                                            |
| ------------ | -----: | ------------------------------------------------------------------ |
| `source.stl` |      1 | `1ccb1730b3806d6eee50ee56c1fb602ae0a377efeabbccebf9c71d05fd8049e5` |
| `cutter.stl` |      2 | `17eb1e2487abf4b70e12ef29a10aadf88217e2486efbbe5c91ca30feeb52f9cb` |

The source-edge contact is `[0.5, 1, 0]`; the adjacent cutter faces share an
edge producing the distinct contact `[0.5, 1.0000001192092896, 0]`. Their Y
coordinates differ by one Float32 step. The shared application operation
retains both; this does not predict native behavior.
