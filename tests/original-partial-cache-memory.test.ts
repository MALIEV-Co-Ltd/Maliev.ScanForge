import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { expandPlyTopology } from "../src/ply-topology";
import { runScanEdit } from "../src/scan-edit";
import { nativeStlTopology } from "../src/scan-native-stl-topology";

// Run alone in a coordinated 4 GiB job. This checks the indexed worker path,
// not GUI, MCP, native equivalence, or serialized-cache memory consumption.
const source = process.env.SCANFORGE_M2_SECOND_STL;
it.skipIf(!source)(
  "fills a pinned partial selection on the indexed second scan",
  () => {
    const raw = readFileSync(source!);
    const digest = (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex");
    expect(digest(raw)).toBe(
      "3156b02a12c632abc3953597c3a606b4eb36ad49f65738e7fc1b29cc3a13e7ad",
    );
    const input = parseMesh(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      "stl",
    );
    const indexed = nativeStlTopology(input),
      positions = expandPlyTopology(indexed);
    const before = digest(new Uint8Array(positions.buffer));
    expect(before).toBe(
      "3de56197b72afa79d1f7e34502734920206b653181f80a8b1d705c9ebd189945",
    );
    const topology = analyzeIndexedMesh(
      Float64Array.from(indexed.vertices),
      indexed.triangles,
      { tolerance: 0.001 },
    );
    const cache = { positions, tolerance: 0.001, topology };
    const result = runScanEdit(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions,
        tolerance: 0.001,
        mode: "partial",
        algorithm: "tangent",
        indices: [3],
        start: 255,
        end: 263,
      },
      { topologyCache: cache },
    );
    expect(result.diagnostics.changed).toBe(true);
    expect(result.diagnostics.addedTriangles).toBe(13);
    expect(digest(new Uint8Array(positions.buffer))).toBe(before);
    expect(digest(new Uint8Array(result.positions!.buffer))).toBe(
      "db9794c41df6c16bb56a2d292cf1679be4542a31f2a42a9bcffef3bf42d9bb9d",
    );
    expect(cache.positions).toBe(result.positions);
  },
  180000,
);
