import { describe, expect, it } from "vitest";
import {
  analyzeMesh,
  type MeshProcessingOptions,
} from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import { smoothSelectedVertices } from "../src/scan-selected-smooth";
import { indexedMeshMatches } from "../src/indexed-mesh";
import type { Positions } from "../src/types";
import { SCAN_TOPOLOGY_TOLERANCE } from "../src/scan-topology-tolerance";

const vertices = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const faces = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
];
const openCube = faces.flatMap((f) => f.flatMap((i) => vertices[i]));
const cube = [...openCube, ...[4, 5, 6, 4, 6, 7].flatMap((i) => vertices[i])];
it("preserves untouched precise coordinates when smoothing a separate component", () => {
  const untouched = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
  const positions = [...cube, ...untouched];
  const selection = new Uint8Array(positions.length / 9);
  selection.fill(1, 0, cube.length / 9);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "smoothSelected",
    positions,
    selection,
  });
  expect(Array.from(result.positions!.slice(-9))).toEqual(untouched);
  expect(Array.from(result.positions!.slice(0, cube.length))).not.toEqual(cube);
});
it("does not round a precise boundary when smoothing makes no change", () => {
  const positions = openCube.map(
    (value, i) => value + (i % 3 === 0 ? 2 ** -30 : 0),
  );
  const result = runScanEdit({
    kind: "scanEdit",
    action: "boundarySmooth",
    positions,
    strength: 0.5,
  });
  expect(result.positions).toEqual(positions);
  expect(result.diagnostics.changed).toBe(false);
});
it("publishes precomputed worker smoothing with the same geometry and successor topology", () => {
  const positions = new Float32Array(cube);
  const selection = new Uint8Array(positions.length / 9).fill(1);
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const topology = analyzeMesh(positions, { topologyCache });
  const computed = smoothSelectedVertices(topology, selection, 6, 0.5, {});
  let used = false;
  const result = runScanEdit(
    { kind: "scanEdit", action: "smoothSelected", positions, selection },
    {
      topologyCache,
      selectedSmoothing: (current, mask, iterations, strength) => {
        expect(current).toBe(topology);
        expect(mask).toBe(selection);
        expect([iterations, strength]).toEqual([6, 0.5]);
        used = true;
        return computed;
      },
    },
  );
  expect(used).toBe(true);
  expect(result.positions).toEqual(
    runScanEdit({
      kind: "scanEdit",
      action: "smoothSelected",
      positions,
      selection,
    }).positions,
  );
  expect(topologyCache.positions).toBe(result.positions);
  expect(topologyCache.topology!.edges).toBe(topology.edges);
});
const area = (p: Positions) =>
  runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions: p,
  }).inventory!.components.reduce((sum, c) => sum + c.area, 0);
const shifted = (p: number[], offset: number, scale = 1) =>
  p.map((v, i) => v * scale + (i % 3 === 0 ? offset : 0));
