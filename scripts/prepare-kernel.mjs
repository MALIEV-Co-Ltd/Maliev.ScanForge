import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { build } from "vite";

const root = new URL("../", import.meta.url);
const source = new URL("node_modules/opencascade.js/", root);
const destination = new URL("public/kernel/", root);
await mkdir(destination, { recursive: true });
const metadata = JSON.parse(
  await readFile(new URL("package.json", source), "utf8"),
);
if (metadata.version !== "1.1.1")
  throw new Error(
    "The CAD worker requires the tested OpenCascade.js 1.1.1 bindings.",
  );
const glue = await readFile(
  new URL("dist/opencascade.wasm.js", source),
  "utf8",
);
if (!/export default opencascade;\s*$/.test(glue))
  throw new Error("Unexpected OpenCascade.js module wrapper.");
// Preserve upstream glue and adapt only its ES-module export for importScripts.
await writeFile(
  new URL("opencascade.js", destination),
  glue.replace(/export default opencascade;\s*$/, ""),
);
await copyFile(
  new URL("dist/opencascade.wasm.wasm", source),
  new URL("opencascade.wasm.wasm", destination),
);
await copyFile(
  new URL("LICENSE", source),
  new URL("LICENSE.opencascade.js.txt", destination),
);
await writeFile(
  new URL("NOTICE.txt", destination),
  "OpenCascade.js 1.1.1: LGPL-2.1-only.\nSource: https://github.com/donalffons/opencascade.js/tree/v1.1.1\nThis application uses Open CASCADE Technology facilities.\nGenerated JavaScript changes: ES module export removed for classic-worker loading; WASM binary unchanged.\nOpen CASCADE Technology V7_4_0p1: LGPL2.1 with Open CASCADE exception.\nSource: https://github.com/Open-Cascade-SAS/OCCT/tree/33d9a6fa21ca4fa711da7066655aa2ba854545ee\nThe upstream build also references FreeType2.10.1, Fontconfig2.13.92 and Regal. See SOURCE_BUILD.md and the application third-party notices.\nReplace these local JavaScript/WASM assets to use a compatible modified kernel.\n",
);
await cp(new URL("docs/licenses/", root), new URL("licenses/", destination), {
  recursive: true,
});
await copyFile(
  new URL("docs/CAD_DISTRIBUTION.md", root),
  new URL("CAD_DISTRIBUTION.md", destination),
);
const wasm = await readFile(new URL("dist/opencascade.wasm.wasm", source));
const hash = createHash("sha256").update(wasm).digest("hex");
await writeFile(
  new URL("SOURCE_BUILD.md", destination),
  `# CAD kernel source and rebuild information

Runtime binary: npm opencascade.js@1.1.1, copied without alteration.
SHA256: ${hash}

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
`,
);
// Compile the shared TypeScript backend and numeric helpers for the classic
// worker. Keep one implementation; no manually copied worker arithmetic.
await build({
  configFile: false,
  root: fileURLToPath(root),
  publicDir: false,
  build: {
    target: "es2022",
    outDir: fileURLToPath(destination),
    emptyOutDir: false,
    copyPublicDir: false,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("src/cad/sketch-backend.ts", root)),
      name: "ScanForgeSketchBackend",
      formats: ["iife"],
      fileName: () => "sketch-backend.js",
    },
  },
});
console.log(`Local CAD kernel prepared at ${fileURLToPath(destination)}`);
