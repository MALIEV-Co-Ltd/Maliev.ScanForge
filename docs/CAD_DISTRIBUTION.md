# CAD kernel provenance and distribution status

The authored application source depends on npm `opencascade.js@1.1.1`.
Generated JavaScript/WASM files are ignored by Git. The preparation script copies
the npm binary locally and removes its JavaScript ES-module export so it can load
inside a classic browser worker. It does not modify the WASM binary. Runtime CAD
operations use local assets and do not contact these source websites.

OpenCascade.js is licensed under LGPL 2.1. Its source, binding generator, patches,
Dockerfile and build instructions are available at the verified
[v1.1.1 tag](https://github.com/donalffons/opencascade.js/tree/v1.1.1).
The npm package's complete LGPL text is copied to
`public/kernel/LICENSE.opencascade.js.txt` by the preparation script.

The upstream build uses Open CASCADE Technology V7_4_0p1 at commit
`33d9a6fa21ca4fa711da7066655aa2ba854545ee`.
[Corresponding OCCT source](https://github.com/Open-Cascade-SAS/OCCT/tree/33d9a6fa21ca4fa711da7066655aa2ba854545ee)
is licensed under LGPL 2.1 with the Open CASCADE exception. This application uses
facilities provided by Open CASCADE Technology. The complete exception is retained
in [licenses/OCCT_LGPL_EXCEPTION.txt](licenses/OCCT_LGPL_EXCEPTION.txt).

The upstream `make.py` also downloads FreeType 2.10.1, Fontconfig 2.13.92 and
Regal's unpinned `master`. Its Dockerfile selects `emscripten/emsdk:2.0.4`.
The complete main license texts and copyright notices retrieved from the matching
FreeType and Fontconfig tags are preserved here:

- [FreeType license selection and component notices](licenses/FREETYPE_LICENSE.txt)
- [FreeType Project License](licenses/FREETYPE_FTL.txt)
- [Fontconfig copyright and license](licenses/FONTCONFIG_COPYING.txt)
- [FreeType BDF component notices](licenses/FREETYPE_BDF_README.txt)
- [FreeType PCF component notices](licenses/FREETYPE_PCF_README.txt)
- [FreeType bundled zlib license](licenses/FREETYPE_ZLIB_LICENSE.txt)

This software is based in part on the work of the FreeType Team. FreeType is used
under the FreeType Project License. Portions of the kernel build use FreeType;
the FreeType Project and its contributors retain their copyrights. Consult the
FreeType license-selection document for the BDF/PCF and gzip component notices.

The original `p3/regal` GitHub repository returned HTTP 404 during this audit.
Google's mirror of that repository remains accessible. Complete Regal and Khronos
header license blocks plus its upstream README were preserved from mirror commit
`184c62b7d7761481609ef1c1484ada659ae181b9`:

- [Regal header license](licenses/REGAL_HEADER_LICENSE.txt)
- [Khronos GLES2 header license](licenses/REGAL_KHRONOS_HEADER_LICENSE.txt)
- [Regal README and third-party acknowledgments](licenses/REGAL_README.rst)

That mirror commit is a reference used to preserve notices, **not** evidence of
the Regal revision used to produce the npm binary. The exact Regal revision
remains unknown. Its README describes additional dependencies; it does not prove
which were linked into this CAD binary. The upstream CAD build references Regal's
Khronos headers. No claim is made that all potential binary components have been
identified or that these reference notices establish complete binary provenance.

[licenses/SOURCES.json](licenses/SOURCES.json) records the exact retrieval URLs
and SHA256 hashes. Header license blocks were extracted without changing their
text; complete license documents and the Regal README were retained. Generated
kernel assets include copies of these notices and `SOURCE_BUILD.md`, including
the npm WASM SHA256 and source/rebuild paths. These documents are provenance
records, not a complete corresponding-source bundle or a blanket clearance for
binary distribution.

Before distributing a hosted build, downloadable bundle or CI build artifact,
resolve the exact binary dependency/source inventory and provide the applicable
complete notices and LGPL corresponding-source/relinking access. Do not label the
current npm binary as fully cleared for redistribution. Repository source
publication and local development do not establish that separate binary-release
gate. Until resolved, omit built-kernel artifact publication and browser deployment.

For a rebuild, use the upstream tagged Dockerfile and build instructions, preserve
the OCCT patches and pin every dependency, including Regal or replacement Khronos
headers, to a recorded commit. Preserve all dependency licenses with that rebuilt
kernel. Replacing the JavaScript/WASM is supported: put the compatible modified
distribution in `node_modules/opencascade.js/dist/`, preserving tested binding
names and the distribution filenames, then run `npm run prepare:kernel` and
`node --max-old-space-size=768 tests/kernel-smoke.mjs`. Build preparation copies
these distribution inputs each time, so replacing only generated `public/kernel`
files before a build will be overwritten. Record modifications and hashes and
retain the appropriate license and source access with the replacement.
The smoke tests verify imported CAD, modeled solids and exact BREP persistence;
they do not certify distribution rights.
