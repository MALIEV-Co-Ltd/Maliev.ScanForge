import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { meshGeometryNormals } from "../src/mesh-geometry-normals";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

const fixtures = [
  ["m2-closed-interior-split-20261105/native-result.stl", 8],
  ["m2-folded-open-native-20261105/native-result.stl", 11],
  ["m2-rotated-recovery-20261029/native-rotated-result-20261029.stl", 36],
  ["m2-crossing-pair-native-20261107/native-result.stl", 8],
  ["m2-native-extract-lifecycle-20261107/native-two-triangle.stl", 2],
] as const;

it.each(fixtures)(
  "matches the normal records of retained native export %s",
  (path, count) => {
    const file = readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
    expect(file.readUInt32LE(80)).toBe(count);
    expect(file.length).toBe(84 + count * 50);
    const positions = parseMesh(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
      "stl",
    );
    const mesh = nativeStlTopology(positions);
    const normals = meshGeometryNormals(mesh);
    const f = Math.fround;
    for (let i = 0; i < mesh.triangles.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const average = f(
          f(
            f(
              normals[mesh.triangles[i] * 3 + k] +
                normals[mesh.triangles[i + 1] * 3 + k],
            ) + normals[mesh.triangles[i + 2] * 3 + k],
          ) / 3,
        );
        expect(average).toBe(file.readFloatLE(84 + (i / 3) * 50 + k * 4));
      }
    }
  },
);

it.each([
  [
    "m2-closed-interior-split-20261105",
    "session.qsf",
    "14b86c19f1f05336fb4ca7d72bbb93534ca79718a9c71ca99daa7dc3441b2fc5",
    6,
    8,
  ],
  [
    "m2-folded-open-native-20261105",
    "native.qsf",
    "8924eb8b08dc57f1578d09087ba9a68f3fefb18e75c3ccd270a2f75da28a1455",
    9,
    11,
  ],
] as const)(
  "compares native STL normals using the saved indexed topology for %s",
  (dir, qsfName, hash, vertexCount, faceCount) => {
    const session = readFileSync(
      new URL(`./fixtures/${dir}/${qsfName}`, import.meta.url),
    );
    expect(createHash("sha256").update(session).digest("hex")).toBe(hash);
    expect(session.readUInt32LE(456)).toBe(vertexCount);
    const faceCountOffset = 460 + vertexCount * 12;
    expect(session.readUInt32LE(faceCountOffset)).toBe(faceCount);
    const vertices = Float32Array.from({ length: vertexCount * 3 }, (_, i) =>
      session.readFloatLE(460 + i * 4),
    );
    const triangles = Uint32Array.from({ length: faceCount * 3 }, (_, i) =>
      session.readUInt32LE(faceCountOffset + 4 + i * 4),
    );
    const normals = meshGeometryNormals({ vertices, triangles });
    const stl = readFileSync(
      new URL(`./fixtures/${dir}/native-result.stl`, import.meta.url),
    );
    expect(stl.readUInt32LE(80)).toBe(faceCount);
    const key = (a: number[], b: number[], c: number[]) =>
      [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ]
        .map((x) => JSON.stringify(x))
        .sort()[0];
    const faces = new Map<string, number[]>();
    const f = Math.fround;
    for (let i = 0; i < triangles.length; i += 3) {
      const indices = Array.from(triangles.slice(i, i + 3));
      const points = indices.map((id) =>
        Array.from(vertices.slice(id * 3, id * 3 + 3)),
      );
      const normal = [0, 1, 2].map((k) =>
        f(
          f(
            f(normals[indices[0] * 3 + k] + normals[indices[1] * 3 + k]) +
              normals[indices[2] * 3 + k],
          ) / 3,
        ),
      );
      const k = key(points[0], points[1], points[2]);
      expect(faces.has(k)).toBe(false);
      faces.set(k, normal);
    }
    for (let i = 0; i < faceCount; i++) {
      const offset = 84 + i * 50;
      const points = [0, 1, 2].map((c) =>
        [0, 1, 2].map((k) => stl.readFloatLE(offset + 12 + c * 12 + k * 4)),
      );
      const normal = faces.get(key(points[0], points[1], points[2]));
      expect(normal).toBeDefined();
      expect(normal).toEqual(
        [0, 1, 2].map((k) => stl.readFloatLE(offset + k * 4)),
      );
      faces.delete(key(points[0], points[1], points[2]));
    }
    expect(faces.size).toBe(0);
  },
);
