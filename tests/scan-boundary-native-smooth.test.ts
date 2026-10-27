import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import fixture from "./fixtures/boundary-smooth-observed-annulus.json";
import selectedFixture from "./fixtures/boundary-smooth-selected-inner-native.json";
import zeroStrengthFixture from "./fixtures/boundary-smooth-all-strength-zero-native.json";
import halfStrengthFixture from "./fixtures/boundary-smooth-all-strength-half-native.json";
import anchorFixture from "./fixtures/boundary-smooth-anchor-inner-native.json";
import headAnchorFixture from "./fixtures/boundary-smooth-anchor-head-native.json";
import twoAnchorFixture from "./fixtures/boundary-smooth-two-anchors-native.json";
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

it.each([zeroStrengthFixture, halfStrengthFixture])(
  "matches native all-boundary smoothing at strength $strength",
  async (nativeFixture) => {
    const source = Float32Array.from(fixture.source);
    const topology = importedTopology(source);
    const expected = Float32Array.from(nativeFixture.output);
    expect(
      createHash("sha256")
        .update(new Uint8Array(expected.buffer))
        .digest("hex"),
    ).toBe(nativeFixture.nativeCoordinatesSha256);
    await withCurvatureKernel(async () => {
      const result = await runScanEditAsync(
        {
          kind: "scanEdit",
          action: "boundarySmooth",
          positions: source,
          iterations: 1,
          strength: nativeFixture.strength,
        },
        { topologyCache: { positions: source, tolerance: 1e-6, topology } },
      );
      expect(result.positions?.length).toBe(expected.length);
      const tolerance =
        16 * Number.EPSILON * Math.max(1, ...source.map(Math.abs));
      for (let i = 0; i < expected.length; i++) {
        const actual = result.positions![i];
        if (Math.abs(actual) <= tolerance && Math.abs(expected[i]) <= tolerance)
          continue;
        expect(actual, `coordinate ${i}`).toBe(expected[i]);
      }
    });
  },
  30000,
);

it.each([anchorFixture, headAnchorFixture])(
  "matches native smoothing with anchor $anchorObservedPosition",
  async (nativeAnchor) => {
    const source = Float32Array.from(fixture.source);
    const topology = importedTopology(source);
    const anchorPosition = nativeAnchor.anchorObservedPosition;
    if (nativeAnchor === headAnchorFixture) {
      expect(
        nativeHoleBoundaryWalks(topology).some((walk) =>
          anchorPosition.every(
            (v, axis) => topology.vertices[walk[0] * 3 + axis] === v,
          ),
        ),
      ).toBe(true);
    }
    const boundaries = [...topology.boundaryLoops, ...topology.boundaryChains];
    const boundary = boundaries.findIndex((ids) =>
      ids.some((i) =>
        anchorPosition.every(
          (v, axis) => topology.vertices[i * 3 + axis] === v,
        ),
      ),
    );
    expect(boundary).toBeGreaterThanOrEqual(0);
    const point = boundaries[boundary].findIndex((i) =>
      anchorPosition.every((v, axis) => topology.vertices[i * 3 + axis] === v),
    );
    const expected = Float32Array.from(nativeAnchor.output);
    expect(
      createHash("sha256")
        .update(new Uint8Array(expected.buffer))
        .digest("hex"),
    ).toBe(nativeAnchor.nativeCoordinatesSha256);
    await withCurvatureKernel(async () => {
      const result = await runScanEditAsync(
        {
          kind: "scanEdit",
          action: "boundarySmooth",
          positions: source,
          strength: 0.5,
          anchors: [{ boundary, point }],
        },
        { topologyCache: { positions: source, tolerance: 1e-6, topology } },
      );
      const tolerance =
        16 * Number.EPSILON * Math.max(1, ...source.map(Math.abs));
      expect(result.positions?.length).toBe(expected.length);
      if (nativeAnchor === headAnchorFixture) {
        const corner = Array.from(
          { length: source.length / 3 },
          (_, i) => i,
        ).find((i) =>
          anchorPosition.every((v, axis) => source[i * 3 + axis] === v),
        )!;
        const movement = Math.hypot(
          ...anchorPosition.map(
            (v, axis) => result.positions![corner * 3 + axis] - v,
          ),
        );
        expect(movement).toBeGreaterThan(0.11);
        expect(movement).toBeLessThan(0.12);
      }
      for (let i = 0; i < expected.length; i++) {
        const actual = result.positions![i];
        if (Math.abs(actual) <= tolerance && Math.abs(expected[i]) <= tolerance)
          continue;
        expect(actual, `coordinate ${i}`).toBe(expected[i]);
      }
    });
  },
  30000,
);

