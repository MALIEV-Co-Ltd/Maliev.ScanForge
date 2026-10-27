import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { analyzeIndexedMesh, analyzeMesh } from "../src/mesh-processing";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

// Run alone in the coordinated 4 GiB Job. This is topology admission evidence,
// not a GUI, fill, or native comparison, and creates no resource limit itself.
const source = process.env.SCANFORGE_M2_SECOND_STL;
it.skipIf(!source)(
  "analyzes the pinned second original scan and reports its nonmanifold edge",
  () => {
    const raw = readFileSync(source!);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "3156b02a12c632abc3953597c3a606b4eb36ad49f65738e7fc1b29cc3a13e7ad",
    );
    const positions = parseMesh(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      "stl",
    );
    expect(positions.length / 9).toBe(2547405);
    const topology = analyzeMesh(positions, { tolerance: 0.001 });
    expect(topology.nonManifoldEdges).toBe(1);
    expect(topology.inconsistentEdges).toBe(0);
    expect(topology.boundaryLoops).toHaveLength(31);
  },
  180000,
);

it.skipIf(!source)(
  "analyzes the same scan using the indexed STL import representation",
  () => {
    const raw = readFileSync(source!);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "3156b02a12c632abc3953597c3a606b4eb36ad49f65738e7fc1b29cc3a13e7ad",
    );
    const positions = parseMesh(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      "stl",
    );
    const indexed = nativeStlTopology(positions);
    expect(indexed.triangles.length / 3).toBe(2547403);
    const topology = analyzeIndexedMesh(
      Float64Array.from(indexed.vertices),
      indexed.triangles,
      { tolerance: 0.001 },
    );
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.inconsistentEdges).toBe(0);
    expect(topology.boundaryLoops).toHaveLength(42);
  },
  180000,
);
