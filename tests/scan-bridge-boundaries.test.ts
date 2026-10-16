import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit, type ScanEditRequest } from "../src/scan-edit";
import { runHoleFill } from "../src/scan-edit-holes";
import { ShapeUtils, Vector2 } from "three";

function separatedSquares() {
  const positions = [0, 3].flatMap((x) => [
    x,
    0,
    0,
    x + 1,
    0,
    0,
    x + 1,
    1,
    0,
    x,
    0,
    0,
    x + 1,
    1,
    0,
    x,
    1,
    0,
  ]);
  const topology = analyzeMesh(positions);
  const edge = (boundary: number, x: number) =>
    topology.boundaryLoops[boundary].findIndex(
      (id, i, loop) =>
        topology.vertices[id * 3] === x &&
        topology.vertices[loop[(i + 1) % loop.length] * 3] === x,
    );
  const request: ScanEditRequest = {
    kind: "scanEdit",
    action: "fillHoles",
    mode: "bridge",
    algorithm: "automatic",
    positions,
    indices: [0],
    endBoundary: 1,
    start: edge(0, 1),
    end: edge(1, 3),
  };
  return { positions, topology, request };
}

it("rejects unrelated coplanar geometry pinching the free bridge rail", () => {
  const { positions, request } = separatedSquares();
  positions.push(2, 0, 0, 1.5, -1, 0, 2.5, -1, 0);
  expect(() => runScanEdit(request)).toThrow(/intersect|retained/i);
});

it.each(["automatic", "flat", "tangent", "curvature"] as const)(
  "rejects a %s bridge penetrating a perpendicular retained wall",
  (algorithm) => {
    const { positions, request } = separatedSquares();
    positions.push(
      2,
      -0.5,
      -1,
      2,
      1.5,
      -1,
      2,
      1.5,
      1,
      2,
      -0.5,
      -1,
      2,
      1.5,
      1,
      2,
      -0.5,
      1,
    );
    const original = [...positions];
    expect(() => runScanEdit({ ...request, algorithm })).toThrow(
      /intersect|penetrat|retained/i,
    );
    expect(positions).toEqual(original);
  },
);

it.each(["automatic", "tangent", "curvature"] as const)(
  "checks the final %s refined strip against a retained surface above the initial flat patch",
  (algorithm) => {
    const { positions, request } = separatedSquares();
    for (let i = 0; i < positions.length; i += 3)
      positions[i + 2] =
        positions[i] <= 1
          ? 0.5 * (positions[i] - 1)
          : -0.5 * (positions[i] - 3);
    positions.push(
      1.5,
      -0.5,
      0.2,
      2.5,
      -0.5,
      0.2,
      2.5,
      1.5,
      0.2,
      1.5,
      -0.5,
      0.2,
      2.5,
      1.5,
      0.2,
      1.5,
      1.5,
      0.2,
    );
    expect(() => runScanEdit({ ...request, algorithm })).toThrow(
      /intersect|penetrat|retained/i,
    );
  },
);

it("bridges two independent scan boundaries without capping either scan", () => {
  const { positions, request } = separatedSquares();
  const result = runScanEdit(request);
  expect(result.diagnostics).toMatchObject({
    addedTriangles: 2,
    filledHoles: 1,
    method: "flat",
  });
  expect(result.positions!.slice(0, positions.length)).toEqual(
    new Float32Array(positions),
  );
  const after = analyzeMesh(result.positions!);
  expect(after.components).toHaveLength(1);
  expect(after.boundaryLoops).toHaveLength(1);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.duplicateTriangles +
      after.degenerateTriangles,
  ).toBe(0);
});

it("accepts exposed edges in open inventory chains and does not wrap the final vertex", () => {
  const { topology, request } = separatedSquares();
  topology.boundaryChains = topology.boundaryLoops.map((loop) => [
    ...loop,
    loop[0],
  ]);
  topology.boundaryLoops = [];
  const result = runHoleFill(request, topology, {});
  expect(result.diagnostics.addedTriangles).toBe(2);
  expect(() =>
    runHoleFill(
      { ...request, end: topology.boundaryChains[1].length - 1 },
      topology,
      {},
    ),
  ).toThrow(/edge index/i);
});

