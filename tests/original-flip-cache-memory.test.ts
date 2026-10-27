import { packTopology, unpackTopology } from "../src/topology-cache-codec";
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseMesh } from "../src/io";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { expandPlyTopology } from "../src/ply-topology";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { flipScanNormals } from "../src/scan-tools-transforms";
// Run alone in the coordinated 4 GiB job; this is a worker-level cache test.
const source = process.env.SCANFORGE_M2_SECOND_STL;
it.skipIf(!source)(
  "flips and serializes the indexed second scan topology",
  () => {
    const raw = readFileSync(source!);
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "3156b02a12c632abc3953597c3a606b4eb36ad49f65738e7fc1b29cc3a13e7ad",
    );
    const indexed = nativeStlTopology(
        parseMesh(
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
          "stl",
        ),
      ),
      positions = expandPlyTopology(indexed);
    const digest = (v: Float32Array) =>
      createHash("sha256")
        .update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength))
        .digest("hex");
    const before = digest(positions);
    const topology = analyzeIndexedMesh(
      Float64Array.from(indexed.vertices),
      indexed.triangles,
      { tolerance: 0.001 },
    );
    const cache = { positions, tolerance: 0.001, topology };
    const result = flipScanNormals(positions, { topologyCache: cache });
    expect(cache.positions).toBe(result.positions);
    expect(digest(positions)).toBe(before);
    const packed = packTopology(cache.topology);
    const restored = unpackTopology(packed, result.positions.length);
    expect(restored).toBeDefined();
    expect(
      createHash("sha256")
        .update(new Uint8Array(restored!.triangles.buffer))
        .digest("hex"),
    ).toBe(
      createHash("sha256")
        .update(new Uint8Array(cache.topology.triangles.buffer))
        .digest("hex"),
    );
    expect(restored!.boundaryLoops).toEqual(cache.topology.boundaryLoops);
    expect(before).toBe(
      "3de56197b72afa79d1f7e34502734920206b653181f80a8b1d705c9ebd189945",
    );
    expect(digest(result.positions)).toBe(
      "abd9f65544472d62b1bb4cf9120157f87350c2a5ebcf1ce6e5b070cadeccd5dc",
    );
    expect(packed.buffers.reduce((a, b) => a + b.byteLength, 0)).toBe(
      158646808,
    );
  },
  180000,
);
