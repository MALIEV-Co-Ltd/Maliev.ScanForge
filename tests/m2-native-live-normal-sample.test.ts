import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { meshGeometryNormals } from "../src/mesh-geometry-normals";

const sourcePath = process.env.SCANFORGE_M2_FIRST_STL;
it.skipIf(!sourcePath)(
  "matches observed native scan vertex-normal records",
  () => {
    const samples = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/m2-native-live-normal-sample-20261107.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { coordinates: number[]; normals: number[] }[];
    expect(samples).toHaveLength(64);
    const bytes = readFileSync(sourcePath!);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "6dfc4db5ed4ad2ed5c2f9295a11c50c2dda5db3240cd82ce80c1d1f3e38af6c9",
    );
    const positions = parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
    const mesh = nativeStlTopology(positions);
    const normals = meshGeometryNormals(mesh);
    const index = new Map<string, number[]>();
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const key = JSON.stringify(Array.from(mesh.vertices.slice(i, i + 3)));
      const existing = index.get(key) ?? [];
      existing.push(i);
      index.set(key, existing);
    }
    for (const sample of samples) {
      const offsets = index.get(JSON.stringify(sample.coordinates)) ?? [];
      expect(offsets).toHaveLength(1);
      expect(Array.from(normals.slice(offsets[0], offsets[0] + 3))).toEqual(
        sample.normals,
      );
    }
    const facets = JSON.parse(
      readFileSync(
        new URL(
          "./fixtures/m2-native-live-facet-sample-20261107.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { vertices: { coordinates: number[]; normals: number[] }[] }[];
    expect(facets).toHaveLength(7);
    for (const facet of facets) {
      const coordinates = facet.vertices.flatMap(
        (vertex) => vertex.coordinates,
      );
      const slots: number[] = [];
      for (let i = 0; i < positions.length; i += 9)
        if (coordinates.every((value, k) => Object.is(value, positions[i + k])))
          slots.push(i / 3);
      expect(slots).toHaveLength(1);
      for (let vertex = 0; vertex < 3; vertex++) {
        const offset = mesh.triangles[slots[0] + vertex] * 3;
        expect(Array.from(normals.slice(offset, offset + 3))).toEqual(
          facet.vertices[vertex].normals,
        );
      }
    }
  },
  120000,
);
