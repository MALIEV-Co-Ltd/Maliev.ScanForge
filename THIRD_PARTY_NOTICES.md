# Third-party notices

The optional 3Dconnexion driver integration includes the proprietary, royalty-free
3DconnexionJS 0.8.1 minified runtime from 3DxWare SDK 4.0.6. Its separate
[license](public/vendor/3dconnexion/LICENSE.txt) and
[dependency notices and transport amendments](public/vendor/3dconnexion/NOTICE.txt)
apply. 3D input device development tools and related technology are provided under
license from 3Dconnexion. © 3Dconnexion 1992 - 2025. All rights reserved.

ScanForge makes use of facilities provided by Open CASCADE Technology. Current covered ScanForge code uses the [ScanForge Source-Available License](LICENSE). Previously MIT-licensed ScanForge versions and portions retain their original permissions and [historical notice](docs/licenses/SCANFORGE_PREVIOUS_MIT.txt). Third-party components are not relicensed.

| Component                   | License                                         | Source                                                   |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Three.js                    | MIT                                             | https://github.com/mrdoob/three.js                       |
| three-mesh-bvh 0.9.16       | MIT                                             | https://github.com/gkjohnson/three-mesh-bvh              |
| @noble/hashes 2.4.0         | MIT                                             | https://github.com/paulmillr/noble-hashes                |
| html-to-image 1.11.13       | MIT                                             | https://github.com/bubkoo/html-to-image                  |
| React / React DOM           | MIT                                             | https://github.com/facebook/react                        |
| Lucide                      | ISC                                             | https://github.com/lucide-icons/lucide                   |
| tinykeys 4.0.1              | MIT                                             | https://github.com/jamiebuilds/tinykeys                  |
| OpenCascade.js 1.1.1        | LGPL-2.1-only                                   | https://github.com/donalffons/opencascade.js/tree/v1.1.1 |
| Open CASCADE Technology     | LGPL-2.1 with OCCT exception                    | https://github.com/Open-Cascade-SAS/OCCT                 |
| FreeType, Fontconfig, Regal | Upstream license terms; see provenance document | See docs/CAD_DISTRIBUTION.md                             |

The pinned CAD package contains generated binary artifacts. `scripts/prepare-kernel.mjs` copies its full LGPL license and retains provenance. It changes only the generated glue module's export wrapper for classic-worker loading. The library remains a replaceable local JS/WASM component. Source/build references and unresolved transitive build provenance are in [CAD distribution](docs/CAD_DISTRIBUTION.md). This notice does not certify binary distribution compliance.

Other package license files remain in `node_modules` after installation. `package-lock.json` records exact package resolutions and integrity hashes. Keep required license texts with distributions.
