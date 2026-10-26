import { expect, it } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import {
  reduceScanNoise,
  reduceScanNoiseAsync,
} from "../src/scan-tools-reduction";
import { reductionGrid } from "./helpers/reduction-grid";
import { nativeNoiseVertices } from "../src/scan-native-noise";
import {
  compareNoiseSurface,
  comparePreparedNoiseSurface,
} from "../src/scan-noise-deviation";
import { prepareReductionSurface } from "../src/scan-reduction-surface";
import { ScanPreviewSession } from "../src/scan-preview";

it.each([false, true])(
  "retains unrelated raw corners in selected noise publication (async=%s)",
  async (asynchronous) => {
    const quad = [0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0];
    const active = reductionGrid(6, 6);
    const source = new Float32Array(active.length + quad.length);
    source.set(active);
    source.set(
      quad.map((value, index) => (index % 3 === 0 ? value + 100 : value)),
      active.length,
    );
    source[active.length + 10] = 0.0000002;
    const before = source.slice(),
      cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
    const options = {
      iterations: 2,
      selectionOnly: true,
      selection: new Uint8Array(source.length / 9).fill(
        1,
        0,
        active.length / 9,
      ),
      applyBoundaryEdges: true,
      topologyCache: cache,
    };
    const result = await (
      asynchronous ? reduceScanNoiseAsync : reduceScanNoise
    )(source, options);
    expect(result.positions.slice(active.length)).toEqual(
      before.slice(active.length),
    );
    expect(result.positions.slice(0, active.length)).not.toEqual(
      before.slice(0, active.length),
    );
    expect(source).toEqual(before);
    const warm = analyzeMesh(result.positions, { topologyCache: cache }),
      cold = analyzeMesh(result.positions);
    expect(warm.vertices).toEqual(cold.vertices);
    expect(warm.triangles).toEqual(cold.triangles);
    expect(warm.boundaryLoops).toEqual(cold.boundaryLoops);
  },
);

it("retains exact raw aliases when whole-scan noise leaves boundary vertices stationary", () => {
  const source = Float32Array.from([
    0, 0, 0, 2, 0, 0, 2, 2, 0, 0, 0.0000002, 0, 2, 2, 0, 0, 2, 0,
  ]);
  const before = source.slice();
  expect(
    reduceScanNoise(source, { iterations: 3, applyBoundaryEdges: false })
      .positions,
  ).toEqual(before);
  expect(source).toEqual(before);
});

it("measures direct noise reduction against the published moving/stationary alias surface", async () => {
  const apex = [0, 0, 1],
    ring = [
      [-1, -1, 0],
      [1, -1, 0],
      [1, 1, 0],
      [-1, 1, 0],
    ];
  const fan = ring.flatMap((p, i) => [...apex, ...p, ...ring[(i + 1) % 4]]);
  const source = Float32Array.from([
    ...fan,
    -2,
    -2,
    0.99,
    2,
    -2,
    0.99,
    2,
    2,
    0.99,
    -2,
    -2,
    0.99,
    2,
    2,
    0.99,
    -2,
    2,
    0.99,
  ]);
  source[47] += 0.0000005;
  const topology = analyzeMesh(source),
    selection = Uint8Array.from([1, 1, 1, 1, 0, 0]);
  const options = {
    iterations: 2,
    selectionOnly: true,
    selection,
    applyBoundaryEdges: false,
  };
  const output = reduceScanNoise(source, options).positions;
  const legacy = nativeNoiseVertices(topology, 2, selection, false);
  const prepared = prepareReductionSurface({
    coordinates: output,
    indices: Uint32Array.from({ length: output.length / 3 }, (_, i) => i),
  });
  const old = compareNoiseSurface(topology, legacy, 1),
    published = comparePreparedNoiseSurface(topology, prepared, 1, {});
  const a = Math.abs(old.distances[0]),
    b = Math.abs(published.distances[0]),
    threshold = (a + b) / 2;
  expect(a).not.toBe(b);
  expect(compareNoiseSurface(topology, legacy, threshold).within).not.toBe(
    comparePreparedNoiseSurface(topology, prepared, threshold, {}).within,
  );
  const preview = await ScanPreviewSession.create({
    kind: "scanPreview",
    phase: "create",
    previewId: "alias-surface",
    positions: source,
    operation: { kind: "reduceNoise", ...options },
  });
  const comparison = preview.compare(threshold);
  expect(comparison.summary).toContain("(9/9)");
  for (const run of [reduceScanNoise, reduceScanNoiseAsync]) {
    const measured = await run(source, {
      ...options,
      measureDeviation: true,
      deviation: threshold,
    });
    expect(measured.summary.match(/\((\d+)\/(\d+)\)/)?.slice(1)).toEqual(
      comparison.summary.match(/\((\d+)\/(\d+)\)/)?.slice(1),
    );
    expect(measured.noiseComparison!.rgb).toEqual(
      comparison.noiseComparison.rgb,
    );
  }
});