it("matches the native two-anchor smoothing control", async () => {
  const source = Float32Array.from(fixture.source);
  const topology = importedTopology(source);
  const boundaries = [...topology.boundaryLoops, ...topology.boundaryChains];
  const anchors = twoAnchorFixture.anchorObservedPositions.map((position) => {
    const boundary = boundaries.findIndex((ids) =>
      ids.some((id) =>
        position.every(
          (value, axis) => topology.vertices[id * 3 + axis] === value,
        ),
      ),
    );
    expect(boundary).toBeGreaterThanOrEqual(0);
    const point = boundaries[boundary].findIndex((id) =>
      position.every(
        (value, axis) => topology.vertices[id * 3 + axis] === value,
      ),
    );
    return { boundary, point };
  });
  const expected = Float32Array.from(twoAnchorFixture.output);
  expect(
    createHash("sha256").update(new Uint8Array(expected.buffer)).digest("hex"),
  ).toBe(twoAnchorFixture.nativeCoordinatesSha256);
  const progress: number[] = [];
  await withCurvatureKernel(async () => {
    const result = await runScanEditAsync(
      {
        kind: "scanEdit",
        action: "boundarySmooth",
        positions: source,
        strength: 0.5,
        anchors,
      },
      {
        topologyCache: { positions: source, tolerance: 1e-6, topology },
        onProgress: (value) => progress.push(value),
      },
    );
    expect(result.positions?.length).toBe(expected.length);
    const tolerance =
      16 * Number.EPSILON * Math.max(1, ...source.map(Math.abs));
    for (let i = 0; i < expected.length; i++) {
      const actual = result.positions![i];
      if (Math.abs(actual) <= tolerance && Math.abs(expected[i]) <= tolerance)
        continue;
      expect(actual, `coordinate ${i}`).toBe(expected[i]);
    }
  });
  expect(progress.at(-1)).toBe(1);
  expect(
    progress.every((value, i) => i === 0 || value >= progress[i - 1]),
  ).toBe(true);
}, 30000);

