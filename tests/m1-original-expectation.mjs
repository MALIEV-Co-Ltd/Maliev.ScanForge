import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import {
  readScan,
  readAscPointCloud,
  meshGeometryNormals,
  digestEntityGeometry,
} from "../.resources/m1-import-core.mjs";
const [folder, name, output] = process.argv.slice(2);
const extension = extname(name).slice(1);
const scan = Number(/-(\d)\./.exec(name)[1]);
const filePath = join(folder, name);
const native = JSON.parse(
  await readFile(
    new URL("fixtures/stl-owner-topology-native.json", import.meta.url),
  ),
).sources;
const hash = (values) => createHash("sha256").update(values).digest("hex");
const normalize = (digest) =>
  digest.buffers.map(({ path, encoding, elements, sha256 }) => ({
    path,
    encoding,
    elements,
    sha256,
  }));
const blob = await openAsBlob(filePath);
const bytes = Buffer.from(await blob.arrayBuffer());
const sourceSha256 = hash(bytes);
let indexedMesh, normals;
const positions =
  extension === "asc"
    ? await readAscPointCloud(blob, { attributes: "xyz-normal" }).then(
        (cloud) => {
          normals = cloud.normals;
          return cloud.positions;
        },
      )
    : await readScan(blob, extension, {
        onIndexedMesh: (mesh) => {
          indexedMesh = mesh;
        },
        onMeshNormals: (value) => {
          normals = value;
        },
        onPointCloud: (value) => {
          normals = value.normals;
        },
      });
if (extension !== "asc") assert(indexedMesh);
if (extension === "stl") {
  const oracle = native.find((row) => row.file === name);
  assert.equal(sourceSha256, oracle.sourceSha256);
  assert.equal(hash(indexedMesh.vertices), oracle.verticesSha256);
  assert.equal(hash(indexedMesh.triangles), oracle.trianglesSha256);
  assert.equal(indexedMesh.vertices.length / 3, oracle.vertexCount);
  assert.equal(indexedMesh.triangles.length / 3, oracle.triangleCount);
} else if (extension === "ply") {
  // Independent binary-file oracle, without the application PLY parser.
  const headerEnd = bytes.indexOf("\n", bytes.indexOf("end_header")) + 1;
  const header = bytes.subarray(0, headerEnd).toString();
  assert(header.includes("format binary_little_endian 1.0"));
  const vertices = Number(/element vertex (\d+)/.exec(header)[1]);
  const faces = Number(/element face (\d+)/.exec(header)[1]);
  assert.equal(indexedMesh.vertices.length, vertices * 3);
  assert.equal(indexedMesh.normals.length, vertices * 3);
  for (let vertex = 0; vertex < vertices; vertex++)
    for (let axis = 0; axis < 3; axis++) {
      assert(
        Object.is(
          indexedMesh.vertices[vertex * 3 + axis],
          bytes.readFloatLE(headerEnd + vertex * 24 + axis * 4),
        ),
      );
      assert(
        Object.is(
          indexedMesh.normals[vertex * 3 + axis],
          bytes.readFloatLE(headerEnd + vertex * 24 + 12 + axis * 4),
        ),
      );
    }
  let offset = headerEnd + vertices * 24;
  for (let face = 0; face < faces; face++) {
    assert.equal(bytes[offset++], 3);
    for (let corner = 0; corner < 3; corner++, offset += 4)
      assert.equal(
        indexedMesh.triangles[face * 3 + corner],
        bytes.readUInt32LE(offset),
      );
  }
  assert.equal(offset, bytes.length);
} else {
  // ASC text is rounded; compare every sample with its original binary PLY.
  const ply = await readFile(join(folder, `ply-${scan}.ply`));
  const offset = ply.indexOf("\n", ply.indexOf("end_header")) + 1;
  const count = Number(
    /element vertex (\d+)/.exec(ply.subarray(0, offset).toString())[1],
  );
  assert.equal(positions.length, count * 3);
  assert.equal(normals.length, count * 3);
  for (let point = 0; point < count; point++)
    for (let axis = 0; axis < 3; axis++) {
      assert(
        Math.abs(
          positions[point * 3 + axis] -
            ply.readFloatLE(offset + point * 24 + axis * 4),
        ) <= 0.0006,
      );
      assert(
        Math.abs(
          normals[point * 3 + axis] -
            ply.readFloatLE(offset + point * 24 + 12 + axis * 4),
        ) <= 0.0000006,
      );
    }
}
// Computed geometry normals are distinct from the file-authored carrier.
if (indexedMesh) indexedMesh.geometryNormals = meshGeometryNormals(indexedMesh);
const expected = normalize(
  await digestEntityGeometry({
    id: "expected",
    name,
    kind: extension === "asc" ? "pointcloud" : "mesh",
    positions,
    normals,
    indexedMesh,
    visible: true,
    color: "#ffffff",
    opacity: 1,
  }),
);
await writeFile(
  output,
  JSON.stringify({ sourceSha256, bytes: bytes.length, expected }, null, 2),
);