it("defeatures a noisy annular selection spatially and retains its successor topology", () => {
  const positions: number[] = [],
    selected: number[] = [];
  const p = (x: number, y: number) => [
    x,
    y,
    0.02 * Math.sin(x * 1.3 + y * 0.8),
  ];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      if (x === 3 && y === 3) continue;
      positions.push(
        ...p(x, y),
        ...p(x + 1, y),
        ...p(x + 1, y + 1),
        ...p(x, y),
        ...p(x + 1, y + 1),
        ...p(x, y + 1),
      );
      const inRing = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      selected.push(Number(inRing), Number(inRing));
    }
  const selection = new Uint8Array(selected),
    progress: [number, string][] = [];
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  analyzeMesh(positions, { topologyCache });
  const outcome = runScanEdit(
    {
      kind: "scanEdit",
      action: "defeature",
      positions,
      selection,
      algorithm: "flat",
    },
    { topologyCache, onProgress: (f, s) => progress.push([f, s]) },
  );
  expect(progress.at(-1)).toEqual([1, "Defeature complete"]);
  expect(progress.every(([f], i) => i === 0 || f >= progress[i - 1][0])).toBe(
    true,
  );
  expect(progress.some(([, s]) => s.includes("Hole filling complete"))).toBe(
    false,
  );
  expect(
    progress.some(([, s]) => /Welding vertices|Building topology/.test(s)),
  ).toBe(false);
  expect(topologyCache.positions).toBe(outcome.positions);
  const successorProgress: string[] = [];
  const topology = analyzeMesh(outcome.positions!, {
    topologyCache,
    onProgress: (_, stage) => successorProgress.push(stage),
  });
  expect(successorProgress).toEqual(["Reusing mesh topology"]);
  const independent = analyzeMesh(outcome.positions!);
  expect(topology.boundaryLoops.length).toBe(independent.boundaryLoops.length);
  expect(topology.components.length).toBe(independent.components.length);
  expect(topology.nonManifoldEdges).toBe(independent.nonManifoldEdges);
  expect(topology.boundaryLoops).toHaveLength(1); // Outside perimeter remains, selected hole removed.
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  const retained = positions.filter((_, i) => !selection[Math.floor(i / 9)]);
  expect(Array.from(outcome.positions!.slice(0, retained.length))).toEqual(
    Array.from(new Float32Array(retained)),
  );
});
it("removes the smaller marked island before repatching, preserving unrelated components", () => {
  const positions: number[] = [],
    selected: number[] = [];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const p = (a: number, b: number) => [a, b, 0];
      positions.push(
        ...p(x, y),
        ...p(x + 1, y),
        ...p(x + 1, y + 1),
        ...p(x, y),
        ...p(x + 1, y + 1),
        ...p(x, y + 1),
      );
      const ring =
        x >= 2 && x <= 4 && y >= 2 && y <= 4 && !(x === 3 && y === 3);
      selected.push(Number(ring), Number(ring));
    }
  // A disconnected object must not be deleted by marked-component pruning.
  positions.push(20, 0, 0, 21, 0, 0, 20, 1, 0);
  selected.push(0);
  const source = [...positions];
  const result = runScanEdit({
    kind: "scanEdit",
    action: "defeature",
    positions,
    selection: new Uint8Array(selected),
  });
  expect(result.diagnostics.prunedTriangles).toBe(2);
  const topology = analyzeMesh(result.positions!);
  expect(topology.components).toHaveLength(2);
  expect(topology.boundaryLoops).toHaveLength(2);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(positions).toEqual(source);
});
it("repatches two separated selected seams and compacts the cached vertex slots", () => {
  const positions: number[] = [],
    selection: number[] = [];
  const p = (x: number, y: number) => [
    x,
    y,
    0.02 * Math.sin(x * 1.3 + y * 0.8),
  ];
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 13; x++) {
      if (y === 3 && (x === 3 || x === 9)) continue;
      positions.push(
        ...p(x, y),
        ...p(x + 1, y),
        ...p(x + 1, y + 1),
        ...p(x, y),
        ...p(x + 1, y + 1),
        ...p(x, y + 1),
      );
      const selected =
        y >= 2 && y <= 4 && ((x >= 2 && x <= 4) || (x >= 8 && x <= 10));
      selection.push(Number(selected), Number(selected));
    }
  const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const result = runScanEdit(
    {
      kind: "scanEdit",
      action: "defeature",
      positions,
      selection: new Uint8Array(selection),
    },
    { topologyCache },
  );
  expect(result.diagnostics.fillAttempts).toBe(2);
  const topology = analyzeMesh(result.positions!, { topologyCache });
  expect(topology.boundaryLoops).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  expect(new Set(topology.triangles).size).toBe(topology.vertices.length / 3);
});
it("uses consistent adjacency tolerance while projection fit tolerance never rewelds a small hole", () => {
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1.0005, 0, 0, 1, 1, 0, 0.0005, 1, 0,
  ];
  const topology = analyzeMesh(positions, {
    tolerance: SCAN_TOPOLOGY_TOLERANCE,
  });
  const inventory = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
    tolerance: SCAN_TOPOLOGY_TOLERANCE,
  });
  expect(topology.components).toHaveLength(1);
  expect(inventory.inventory!.components).toHaveLength(1);
  const small = runScanEdit({
    kind: "scanEdit",
    action: "boundaryProject",
    positions: shifted(openCube, 0, 0.01),
    indices: [0],
    tolerance: SCAN_TOPOLOGY_TOLERANCE,
    fitTolerance: 0.05,
    plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
  });
  expect(small.curves).toHaveLength(1);
  expect(small.curves![0].length).toBeGreaterThanOrEqual(12);
});
it("fills an inner planar hole while preserving the outer sheet boundary", () => {
  const outer = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 4, 0],
      [0, 4, 0],
    ],
    inner = [
      [1, 1, 0],
      [3, 1, 0],
      [3, 3, 0],
      [1, 3, 0],
    ];
  const positions = [] as number[];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    positions.push(
      ...outer[i],
      ...outer[j],
      ...inner[j],
      ...outer[i],
      ...inner[j],
      ...inner[i],
    );
  }
  const before = runScanEdit({
    kind: "scanEdit",
    action: "inventory",
    positions,
  });
  expect(before.inventory!.boundaries).toHaveLength(2);
  const hole = before.inventory!.boundaries.findIndex(
    (boundary) => boundary.length === 8,
  );
  const filled = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [hole],
    algorithm: "flat",
  });
  expect(filled.diagnostics.filledHoles).toBe(1);
  expect(analyzeMesh(filled.positions!).boundaryLoops).toHaveLength(1);
  expect(area(filled.positions!)).toBeCloseTo(16);
  const outerCap = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [1 - hole],
    algorithm: "flat",
  });
  expect(outerCap.diagnostics.filledHoles).toBe(0);
});

