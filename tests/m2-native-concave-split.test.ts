import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { analyzeIndexedMesh } from "../src/mesh-processing";

it("opens the closed native concave cutter seam without subdividing its facets", () => {
  const root = new URL(
    "./fixtures/m2-native-concave-split-20261029/",
    import.meta.url,
  );
  const load = (name: string) => {
    const bytes = readFileSync(new URL(name, root));
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const positions = load("square-source.stl"),
    target = load("concave-cutter.stl");
  const before = positions.slice(),
    targetBefore = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions,
    target,
  });
  expect(result.positions).toHaveLength(34 * 9);
  expect(result.indexedMesh).toBeDefined();
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.indexedMesh!.vertices),
    Uint32Array.from(result.indexedMesh!.triangles),
  );
  expect(topology.components).toHaveLength(2);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(positions).toEqual(before);
  expect(target).toEqual(targetBefore);
});

it("matches native concave mesh Split facets on the pinned inputs", () => {
  const root = new URL(
    "./fixtures/m2-native-concave-split-20261029/",
    import.meta.url,
  );
  const load = (name: string, sha256: string) => {
    const bytes = readFileSync(new URL(name, root));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load(
    "square-source.stl",
    "2202c3e08785be8c7694ea4e72aefb7cd3f29460e17435410b1aa7d844d66d19",
  );
  const target = load(
    "concave-cutter.stl",
    "0aa225313e6897518d77eddfee449f3cb61df8afabdb73eefb6da1373e42015d",
  );
  const expected = load(
    "native-concave-result-20261029.stl",
    "590bab9d40c4a026bc5bb7ed3a6b240436a439c2d2a06e0e64058ec6b4f6acca",
  );
  const output = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(output.positions?.length).toBe(expected.length);
  const facets = (p: ArrayLike<number>) => {
    const rows: string[] = [];
    for (let i = 0; i < p.length; i += 9) {
      const vertices = [0, 3, 6].map((offset) =>
        [0, 1, 2].map((axis) => Math.fround(p[i + offset + axis])).join(","),
      );
      rows.push(vertices.sort().join("|"));
    }
    return rows.sort();
  };
  expect(facets(output.positions!)).toEqual(facets(expected));
});
