import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import fixture from "./fixtures/boundary-smooth-observed-annulus.json";
import { runScanEditAsync } from "../src/scan-edit";
import { withCurvatureKernel } from "./helpers/curvature-kernel-vm";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import type { MeshProcessingOptions } from "../src/mesh-processing";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { nativeHoleBoundaryWalks } from "../src/scan-hole-boundary-order";

function importedTopology(source: Float32Array) {
  const indexed = nativeStlTopology(source);
  return analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
}

it("retains the native binary importer ordering for boundary curve projection", () => {
  const topology = importedTopology(Float32Array.from(fixture.source));
  const heads = nativeHoleBoundaryWalks(topology).map((loop) =>
    Array.from(topology.vertices.subarray(loop[0] * 3, loop[0] * 3 + 3)),
  );
  expect(heads, JSON.stringify(heads)).toEqual([
    [5, 0, 0.75],
    [2.4944088459014893, 1.6667107343673706, 0.27000001072883606],
  ]);
});

it("matches one native all-boundary smoothing operation at observed 100 percent strength", async () => {
  const source = Float32Array.from(fixture.source);
  const before = Buffer.from(source.buffer).slice();
  const topology = importedTopology(source);
  const expected = Float32Array.from(fixture.output);
  expect(
    createHash("sha256").update(new Uint8Array(expected.buffer)).digest("hex"),
  ).toBe(fixture.nativeCoordinatesSha256);
  await withCurvatureKernel(async () => {
    const result = await runScanEditAsync(
      {
        kind: "scanEdit",
        action: "boundarySmooth",
        positions: source,
        iterations: fixture.repetitions,
        strength: fixture.strength,
      },
      { topologyCache: { positions: source, tolerance: 1e-6, topology } },
    );
    expect(Buffer.from(source.buffer).equals(before)).toBe(true);
    expect(result.positions?.length).toBe(fixture.output.length);
    const output = Float32Array.from(result.positions!);
    const zeroRoundoff =
      16 * Number.EPSILON * Math.max(1, ...source.map(Math.abs));
    // OCCT versions differ only in the Double residual at a mathematical zero.
    // Every coordinate outside that zero neighborhood must match Float32 bits.
    for (let i = 0; i < output.length; i++) {
      if (
        Math.abs(output[i]) <= zeroRoundoff &&
        Math.abs(expected[i]) <= zeroRoundoff
      )
        continue;
      expect(output[i], `coordinate ${i}`).toBe(expected[i]);
    }
  });
}, 30000);

it("makes two command repetitions agree with successive edits retaining native topology", async () => {
  const source = Float32Array.from(fixture.source);
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {
    positions: source,
    tolerance: 1e-6,
    topology: importedTopology(source),
  };
  const first = await withCurvatureKernel(() =>
    runScanEditAsync(
      { kind: "scanEdit", action: "boundarySmooth", positions: source },
      { topologyCache: cache },
    ),
  );
  const second = await withCurvatureKernel(() =>
    runScanEditAsync(
      {
        kind: "scanEdit",
        action: "boundarySmooth",
        positions: first.positions!,
      },
      { topologyCache: cache },
    ),
  );
  const repeated = await withCurvatureKernel(() =>
    runScanEditAsync(
      {
        kind: "scanEdit",
        action: "boundarySmooth",
        positions: source,
        iterations: 2,
      },
      {
        topologyCache: {
          positions: source,
          tolerance: 1e-6,
          topology: importedTopology(source),
        },
      },
    ),
  );
  expect(repeated.positions).toEqual(second.positions);
  expect(source).toEqual(Float32Array.from(fixture.source));
}, 30000);
