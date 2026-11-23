# Third-party notices

The optional 3Dconnexion driver integration includes the proprietary, royalty-free
3DconnexionJS 0.8.1 minified runtime from 3DxWare SDK 4.0.6. Its separate
[license](public/vendor/3dconnexion/LICENSE.txt) and
[dependency notices and transport amendments](public/vendor/3dconnexion/NOTICE.txt)
apply. 3D input device development tools and related technology are provided under
license from 3Dconnexion. © 3Dconnexion 1992 - 2025. All rights reserved.

ScanForge makes use of facilities provided by Open CASCADE Technology. Current covered ScanForge code uses the [ScanForge Source-Available License](LICENSE). Previously MIT-licensed ScanForge versions and portions retain their original permissions and [historical notice](docs/licenses/SCANFORGE_PREVIOUS_MIT.txt). Third-party components are not relicensed.

| Component                   | License                                         | Source                                                                                 |
| --------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Three.js                    | MIT                                             | https://github.com/mrdoob/three.js                                                     |
| three-mesh-bvh 0.9.16       | MIT                                             | https://github.com/gkjohnson/three-mesh-bvh                                            |
| @noble/hashes 2.4.0         | MIT                                             | https://github.com/paulmillr/noble-hashes                                              |
| html-to-image 1.11.13       | MIT                                             | https://github.com/bubkoo/html-to-image                                                |
| React / React DOM           | MIT                                             | https://github.com/facebook/react                                                      |
| Lucide                      | ISC                                             | https://github.com/lucide-icons/lucide                                                 |
| tinykeys 4.0.1              | MIT                                             | https://github.com/jamiebuilds/tinykeys                                                |
| Delaunator 5.1.0            | ISC                                             | https://github.com/mapbox/delaunator                                                   |
| robust-predicates 3.0.3     | Unlicense                                       | https://github.com/mourner/robust-predicates                                           |
| PoissonRecon 18.76          | MIT and retained BSD-style source notices       | https://github.com/mkazhdan/PoissonRecon/tree/262b0f539d404057d1f36e1adc07fc9388678899 |
| OpenCascade.js 1.1.1        | LGPL-2.1-only                                   | https://github.com/donalffons/opencascade.js/tree/v1.1.1                               |
| Open CASCADE Technology     | LGPL-2.1 with OCCT exception                    | https://github.com/Open-Cascade-SAS/OCCT                                               |
| FreeType, Fontconfig, Regal | Upstream license terms; see provenance document | See docs/CAD_DISTRIBUTION.md                                                           |

The pinned CAD package contains generated binary artifacts. `scripts/prepare-kernel.mjs` copies its full LGPL license and retains provenance. It changes only the generated glue module's export wrapper for classic-worker loading. The library remains a replaceable local JS/WASM component. Source/build references and unresolved transitive build provenance are in [CAD distribution](docs/CAD_DISTRIBUTION.md). This notice does not certify binary distribution compliance.

Other package license files remain in `node_modules` after installation. `package-lock.json` records exact package resolutions and integrity hashes. Keep required license texts with distributions.

Projected point-cloud triangulation includes [Delaunator's copyright and ISC
permission notice](public/licenses/delaunator-5.1.0.txt) and the
[robust-predicates public-domain dedication](public/licenses/robust-predicates-3.0.3.txt).
These files are copied into production distributions as static assets.
CloudCompare is an external GPL-licensed investigation target; no CloudCompare
implementation is copied into or linked by ScanForge.

General 3D Poisson reconstruction includes independent upstream PoissonRecon
compiled to WebAssembly. Its [retained copyright and license notices](public/poisson/LICENSE.txt),
[pinned build provenance](public/poisson/provenance.json), native adapter and
[reproducible build instructions](docs/POISSON_BROWSER_ENGINE.md) accompany the
replaceable local JS/WASM component. Ordinary production builds verify the
recorded artifact hashes and include the license/provenance as static assets.
