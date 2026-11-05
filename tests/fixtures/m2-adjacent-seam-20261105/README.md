# Adjacent cutter seam native control

The source and cutter binary STL files are manufactured inputs. Import both
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
retains both; the native observation is recorded below.

## Native observation, 2026-11-05

QUICKSURFACE Pro 8.0.123 imported both meshes in millimetres. The source was
selected for Edit, then Split Mesh used `cutter`, with "Split with another body
or a mesh" selected and Envelope unchecked. Preview and OK completed without a
visible warning. The resulting source was shown as three triangles and two
individual meshes. With the cutter hidden, Export Visible produced
`native-result.stl`, SHA-256
`dc295b159937de3fbffc20cf3ff2369c61758ca64df953af2e085d86af15abfe`.
Its three facets have total area 0.5 and contain the source-edge contact but
not the adjacent contact. The application operation retains both contacts and
produces five triangles with the same total area and two parts; this is a
native triangulation difference, not proof of a coverage difference.

The untouched imported cutter was exported separately with the source hidden.
Its two triangles retained the one-Float32-step coordinate; that round-trip
export has SHA-256
`e1646adc3b78c37dd93e9d863a316516ea405deb5b637f18a6e2439002da9963`.
This verifies that the cutter coordinates survived native import and export.
The observation is limited to this manufactured fixture and does not resolve
other known native Split discrepancies or establish general parity.
