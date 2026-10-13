# Third-party notices

ScanForge makes use of facilities provided by Open CASCADE Technology. Its independently authored source is MIT licensed; third-party components are not relicensed.

| Component                   | License                                         | Source                                                   |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Three.js                    | MIT                                             | https://github.com/mrdoob/three.js                       |
| three-mesh-bvh 0.9.16       | MIT                                             | https://github.com/gkjohnson/three-mesh-bvh              |
| React / React DOM           | MIT                                             | https://github.com/facebook/react                        |
| Lucide                      | ISC                                             | https://github.com/lucide-icons/lucide                   |
| tinykeys 4.0.1              | MIT                                             | https://github.com/jamiebuilds/tinykeys                  |
| OpenCascade.js 1.1.1        | LGPL-2.1-only                                   | https://github.com/donalffons/opencascade.js/tree/v1.1.1 |
| Open CASCADE Technology     | LGPL-2.1 with OCCT exception                    | https://github.com/Open-Cascade-SAS/OCCT                 |
| FreeType, Fontconfig, Regal | Upstream license terms; see provenance document | See docs/CAD_DISTRIBUTION.md                             |

The pinned CAD package contains generated binary artifacts. `scripts/prepare-kernel.mjs` copies its full LGPL license and retains provenance. It changes only the generated glue module's export wrapper for classic-worker loading. The library remains a replaceable local JS/WASM component. Source/build references and unresolved transitive build provenance are in [CAD distribution](docs/CAD_DISTRIBUTION.md). This notice does not certify binary distribution compliance.

Other package license files remain in `node_modules` after installation. `package-lock.json` records exact package resolutions and integrity hashes. Keep required license texts with distributions.
