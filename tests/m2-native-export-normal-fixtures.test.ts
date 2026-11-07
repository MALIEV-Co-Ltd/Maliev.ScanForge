import { readFileSync } from "node:fs";
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
