import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "vite";
import { resolve } from "node:path";
import { PLYLoader } from "three/addons/loaders/PLYLoader.js";
import { BufferGeometry, BufferAttribute } from "three";
const input = resolve(process.argv[2]),
  output = resolve(process.argv[3]),
  threshold = Number(process.argv[4] ?? 7),
  densityName = process.argv[5] ?? "scalar_Density";
const bytes = await readFile(input);
const loader = new PLYLoader();
loader.setCustomPropertyNameMapping({ density: [densityName] });
const geometry = loader.parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
assert(
  geometry.index && geometry.attributes.density,
  "Native mesh must retain topology and explicitly exported density",
);
const root = resolve("."),
  server = await createServer({
    root,
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
try {
  const { normalizePoissonMesh } = await server.ssrLoadModule(
    "/src/poisson-mesh-cleanup.ts",
  );
  const result = normalizePoissonMesh(
    Float32Array.from(geometry.attributes.position.array),
    Uint32Array.from(geometry.index.array),
    Float32Array.from(geometry.attributes.density.array),
    threshold,
  );
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(result.vertices, 3));
  g.setIndex(new BufferAttribute(result.triangles, 1));
  g.computeVertexNormals();
  const nv = result.vertices.length / 3,
    nt = result.triangles.length / 3;
  const header = Buffer.from(
    `ply\nformat binary_little_endian 1.0\ncomment Scripted identical ScanForge Float32 normalization and explicit vertex-density threshold; native raw output retained separately\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nproperty float density\nelement face ${nt}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const body = Buffer.alloc(nv * 28 + nt * 13);
  let offset = 0;
  for (let i = 0; i < nv; i++) {
    for (const a of [result.vertices, g.attributes.normal.array])
      for (let j = 0; j < 3; j++) {
        body.writeFloatLE(a[i * 3 + j], offset);
        offset += 4;
      }
    body.writeFloatLE(result.density[i], offset);
    offset += 4;
  }
  for (let i = 0; i < nt; i++) {
    body.writeUInt8(3, offset++);
    for (let j = 0; j < 3; j++) {
      body.writeUInt32LE(result.triangles[i * 3 + j], offset);
      offset += 4;
    }
  }
  const data = Buffer.concat([header, body]);
  await writeFile(output, data);
  const receipt = {
    input,
    output,
    threshold,
    densityName,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    outputSha256: createHash("sha256").update(data).digest("hex"),
    inputVertices: geometry.attributes.position.count,
    inputTriangles: geometry.index.count / 3,
    outputVertices: nv,
    outputTriangles: nt,
    mergedVertices: result.mergedVertices,
    removedDegenerateTriangles: result.removedDegenerateTriangles,
    removedDuplicateTriangles: result.removedDuplicateTriangles,
    trimmedTriangles: result.trimmedTriangles,
    scope:
      "Explicit scripted postprocessing of native output, not native GUI filter behavior; same shared Float32 normalization/density7 policy as ScanForge.",
  };
  await writeFile(output + ".json", JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await server.close();
}