it("cancels two-anchor projection without changing the input", async () => {
  const source = Float32Array.from(fixture.source);
  const before = source.slice();
  const topology = importedTopology(source);
  const boundaries = [...topology.boundaryLoops, ...topology.boundaryChains];
  const anchors = twoAnchorFixture.anchorObservedPositions.map((position) => {
    const boundary = boundaries.findIndex((ids) =>
      ids.some((id) =>
        position.every((v, axis) => topology.vertices[id * 3 + axis] === v),
      ),
    );
    return {
      boundary,
      point: boundaries[boundary].findIndex((id) =>
        position.every((v, axis) => topology.vertices[id * 3 + axis] === v),
      ),
    };
  });
  const controller = new AbortController();
  await withCurvatureKernel(async () => {
    await expect(
      runScanEditAsync(
        {
          kind: "scanEdit",
          action: "boundarySmooth",
          positions: source,
          strength: 0.5,
          anchors,
        },
        {
          topologyCache: { positions: source, tolerance: 1e-6, topology },
          signal: controller.signal,
          onProgress: (_, stage) => {
            if (stage === "Projecting fitted boundary") controller.abort();
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(source).toEqual(before);
}, 30000);

it("cancels between bounded projection batches on a long boundary", async () => {
  const count = 512;
  const positions: number[] = [];
  const point = (i: number, radius: number) => [
    Math.fround(radius * Math.cos((i * 2 * Math.PI) / count)),
    Math.fround(radius * Math.sin((i * 2 * Math.PI) / count)),
    Math.fround(radius === 3 ? 0.27 : 0.75),
  ];
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    positions.push(...point(i, 5), ...point(next, 5), ...point(next, 3));
    positions.push(...point(i, 5), ...point(next, 3), ...point(i, 3));
  }
  const source = Float32Array.from(positions);
  const before = source.slice();
  const topology = importedTopology(source);
  const boundary = topology.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        4,
    ),
  );
  expect(topology.boundaryLoops[boundary]).toHaveLength(count);
  const controller = new AbortController();
  let projectionCallbacks = 0;
  await withCurvatureKernel(async () => {
    await expect(
      runScanEditAsync(
        {
          kind: "scanEdit",
          action: "boundarySmooth",
          positions: source,
          strength: 0.5,
          indices: [boundary],
          anchors: [
            { boundary, point: 0 },
            { boundary, point: count / 2 },
          ],
        },
        {
          topologyCache: { positions: source, tolerance: 1e-6, topology },
          signal: controller.signal,
          onProgress: (_, stage) => {
            if (stage === "Projecting fitted boundary") {
              projectionCallbacks++;
              controller.abort();
            }
          },
        },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  expect(projectionCallbacks).toBe(1);
  expect(source).toEqual(before);
}, 30000);

it("rejects invalid, duplicate, cross-boundary and excess anchors before publishing geometry", async () => {
  const source = Float32Array.from(fixture.source);
  const topology = importedTopology(source);
  for (const anchors of [
    [{ boundary: 0, point: -1 }],
    [{ boundary: 99, point: 0 }],
    [
      { boundary: 0, point: 0 },
      { boundary: 0, point: 0 },
    ],
    [
      { boundary: 0, point: 0 },
      { boundary: 0, point: 1 },
    ],
    [
      { boundary: 0, point: 0 },
      { boundary: 0, point: 2 },
    ],
    [
      { boundary: 0, point: 0 },
      { boundary: 1, point: 0 },
    ],
    [
      { boundary: 0, point: 0 },
      { boundary: 0, point: 1 },
      { boundary: 0, point: 2 },
    ],
  ]) {
    await expect(
      runScanEditAsync(
        {
          kind: "scanEdit",
          action: "boundarySmooth",
          positions: source,
          anchors,
        },
        { topologyCache: { positions: source, tolerance: 1e-6, topology } },
      ),
    ).rejects.toThrow(/anchor/i);
  }
  expect(source).toEqual(Float32Array.from(fixture.source));
});

it("matches native smoothing of the selected inner boundary", async () => {
  const source = Float32Array.from(fixture.source);
  const topology = importedTopology(source);
  const inner = topology.boundaryLoops.findIndex((loop) =>
    loop.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        4,
    ),
  );
  expect(inner).toBeGreaterThanOrEqual(0);
  const expected = Float32Array.from(selectedFixture.output);
  expect(
    createHash("sha256").update(new Uint8Array(expected.buffer)).digest("hex"),
  ).toBe(selectedFixture.nativeCoordinatesSha256);
  await withCurvatureKernel(async () => {
    const result = await runScanEditAsync(
      {
        kind: "scanEdit",
        action: "boundarySmooth",
        positions: source,
        indices: [inner],
        strength: 1,
      },
      { topologyCache: { positions: source, tolerance: 1e-6, topology } },
    );
    expect(result.positions?.length).toBe(expected.length);
    const tolerance =
      16 * Number.EPSILON * Math.max(1, ...source.map(Math.abs));
    for (let i = 0; i < expected.length; i++) {
      const actual = result.positions![i];
      if (Math.abs(actual) <= tolerance && Math.abs(expected[i]) <= tolerance)
        continue;
      expect(actual, `coordinate ${i}`).toBe(expected[i]);
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
