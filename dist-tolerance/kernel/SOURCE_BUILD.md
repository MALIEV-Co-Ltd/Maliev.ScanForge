# CAD kernel source and rebuild information

Runtime binary: npm opencascade.js@1.1.1, copied without alteration.
SHA256: 6cc2f3fa1611d32ad7563f7092aa1bf58741124302630cef7d21561ecd7b7284

Binding source, patches, Dockerfile, make.py and upstream build instructions:
https://github.com/donalffons/opencascade.js/tree/v1.1.1
Source archive: https://github.com/donalffons/opencascade.js/archive/refs/tags/v1.1.1.tar.gz

Open CASCADE Technology V7_4_0p1 source:
https://github.com/Open-Cascade-SAS/OCCT/tree/33d9a6fa21ca4fa711da7066655aa2ba854545ee
Source archive: https://github.com/Open-Cascade-SAS/OCCT/archive/33d9a6fa21ca4fa711da7066655aa2ba854545ee.tar.gz

Upstream Dockerfile uses emscripten/emsdk:2.0.4. Its make.py downloads
FreeType VER-2-10-1, Fontconfig 2.13.92 and Regal master:
https://git.savannah.gnu.org/cgit/freetype/freetype2.git/tree/?h=VER-2-10-1
https://gitlab.freedesktop.org/fontconfig/fontconfig/-/tree/2.13.92
https://github.com/p3/regal

The upstream build does not pin Regal master; exact bit-for-bit reproduction
of that npm binary is therefore not asserted. The sources and upstream patches
allow rebuilding a compatible modified kernel. Keep replacement filenames and
the tested JavaScript API, then rerun the CAD smoke tests. This document provides
source provenance and rebuild information; it is not a complete corresponding
source bundle. Preserve the complete third-party notices when redistributing.