it("bridges real fragmented scan chains without an unrelated nonmanifold-edge defect blocking it", () => {
  const { positions } = separatedSquares();
  positions.push(0, 0, 0, 1, 0, 0, 0.5, -1, 0, 1, 0, 0, 0, 0, 0, 0.5, -2, 0);
  const before = analyzeMesh(positions);
  expect(before.nonManifoldEdges).toBe(1);
  expect(before.boundaryChains.length).toBeGreaterThan(0);
  const boundaries = [...before.boundaryLoops, ...before.boundaryChains];
  const findEdge = (x: number) => {
    for (const [boundary, ids] of boundaries.entries()) {
      const closed = boundary < before.boundaryLoops.length;
      for (let edge = 0; edge < ids.length - (closed ? 0 : 1); edge++)
        if (
          before.vertices[ids[edge] * 3] === x &&
          before.vertices[ids[(edge + 1) % ids.length] * 3] === x
        )
          return { boundary, edge };
    }
    throw new Error("Missing fixture edge");
  };
  const start = findEdge(1),
    end = findEdge(3);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    mode: "bridge",
    indices: [start.boundary],
    start: start.edge,
    endBoundary: end.boundary,
    end: end.edge,
  });
  expect(result.diagnostics.addedTriangles).toBe(2);
  const after = analyzeMesh(result.positions!);
  expect(after.nonManifoldEdges).toBe(before.nonManifoldEdges);
  expect(after.inconsistentEdges).toBe(before.inconsistentEdges);
  expect(after.duplicateTriangles + after.degenerateTriangles).toBe(0);
});

it("requires one start boundary and rejects invalid destination references and shared edges", () => {
  const { request } = separatedSquares();
  expect(() => runScanEdit({ ...request, indices: [0, 1] })).toThrow(
    /one start boundary/i,
  );
  expect(() => runScanEdit({ ...request, endBoundary: 100 })).toThrow(
    /boundary/i,
  );
  expect(() =>
    runScanEdit({ ...request, endBoundary: 0, end: request.start }),
  ).toThrow(/separate/i);
});

it("rejects a bridge drawn through the retained coplanar scan surface", () => {
  const { request } = separatedSquares();
  expect(() =>
    runScanEdit({ ...request, start: (request.start! + 2) % 4 }),
  ).toThrow(/bridge/i);
});

it("bridges a concave outer scan boundary across its open notch rather than requiring a hole", () => {
  const polygon = [
    [0, 0],
    [4, 0],
    [4, 4],
    [3, 4],
    [3, 3],
    [3, 2],
    [3, 1],
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4],
    [0, 4],
  ];
  const positions = ShapeUtils.triangulateShape(
    polygon.map(([x, y]) => new Vector2(x, y)),
    [],
  ).flatMap((face) => face.flatMap((id) => [...polygon[id], 0]));
  const topology = analyzeMesh(positions),
    loop = topology.boundaryLoops[0];
  const edgeAt = (x: number) =>
    loop.findIndex((id, i) => {
      const next = loop[(i + 1) % loop.length];
      return (
        topology.vertices[id * 3] === x &&
        topology.vertices[next * 3] === x &&
        Math.min(
          topology.vertices[id * 3 + 1],
          topology.vertices[next * 3 + 1],
        ) === 2
      );
    });
  const result = runScanEdit({
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    indices: [0],
    mode: "bridge",
    start: edgeAt(1),
    end: edgeAt(3),
  });
  expect(result.diagnostics.addedTriangles).toBe(2);
  const after = analyzeMesh(result.positions!);
  expect(after.boundaryLoops).toHaveLength(2);
  expect(
    after.nonManifoldEdges +
      after.inconsistentEdges +
      after.duplicateTriangles +
      after.degenerateTriangles,
  ).toBe(0);
});
