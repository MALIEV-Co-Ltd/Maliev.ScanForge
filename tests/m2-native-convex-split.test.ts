import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";
import { analyzeIndexedMesh } from "../src/mesh-processing";

it("opens the closed native cutter seam without subdividing its facets", () => {
  const root = new URL(
    "./fixtures/m2-native-convex-split-20261029/",
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
    target = load("convex-cutter.stl");
  const before = positions.slice(),
    targetBefore = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions,
    target,
  });
  expect(result.positions).toHaveLength(18 * 9);
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

it.fails("matches native convex mesh Split facets on the pinned inputs", () => {
  const root = new URL(
    "./fixtures/m2-native-convex-split-20261029/",
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
    "convex-cutter.stl",
    "30994066b6e33d4d479c894405ffcec5e2350d4e42c89ade4e948a2443823612",
  );
  const expected = load(
    "native-convex-result-20261029.stl",
    "6e08cdde5035399ed82c103a4fbd9a973846a1f824f3e77ad5792f8d2bfb7b15",
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
