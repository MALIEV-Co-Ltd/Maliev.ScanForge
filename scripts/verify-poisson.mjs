import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const provenance = JSON.parse(
  await readFile(new URL("public/poisson/provenance.json", root), "utf8"),
);
assert.equal(
  provenance.upstream.commit,
  "262b0f539d404057d1f36e1adc07fc9388678899",
);
assert.equal(provenance.toolchain.emscripten, "6.0.13");
assert.equal(provenance.configuration.maxHeapBytes, 1073741824);
const expected = [
  "public/poisson/poisson.mjs",
  "public/poisson/poisson.wasm",
  "public/poisson/LICENSE.txt",
  "native/poisson/scanforge-poisson.cpp",
  "scripts/build-poisson.mjs",
];
assert.deepEqual(Object.keys(provenance.files).sort(), expected.slice().sort());
for (const path of expected) {
  assert.match(provenance.files[path], /^[a-f0-9]{64}$/);
  const actual = createHash("sha256")
    .update(await readFile(new URL(path, root)))
    .digest("hex");
  assert.equal(
    actual,
    provenance.files[path],
    `Poisson artifact/source mismatch:${path}. Rebuild with npm run build:poisson using the pinned source/toolchain.`,
  );
}
const notices = await readFile(
  new URL("public/poisson/LICENSE.txt", root),
  "utf8",
);
for (const required of [
  "Emscripten runtime notice: LICENSE",
  "musl runtime notice: system/lib/libc/musl/COPYRIGHT",
  "LLVM runtime notice: system/lib/libcxx/LICENSE.TXT",
  "LLVM runtime notice: system/lib/libcxxabi/LICENSE.TXT",
  "LLVM runtime notice: system/lib/compiler-rt/LICENSE.TXT",
  "LLVM runtime notice: system/lib/llvm-libc/LICENSE.TXT",
  "LLVM runtime notice: system/lib/libunwind/LICENSE.TXT",
  "Apache License",
  "LLVM Exceptions",
  "Rich Felker",
  "Doug Lea",
])
  assert(
    notices.includes(required),
    `Missing bundled Poisson runtime notice: ${required}`,
  );
console.log(
  JSON.stringify({
    passed: true,
    upstreamCommit: provenance.upstream.commit,
    wasmSha256: provenance.files["public/poisson/poisson.wasm"],
    verifiedFiles: expected.length,
    requiresEmsdk: false,
  }),
);
