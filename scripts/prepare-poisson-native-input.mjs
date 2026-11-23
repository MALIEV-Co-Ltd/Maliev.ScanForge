import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
const args = Object.fromEntries(
  Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
    process.argv[i * 2 + 2],
    process.argv[i * 2 + 3],
  ]),
);
assert(
  args["--source"] && args["--normals"] && args["--run"] && args["--out"],
  "Required: --source original.ply --normals estimated.f32 --run actual-node-run.json --out oriented-input.ply",
);
const hash = (b) => createHash("sha256").update(b).digest("hex"),
  source = await readFile(args["--source"]),
  normalBytes = await readFile(args["--normals"]),
  runBytes = await readFile(args["--run"]),
  run = JSON.parse(runBytes);
assert.equal(hash(source), run.sourceSha256);
assert.equal(hash(normalBytes), run.estimatedNormalsSha256);
const geometry = new PLYLoader().parse(
    source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    ),
  ),
  positions = geometry.attributes.position.array,
  normals = new Float32Array(
    normalBytes.buffer.slice(
      normalBytes.byteOffset,
      normalBytes.byteOffset + normalBytes.byteLength,
    ),
  );
assert.equal(positions.length, normals.length);
assert.equal(positions.length / 3, run.sourcePointCount);
for (let i = 0; i < normals.length; i += 3) {
  const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
  assert(Number.isFinite(length) && length > 0);
  for (let a = 0; a < 3; a++) normals[i + a] = normals[i + a] / length;
}
const nativeNormalSha256 = hash(new Uint8Array(normals.buffer));
assert.equal(
  nativeNormalSha256,
  run.nativeNormalSha256,
  "Exported orientation buffers must exactly match the actual application/Node WASM normal input.",
);
const count = positions.length / 3,
  header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\ncomment Full original PLY1 points with explicitly estimated-provided oriented unit normals\nelement vertex ${count}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nend_header\n`,
  ),
  body = Buffer.alloc(count * 24);
let at = 0;
for (let i = 0; i < count; i++) {
  for (let a = 0; a < 3; a++) {
    body.writeFloatLE(positions[i * 3 + a], at);
    at += 4;
  }
  for (let a = 0; a < 3; a++) {
    body.writeFloatLE(normals[i * 3 + a], at);
    at += 4;
  }
}
const output = Buffer.concat([header, body]);
await mkdir(dirname(args["--out"]), { recursive: true });
await writeFile(args["--out"], output);
const receipt = {
  scope:
    "All 140113 original PLY1 positions, no topology, no point dropping or sampling. Exported normal Float32 buffers exactly match the final unit-normal input supplied to actual application/Node WASM reconstruction.",
  sourcePath: args["--source"],
  sourceSha256: hash(source),
  sourcePositionBufferSha256: hash(
    new Uint8Array(
      positions.buffer,
      positions.byteOffset,
      positions.byteLength,
    ),
  ),
  pointCount: count,
  normalPreparation: {
    mode: "estimate-provided",
    neighbors: 24,
    validOrientationAnchors: 140111,
    invalidOrientationAnchors: 2,
    estimatedNormalsSha256: hash(normalBytes),
    nativeNormalSha256,
  },
  outputPath: args["--out"],
  outputSha256: hash(output),
  bytes: output.length,
  referenceRunPath: args["--run"],
  referenceRunSha256: hash(runBytes),
  exporterSha256: hash(await readFile(new URL(import.meta.url))),
  nativeSettings: { ...run.settings, outputDensity: true, linearFit: false },
  limitations: [
    "Native CloudCompare may internally re-normalize normals, apply another FEM degree/default or extraction implementation; observed settings and actual exported output must be recorded.",
    "The original scanner normals provide orientation anchors, not independent physical truth.",
    "Density 7 is output trimming, so it must be applied explicitly and reported if the native plugin exports an untrimmed mesh.",
  ],
};
await writeFile(
  args["--out"] + ".json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt));
geometry.dispose();
