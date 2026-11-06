import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const commit = "262b0f539d404057d1f36e1adc07fc9388678899",
  sdkVersion = "6.0.13";
const source = resolve(
  process.env.SCANFORGE_POISSON_SOURCE ??
    join(root, ".resources/poisson-upstream"),
);
const sdk = resolve(process.env.SCANFORGE_EMSDK ?? "C:/tools/emsdk-scanforge");
const output = join(root, "public/poisson"),
  evidence = join(root, "docs/evidence/cloudcompare-20261029/poisson");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw Error(
      `${command} failed: ${result.error ?? result.stderr ?? result.stdout}`,
    );
  return result.stdout;
};
try {
  await access(join(source, ".git"));
} catch {
  await mkdir(resolve(source, ".."), { recursive: true });
  run("git", ["clone", "https://github.com/mkazhdan/PoissonRecon.git", source]);
  run("git", ["-C", source, "checkout", "--detach", commit]);
}
if (run("git", ["-C", source, "rev-parse", "HEAD"]).trim() !== commit)
  throw Error("Poisson upstream checkout does not match pinned commit.");
const original = (path) =>
  run("git", ["-C", source, "show", `${commit}:${path}`]);
const nested = original("Src/NestedVector.h");
if (!nested.includes("unsigned int LogSize=20"))
  throw Error("Pinned NestedVector patch anchor changed.");
await writeFile(
  join(source, "Src/NestedVector.h"),
  nested.replace("unsigned int LogSize=20", "unsigned int LogSize=15"),
);
const threading = original("Src/MultiThreading.h"),
  anchor = /^(\t{3})std::vector< std::future< void > > futures;/gm;
if ([...threading.matchAll(anchor)].length !== 2)
  throw Error("Pinned serial-sections patch anchors changed.");
await writeFile(
  join(source, "Src/MultiThreading.h"),
  threading.replace(
    anchor,
    "$1if( ParallelizationType==ParallelType::NONE ){ function(); ( functions() , ... ); return; }\n$1std::vector< std::future< void > > futures;",
  ),
);
await mkdir(output, { recursive: true });
await mkdir(evidence, { recursive: true });
const compiler = join(sdk, "upstream/emscripten/em++.py");
const version = run(process.env.PYTHON ?? "python", [compiler, "--version"]);
if (!version.includes(sdkVersion))
  throw Error(`Expected Emscripten ${sdkVersion}: ${version}`);