describe("scan edit inventory and components", () => {
  it("returns explicitly scoped indexed component inventory without implying boundary results", () => {
    const first = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const positions = [
      ...first,
      ...first.map((value, i) => value + (i % 3 === 0 ? 3 : 0)),
    ];
    const sourceIndexed = {
      vertices: [...positions],
      triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const full = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions,
      sourceIndexed,
    });
    const scoped = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      inventoryScope: "components",
      positions,
      sourceIndexed,
    });
    expect(scoped.inventory!.scope).toBe("components");
    expect(scoped.inventory!.components).toEqual(full.inventory!.components);
    expect(scoped.inventory!.boundaries).toEqual([]);
    expect(scoped.diagnostics).toMatchObject({
      scope: "components",
      components: 2,
    });
    expect(scoped.diagnostics).not.toHaveProperty("holes");
  });
  it("keeps coincident indexed components separate without a worker cache", () => {
    const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const positions = [...triangle, ...triangle];
    const sourceIndexed = {
      vertices: [...positions],
      triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    const inventory = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions,
      sourceIndexed,
    });
    expect(inventory.inventory!.components).toHaveLength(2);
    const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> =
      {};
    analyzeMesh(positions, { topologyCache });
    expect(
      runScanEdit(
        { kind: "scanEdit", action: "inventory", positions, sourceIndexed },
        { topologyCache },
      ).inventory!.components,
    ).toHaveLength(2);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "componentKeep",
      positions,
      sourceIndexed,
      indices: [0],
    });
    expect(Array.from(result.positions!)).toEqual(triangle);
    expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(
      true,
    );
  });
  it("preserves precise indexed corners through component edits", () => {
    const first = [100000004, 0, 0, 100000012, 0, 0, 100000004, 8, 0];
    const second = [100000028, 0, 0, 100000036, 0, 0, 100000028, 8, 0];
    const positions = [...first, ...second];
    const sourceIndexed = {
      vertices: [...positions],
      triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
    };
    for (const action of [
      "componentKeep",
      "componentRemove",
      "componentFlip",
    ] as const) {
      const result = runScanEdit({
        kind: "scanEdit",
        action,
        positions,
        sourceIndexed,
        indices: [0],
      });
      const expected =
        action === "componentKeep"
          ? first
          : action === "componentRemove"
            ? second
            : [
                ...first.slice(0, 3),
                ...first.slice(6, 9),
                ...first.slice(3, 6),
                ...second,
              ];
      expect(Array.from(result.positions!)).toEqual(expected);
      expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(
        true,
      );
    }
    const extracted = runScanEdit({
      kind: "scanEdit",
      action: "componentExtract",
      positions,
      sourceIndexed,
      indices: [0, 1],
    });
    expect(extracted.segments!.map((part) => Array.from(part))).toEqual([
      first,
      second,
    ]);
    for (let i = 0; i < 2; i++)
      expect(
        indexedMeshMatches(
          extracted.segmentIndexedMeshes![i],
          extracted.segments![i],
        ),
      ).toBe(true);
  });
  it("reports individual areas, holes, lengths and geometric diameter", () => {
    const result = runScanEdit({
      kind: "scanEdit",
      action: "inventory",
      positions: [...openCube, ...shifted(openCube, 3, 2)],
    });
    expect(result.inventory!.components.map((c) => c.area)).toEqual([5, 20]);
    expect(result.inventory!.boundaries.map((b) => b.length)).toEqual([4, 8]);
    expect(result.inventory!.boundaries[0].diameter).toBeCloseTo(Math.SQRT2);
    expect(result.diagnostics.holes).toBe(2);
  });
  it("extracts, keeps, removes and flips selected components without mutating input", () => {
    const positions = [...openCube, ...shifted(openCube, 3)],
      before = [...positions];
    expect(
      runScanEdit({
        kind: "scanEdit",
        action: "componentExtract",
        positions,
        indices: [1],
      }).segments![0],
    ).toEqual(new Float32Array(shifted(openCube, 3)));
    expect(
      runScanEdit({
        kind: "scanEdit",
        action: "componentKeep",
        positions,
        indices: [0],
      }).positions,
    ).toEqual(new Float32Array(openCube));
    expect(
      runScanEdit({
        kind: "scanEdit",
        action: "componentRemove",
        positions,
        indices: [1],
      }).positions,
    ).toEqual(new Float32Array(openCube));
    const flipped = runScanEdit({
      kind: "scanEdit",
      action: "componentFlip",
      positions,
      indices: [0],
    }).positions!;
    expect([...flipped.slice(3, 6)]).toEqual(openCube.slice(6, 9));
    expect([...flipped.slice(openCube.length)]).toEqual(shifted(openCube, 3));
    expect(positions).toEqual(before);
  });
});
describe("boundary filling", () => {
  it.each(["automatic", "flat", "tangent", "curvature"] as const)(
    "closes a cube with %s and preserves the original boundary",
    (algorithm) => {
      const result = runScanEdit({
        kind: "scanEdit",
        action: "fillHoles",
        positions: openCube,
        algorithm,
      });
      expect(result.diagnostics.filledHoles).toBe(1);
      expect(analyzeMesh(result.positions!).boundaryEdges).toBe(0);
      expect(analyzeMesh(result.positions!).inconsistentEdges).toBe(0);
      expect(result.positions!.slice(0, openCube.length)).toEqual(
        new Float32Array(openCube),
      );
    },
  );
  it("filters multiple holes by bounding diameter and explicit loop index", () => {
    const positions = [...openCube, ...shifted(openCube, 3, 2)];
    const filled = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      diameter: 2,
    });
    expect(filled.diagnostics.filledHoles).toBe(1);
    expect(filled.diagnostics.skippedHoles).toBe(1);
    expect(analyzeMesh(filled.positions!).boundaryLoops).toHaveLength(1);
    const second = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [1],
    });
    expect(second.diagnostics.filledHoles).toBe(1);
  });
  it("fills an arc while leaving the remainder open, and bridges separate edges", () => {
    const partial = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: openCube,
      mode: "partial",
      start: 0,
      end: 2,
    });
    expect(partial.diagnostics.addedTriangles).toBe(1);
    expect(analyzeMesh(partial.positions!).boundaryLoops[0]).toHaveLength(3);
    const bridge = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: openCube,
      mode: "bridge",
      start: 0,
      end: 2,
    });
    expect(bridge.diagnostics.addedTriangles).toBe(2);
    expect(analyzeMesh(bridge.positions!).boundaryEdges).toBe(0);
    expect(() =>
      runScanEdit({
        kind: "scanEdit",
        action: "fillHoles",
        positions: openCube,
        mode: "bridge",
        start: 0,
        end: 1,
      }),
    ).toThrow("separate");
  });
  it("refuses to duplicate a planar sheet and rejects unsafe selections", () => {
    const sheet = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    expect(
      runScanEdit({ kind: "scanEdit", action: "fillHoles", positions: sheet })
        .diagnostics.filledHoles,
    ).toBe(0);
    expect(() =>
      runScanEdit({
        kind: "scanEdit",
        action: "fillHoles",
        positions: openCube,
        indices: [99],
      }),
    ).toThrow("closed");
  });
});
describe("patch and boundary edits", () => {
  it("averages selected interior vertices and preserves disconnected unselected geometry", () => {
    const fan = [
      0, 0, 0, 1, 0, 0, 0.5, 0.5, 1, 1, 0, 0, 1, 1, 0, 0.5, 0.5, 1, 1, 1, 0, 0,
      1, 0, 0.5, 0.5, 1, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 1,
    ];
    const positions = [...fan, ...shifted(openCube, 3)];
    const selection = new Uint8Array(positions.length / 9);
    selection.fill(1, 0, 4);
    const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> =
      {};
    analyzeMesh(positions, { topologyCache });
    const stages: string[] = [];
    const result = runScanEdit(
      {
        kind: "scanEdit",
        action: "smoothSelected",
        positions,
        selection,
        iterations: 1,
        strength: 0.5,
      },
      { topologyCache, onProgress: (_, stage) => stages.push(stage) },
    ).positions!;
    expect(result[8]).toBeCloseTo(0);
    expect(result.slice(0, 6)).toEqual(new Float32Array(fan.slice(0, 6)));
    expect(result.slice(fan.length)).toEqual(
      new Float32Array(shifted(openCube, 3)),
    );
    const successorStages: string[] = [];
    const cached = analyzeMesh(result, {
      topologyCache,
      onProgress: (_, stage) => successorStages.push(stage),
    });
    expect(successorStages).toEqual(["Reusing mesh topology"]);
    expect(
      stages.some((stage) => /Welding vertices|Building topology/.test(stage)),
    ).toBe(false);
    const fresh = analyzeMesh(result);
    expect(cached.boundaryEdges).toBe(fresh.boundaryEdges);
    expect(cached.components.length).toBe(fresh.components.length);
    expect(Array.from(cached.vertices)).toEqual(Array.from(fresh.vertices));
  });
  it("projects a closed boundary onto the chosen plane without changing mesh", () => {
    const result = runScanEdit({
      kind: "scanEdit",
      action: "boundaryProject",
      positions: openCube,
      plane: { origin: [0, 0, 0], normal: [0, 0, 2] },
    });
    expect(result.curves![0]).toHaveLength(15);
    expect(result.curves![0].filter((_, i) => i % 3 === 2)).toEqual([
      0, 0, 0, 0, 0,
    ]);
    expect(result.positions).toBeUndefined();
  });
  it("retains a small convex boundary without a fitted curve and repatches a selected cube top", () => {
    const smooth = runScanEdit({
      kind: "scanEdit",
      action: "boundarySmooth",
      positions: openCube,
      iterations: 1,
      strength: 0.5,
    });
    expect(smooth.positions).toEqual(new Float32Array(openCube));
    expect(smooth.diagnostics.changed).toBe(false);
    expect(smooth.diagnostics.unfittedBoundaries).toBe(1);
    const selection = new Uint8Array(12);
    selection.fill(1, 10);
    const patch = runScanEdit({
      kind: "scanEdit",
      action: "defeature",
      positions: cube,
      selection,
    });
    expect(patch.diagnostics.removedTriangles).toBe(2);
    expect(analyzeMesh(patch.positions!).boundaryEdges).toBe(0);
  });
});
describe("triangle fragment splitting", () => {
  it("splits a crossing triangle at the plane and conserves area", () => {
    const positions = [-1, 0, 0, 1, 0, 0, 0, 2, 0];
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
    });
    expect(result.diagnostics.splitTriangles).toBe(1);
    expect(result.segments![0]).toHaveLength(9);
    expect(result.segments![1]).toHaveLength(9);
    expect(area(result.segments![0]) + area(result.segments![1])).toBeCloseTo(
      2,
    );
    expect(
      [...result.segments![0]]
        .filter((_, i) => i % 3 === 0)
        .every((x) => x <= 0),
    ).toBe(true);
  });
  it("partitions crossing triangles with a closed convex mesh, independent of cutter winding", () => {
    const positions = [-1, 0.5, 0.5, 2, 0.5, 0.5, 0.5, 2, 0.5];
    const reversed = cube.flatMap((_, i) =>
      i % 9 === 0
        ? [
            ...cube.slice(i, i + 3),
            ...cube.slice(i + 6, i + 9),
            ...cube.slice(i + 3, i + 6),
          ]
        : [],
    );
    for (const target of [cube, reversed]) {
      const result = runScanEdit({
        kind: "scanEdit",
        action: "split",
        positions,
        target,
      });
      expect(result.diagnostics.parts).toBe(2);
      expect(result.positions?.length).toBeGreaterThan(positions.length);
      expect(area(result.positions!)).toBeCloseTo(area(positions));
      expect(result.indexedMesh).toBeDefined();
    }
  });
  it("preserves unselected triangles exactly and responds to cancellation", () => {
    const positions = [-1, 0, 0, 1, 0, 0, 0, 2, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0];
    const result = runScanEdit({
      kind: "scanEdit",
      action: "split",
      positions,
      selection: new Uint8Array([1, 0]),
      plane: { origin: [0, 0, 0], normal: [1, 0, 0] },
    });
    expect([...result.segments![1].slice(-9)]).toEqual(positions.slice(-9));
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      runScanEdit(
        { kind: "scanEdit", action: "inventory", positions },
        { signal: controller.signal },
      ),
    ).toThrow("cancelled");
  });
});
