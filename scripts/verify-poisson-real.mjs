import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { BufferGeometry, BufferAttribute } from "three";
import createPoisson from "../public/poisson/poisson.mjs";
import { normalizePoissonMesh } from "../src/poisson-mesh-cleanup.ts";
const args = Object.fromEntries(
  Array.from({ length: (process.argv.length - 2) / 2 }, (_, i) => [
    process.argv[i * 2 + 2],
    process.argv[i * 2 + 3],
  ]),
);
assert(
  args["--source"] &&
    args["--normals"] &&
    args["--normal-receipt"] &&
    args["--out"],
  "Required: --source original.ply --normals estimated.f32 --normal-receipt receipt.json --out directory [--depth 8]",
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = await readFile(args["--source"]),
  normalBytes = await readFile(args["--normals"]),
  normalReceiptBytes = await readFile(args["--normal-receipt"]),
  normalReceipt = JSON.parse(normalReceiptBytes);
assert.equal(
  hash(source),
  normalReceipt.sourceSha256,
  "Source scan hash mismatch",
);
assert.equal(
  hash(normalBytes),
  normalReceipt.outputNormalsSha256,
  "Estimated normals hash mismatch",
);
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
assert.equal(positions.length / 3, normalReceipt.diagnostics.pointCount);
const depth = Number(args["--depth"] ?? 8);
assert(Number.isInteger(depth) && depth >= 6 && depth <= 10);
const densityThreshold = Number(args["--density-threshold"] ?? 0);
assert(
  [0, 4, 5, 6, 7, 8].includes(densityThreshold),
  "Use the recorded density candidates 0,4,5,6,7,8; quality acceptance gates remain fixed.",
);
const stem = `ply-1-depth${depth}-density${densityThreshold}-native-normalized`;
const settings = {
  normalMode: "estimate-provided",
  normalNeighbors: 24,
  depth,
  pointWeight: 2,
  samplesPerNode: 1.5,
  densityThreshold,
  femDegree: 2,
  boundary: "Neumann",
  scale: 1.1,
  threads: 1,
};
const warnings = [],
  module = await createPoisson({
    print: () => {},
    printErr: (text) => {
      if (warnings.length < 30) warnings.push(text);
    },
  }),
  p = module._malloc(positions.byteLength),
  n = module._malloc(normals.byteLength);
assert(p && n);
module.HEAPF32.set(positions, p / 4);
// Match the application wrapper's final Float32 assignment after unit normalization.
for (let i = 0; i < normals.length; i += 3) {
  const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
  for (let a = 0; a < 3; a++)
    module.HEAPF32[n / 4 + i + a] = normals[i + a] / length;
}
const nativeNormalSha256 = hash(
  new Uint8Array(module.HEAPF32.buffer, n, normals.byteLength),
);
const out = resolve(args["--out"]);
await mkdir(out, { recursive: true });
const started = performance.now();
try {
  const solved = module._sf_poisson_reconstruct(
    p,
    n,
    positions.length / 3,
    settings.depth,
    settings.pointWeight,
    settings.samplesPerNode,
  );
  assert(solved, module.UTF8ToString(module._sf_poisson_error()));
  let nv = module._sf_poisson_vertex_count(),
    nt = module._sf_poisson_triangle_count(),
    vertices = module.HEAPF32.slice(
      module._sf_poisson_vertices() / 4,
      module._sf_poisson_vertices() / 4 + nv * 3,
    ),
    triangles = module.HEAPU32.slice(
      module._sf_poisson_triangles() / 4,
      module._sf_poisson_triangles() / 4 + nt * 3,
    ),
    density = module.HEAPF32.slice(
      module._sf_poisson_density() / 4,
      module._sf_poisson_density() / 4 + nv,
    );
  assert(
    vertices.every(Number.isFinite) &&
      density.every(Number.isFinite) &&
      triangles.every((i) => i < nv),
  );
  const reconstructed = new BufferGeometry();
  const untrimmedVertices = nv,
    untrimmedTriangles = nt;
  const normalized = normalizePoissonMesh(
    vertices,
    triangles,
    density,
    densityThreshold,
  );
  vertices = normalized.vertices;
  triangles = normalized.triangles;
  density = normalized.density;
  nv = vertices.length / 3;
  nt = triangles.length / 3;
  reconstructed.setAttribute("position", new BufferAttribute(vertices, 3));
  reconstructed.setIndex(new BufferAttribute(triangles, 1));
  reconstructed.computeVertexNormals();
  const vertexNormals = reconstructed.attributes.normal.array;
  const header = Buffer.from(
      `ply\nformat binary_little_endian 1.0\ncomment Actual upstream PoissonRecon WASM, all original source points\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty float density\nelement face ${nt}\nproperty list uchar int vertex_indices\nend_header\n`,
    ),
    body = Buffer.alloc(nv * 28 + nt * 13);
  let offset = 0;
  for (let i = 0; i < nv; i++) {
    for (let a = 0; a < 3; a++) {
      body.writeFloatLE(vertices[i * 3 + a], offset);
      offset += 4;
    }
    for (let a = 0; a < 3; a++) {
      body.writeFloatLE(vertexNormals[i * 3 + a], offset);
      offset += 4;
    }
    body.writeFloatLE(density[i], offset);
    offset += 4;
  }
  for (let i = 0; i < nt; i++) {
    body.writeUInt8(3, offset++);
    for (let a = 0; a < 3; a++) {
      body.writeUInt32LE(triangles[i * 3 + a], offset);
      offset += 4;
    }
  }
  const meshBytes = Buffer.concat([header, body]),
    meshPath = join(out, `${stem}-mesh.ply`);
  await writeFile(meshPath, meshBytes);
  await writeFile(
    join(out, `${stem}-mesh.json`),
    JSON.stringify({
      vertices: Array.from(vertices),
      triangles: Array.from(triangles),
      density: Array.from(density),
    }) + "\n",
  );
  const result = {
    scope:
      "Actual compiled upstream screened PoissonRecon WASM, full owner PLY1 input, no point dropping and no decimation; explicit density trimming only when the threshold is positive. Node execution separate from browser GUI/MCP validation.",
    sourcePath: args["--source"],
    sourceSha256: hash(source),
    sourcePointCount: positions.length / 3,
    normalReceiptSha256: hash(normalReceiptBytes),
    estimatedNormalsSha256: hash(normalBytes),
    nativeNormalSha256,
    wasmSha256: hash(
      await readFile(
        new URL("../public/poisson/poisson.wasm", import.meta.url),
      ),
    ),
    loaderSha256: hash(
      await readFile(new URL("../public/poisson/poisson.mjs", import.meta.url)),
    ),
    harnessSha256: hash(await readFile(new URL(import.meta.url))),
    meshPath,
    meshSha256: hash(meshBytes),
    settings,
    vertices: nv,
    triangles: nt,
    untrimmedVertices,
    untrimmedTriangles,
    removedDegenerateTriangles: normalized.removedDegenerateTriangles,
    mergedVertices: normalized.mergedVertices,
    removedDuplicateTriangles: normalized.removedDuplicateTriangles,
    trimmedTriangles: normalized.trimmedTriangles,
    normalizerSha256: hash(
      await readFile(
        new URL("../src/poisson-mesh-cleanup.ts", import.meta.url),
      ),
    ),
    elapsedMs: performance.now() - started,
    wasmHeapBytes: module.HEAPF32.buffer.byteLength,
    density: {
      minimum: density.reduce((a, b) => Math.min(a, b), Infinity),
      maximum: density.reduce((a, b) => Math.max(a, b), -Infinity),
    },
    warnings,
  };
  await writeFile(
    join(out, `${stem}-run.json`),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  reconstructed.dispose();
} finally {
  module._free(p);
  module._free(n);
  module._sf_poisson_clear();
  geometry.dispose();
}