const args = [
  compiler,
  join(root, "native/poisson/scanforge-poisson.cpp"),
  "-I",
  join(source, "Src"),
  "-std=c++17",
  "-O2",
  "-fexceptions",
  "-Wno-dangling-else",
  `-ffile-prefix-map=${source}=poisson-upstream`,
  `-ffile-prefix-map=${root}=scanforge`,
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sENVIRONMENT=web,worker,node",
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=67108864",
  "-sMAXIMUM_MEMORY=1073741824",
  "-sSTACK_SIZE=8388608",
  "-sABORTING_MALLOC=0",
  "-sDISABLE_EXCEPTION_CATCHING=0",
  "-sEXPORTED_FUNCTIONS=_malloc,_free",
  "-sEXPORTED_RUNTIME_METHODS=HEAPF32,HEAPU32,UTF8ToString",
  "-sFILESYSTEM=0",
  "-o",
  join(output, "poisson.mjs"),
];
// Keep strict aliasing and standard floating-point semantics; no fast-math flags.
const built = spawnSync(process.env.PYTHON ?? "python", args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
await writeFile(
  join(evidence, "compile.log"),
  `${built.stdout ?? ""}${built.stderr ?? ""}`,
);
if (built.error || built.status !== 0)
  throw Error(
    `Poisson WASM compilation failed; see ${join(evidence, "compile.log")}: ${built.error ?? built.status}`,
  );
const notices = new Set();
for (const name of await readdir(join(source, "Src")))
  if (/\.(h|inl|cpp)$/.test(name)) {
    const text = await readFile(join(source, "Src", name), "utf8"),
      block = text.match(/^\/\*[\s\S]*?\*\//)?.[0];
    if (block?.includes("Copyright") && block.includes("Redistribution"))
      notices.add(block);
  }
const runtimeNoticeSources = {};
const runtimeSections = [];
for (const [label, relative] of [
  ["Emscripten", "LICENSE"],
  ["musl", "system/lib/libc/musl/COPYRIGHT"],
  ["LLVM", "system/lib/libcxx/LICENSE.TXT"],
  ["LLVM", "system/lib/libcxxabi/LICENSE.TXT"],
  ["LLVM", "system/lib/compiler-rt/LICENSE.TXT"],
  ["LLVM", "system/lib/llvm-libc/LICENSE.TXT"],
  ["LLVM", "system/lib/libunwind/LICENSE.TXT"],
]) {
  const bytes = await readFile(join(sdk, "upstream/emscripten", relative));
  runtimeNoticeSources[relative] = createHash("sha256")
    .update(bytes)
    .digest("hex");
  runtimeSections.push(
    `${label} runtime notice: ${relative}\n\n${bytes.toString("utf8")}`,
  );
}
// Retain musl's additional per-file permissive notices, including math and qsort.
const muslNotices = new Set();
async function collectMuslNotices(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectMuslNotices(path);
    else if (/\.(c|h|S)$/.test(entry.name)) {
      const text = await readFile(path, "utf8");
      for (const match of text.matchAll(/\/\*[\s\S]*?\*\//g))
        if (
          /copyright/i.test(match[0]) &&
          /permission|license|redistribution|rights reserved/i.test(match[0])
        )
          muslNotices.add(match[0]);
    }
  }
}
await collectMuslNotices(
  join(sdk, "upstream/emscripten/system/lib/libc/musl/src"),
);
const allocator = await readFile(
  join(sdk, "upstream/emscripten/system/lib/dlmalloc.c"),
  "utf8",
);
const allocatorNotice = allocator.match(
  /This is a version[\s\S]*? \* Version[^\r\n]*/,
)?.[0];
if (!allocatorNotice?.includes("Doug Lea"))
  throw Error("Pinned allocator notice anchor changed.");
await writeFile(
  join(output, "LICENSE.txt"),
  `${await readFile(join(source, "LICENSE"), "utf8")}\n\nRetained upstream source notices:\n\n${[...notices].join("\n\n")}\n\nBundled toolchain runtime notices (Emscripten ${sdkVersion}):\n\n${runtimeSections.join("\n\n")}\n\nAdditional musl source notices:\n\n${[...muslNotices].join("\n\n")}\n\nAllocator provenance excerpt: system/lib/dlmalloc.c\n\n${allocatorNotice}\n`,
);
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const files = {};
for (const name of ["poisson.mjs", "poisson.wasm", "LICENSE.txt"])
  files[`public/poisson/${name}`] = await hash(join(output, name));
for (const name of [
  "native/poisson/scanforge-poisson.cpp",
  "scripts/build-poisson.mjs",
])
  files[name] = await hash(join(root, name));
const provenance = {
  upstream: {
    url: "https://github.com/mkazhdan/PoissonRecon",
    commit,
    version: "18.76",
    licenses: "MIT root license and retained BSD-style source notices",
  },
  toolchain: {
    emscripten: sdkVersion,
    version: version.split(/\r?\n/)[0],
    runtimeNoticeSources,
  },
  patches: [
    "NestedVector default LogSize20->15 so Depth1 maximum uses30 bits instead of invalid40-bit wasm32 shift.",
    "ThreadPool::ParallelSections honors NONE by running all sections serially; no pthread creation.",
  ],
  configuration: {
    femDegree: 2,
    boundary: "Neumann",
    floatType: "float32",
    maxHeapBytes: 1073741824,
    maxInputPoints: 500000,
    maxOutputVertices: 2000000,
    maxOutputTriangles: 4000000,
    initialHeapBytes: 67108864,
    stackBytes: 8388608,
  },
  files,
};
await writeFile(
  join(output, "provenance.json"),
  JSON.stringify(provenance, null, 2) + "\n",
);
await writeFile(
  join(evidence, "build-provenance.json"),
  JSON.stringify(
    {
      ...provenance,
      command: process.env.PYTHON ?? "python",
      arguments: args,
      sourcePath: source,
      sdkPath: sdk,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(provenance));
