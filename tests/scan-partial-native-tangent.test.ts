import { expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import type { MeshProcessingOptions } from "../src/mesh-processing";
import { runScanEdit, type ScanEditRequest } from "../src/scan-edit";
import { computeAngleWeightedNormals } from "../src/scan-defeature-repatch";
import { partialTangentRim } from "../src/scan-hole-partial-tangent";
import fixture from "./fixtures/hole-observed-semi-tangent-curved.json";

function orientedFaces(positions: ArrayLike<number>) {
  const faces: string[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map((offset) =>
      [0, 1, 2].map((axis) => positions[i + offset + axis]).join(","),
    );
    faces.push(
      [0, 1, 2]
        .map((n) => [...vertices.slice(n), ...vertices.slice(0, n)].join(";"))
        .sort()[0],
    );
  }
  return faces.sort();
}

it("reconstructs the observed chord from source normals and cubic Hermite sampling", () => {
  const topology = analyzeMesh(Float32Array.from(fixture.source), {
    tolerance: fixture.tolerance,
  });
  const normals = computeAngleWeightedNormals(topology);
  const chord = fixture.selectionEvidence.chordVertices;
  const [a, b] = [chord[0], chord[chord.length - 1]];
  const find = (p: number[]) => {
    for (let i = 0; i < topology.vertices.length; i += 3)
      if (p.every((v, k) => topology.vertices[i + k] === v)) return i / 3;
    throw Error("Missing captured endpoint");
  };
  const delta = b.map((v, k) => v - a[k]);
  const length = Math.hypot(...delta);
  const tangent = (p: number[]) => {
    const i = find(p) * 3,
      n = [normals[i], normals[i + 1], normals[i + 2]];
    const dot = delta.reduce((s, v, k) => s + v * n[k], 0);
    const projected = delta.map((v, k) => v - dot * n[k]);
    const norm = Math.hypot(...projected);
    return projected.map((v) => (v * length) / norm);
  };
  const ta = tangent(a),
    tb = tangent(b);
  for (let i = 1; i < chord.length - 1; i++) {
    const t = i / (chord.length - 1),
      h00 = 2 * t ** 3 - 3 * t * t + 1,
      h10 = t ** 3 - 2 * t * t + t,
      h01 = -2 * t ** 3 + 3 * t * t,
      h11 = t ** 3 - t * t;
    for (let k = 0; k < 3; k++)
      expect(
        Math.abs(
          h00 * a[k] + h10 * ta[k] + h01 * b[k] + h11 * tb[k] - chord[i][k],
        ),
      ).toBeLessThan(0.00001);
  }
});

it("matches the native curved-annulus partial Tangent result for its captured chord", () => {
  const positions = Float32Array.from(fixture.source);
  const topology = analyzeMesh(positions, { tolerance: fixture.tolerance });
  const target = (id: number, sign: number) =>
    Math.abs(topology.vertices[id * 3] - sign * 2.12132025) < 0.00001 &&
    Math.abs(topology.vertices[id * 3 + 1] - sign * 2.12132025) < 0.00001;
  const boundary = topology.boundaryLoops.findIndex(
    (loop) =>
      loop.some((id) => target(id, -1)) && loop.some((id) => target(id, 1)),
  );
  expect(boundary).toBeGreaterThanOrEqual(0);
  const loop = topology.boundaryLoops[boundary];
  const start = loop.findIndex((id) => target(id, -1));
  const end = loop.findIndex((id) => target(id, 1));
  const native = orientedFaces(fixture.native);
  const results = [
    [start, end],
    [end, start],
  ].map(([a, b]) => {
    const request: ScanEditRequest = {
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      mode: "partial",
      algorithm: "tangent",
      indices: [boundary],
      start: a,
      end: b,
      tolerance: fixture.tolerance,
    };
    const output = runScanEdit(request).positions!;
    const topologyCache: NonNullable<MeshProcessingOptions["topologyCache"]> =
      {};
    const cached = runScanEdit(request, { topologyCache }).positions!;
    expect(orientedFaces(cached)).toEqual(orientedFaces(output));
    const fresh = analyzeMesh(cached, { tolerance: fixture.tolerance });
    expect(topologyCache.topology!.triangles.length).toBe(
      fresh.triangles.length,
    );
    expect(topologyCache.topology!.boundaryEdges).toBe(fresh.boundaryEdges);
    expect(topologyCache.topology!.nonManifoldEdges).toBe(
      fresh.nonManifoldEdges,
    );
    return {
      facets: output.length / 9,
      matches: JSON.stringify(orientedFaces(output)) === JSON.stringify(native),
    };
  });
  expect(results).toContainEqual({
    facets: fixture.nativeTriangles,
    matches: true,
  });
});

it("rejects a partial Tangent patch that intersects an unrelated face without changing the source", () => {
  const sourceFaces = new Set(orientedFaces(fixture.source));
  let face: number[] | undefined;
  for (let i = 0; i < fixture.native.length; i += 9) {
    const candidate = fixture.native.slice(i, i + 9);
    if (!sourceFaces.has(orientedFaces(candidate)[0])) {
      face = candidate;
      break;
    }
  }
  expect(face).toBeDefined();
  const p = face!;
  const center = [0, 1, 2].map((k) => (p[k] + p[3 + k] + p[6 + k]) / 3);
  const u = [0, 1, 2].map((k) => p[3 + k] - p[k]);
  const v = [0, 1, 2].map((k) => p[6 + k] - p[k]);
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const len = Math.hypot(...normal);
  const obstacle = [
    center.map((x, k) => x + normal[k] / len),
    center.map((x, k) => x - normal[k] / len),
    center.map((x, k) => x + u[k] * 0.1),
  ].flat();
  const positions = Float32Array.from([...fixture.source, ...obstacle]);
  const before = positions.slice();
  const topology = analyzeMesh(positions, { tolerance: fixture.tolerance });
  const target = (id: number, sign: number) =>
    Math.abs(topology.vertices[id * 3] - sign * 2.12132025) < 0.00001 &&
    Math.abs(topology.vertices[id * 3 + 1] - sign * 2.12132025) < 0.00001;
  const boundary = topology.boundaryLoops.findIndex(
    (loop) =>
      loop.some((id) => target(id, 1)) && loop.some((id) => target(id, -1)),
  );
  const loop = topology.boundaryLoops[boundary];
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      mode: "partial",
      algorithm: "tangent",
      indices: [boundary],
      start: loop.findIndex((id) => target(id, 1)),
      end: loop.findIndex((id) => target(id, -1)),
      tolerance: fixture.tolerance,
    }),
  ).toThrow(/intersect/i);
  expect(positions).toEqual(before);
});

it("rejects a synthetic chord vertex within weld tolerance of unrelated geometry", () => {
  const p = fixture.selectionEvidence.chordVertices[5];
  const obstacle = [
    p[0],
    p[1],
    p[2] + 0.0005,
    p[0],
    p[1],
    p[2] + 0.3,
    p[0] + 0.3,
    p[1],
    p[2] + 0.3,
  ];
  const positions = Float32Array.from([...fixture.source, ...obstacle]);
  const before = positions.slice();
  const topology = analyzeMesh(positions, { tolerance: fixture.tolerance });
  const target = (id: number, sign: number) =>
    Math.abs(topology.vertices[id * 3] - sign * 2.12132025) < 0.00001 &&
    Math.abs(topology.vertices[id * 3 + 1] - sign * 2.12132025) < 0.00001;
  const boundary = topology.boundaryLoops.findIndex(
    (loop) =>
      loop.some((id) => target(id, 1)) && loop.some((id) => target(id, -1)),
  );
  const loop = topology.boundaryLoops[boundary];
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      mode: "partial",
      algorithm: "tangent",
      indices: [boundary],
      start: loop.findIndex((id) => target(id, 1)),
      end: loop.findIndex((id) => target(id, -1)),
      tolerance: fixture.tolerance,
    }),
  ).toThrow(/tolerance|intersect/i);
  expect(positions).toEqual(before);
});

it("retains both partial Tangent patches in a multi-boundary request and its cache", () => {
  const shifted = fixture.source.map((x, i) => (i % 3 === 0 ? x + 20 : x));
  const positions = Float32Array.from([...fixture.source, ...shifted]);
  const topology = analyzeMesh(positions, { tolerance: fixture.tolerance });
  const inner = topology.boundaryLoops
    .map((loop, index) => ({ loop, index }))
    .filter(
      ({ loop }) =>
        loop.length === 32 &&
        loop.every(
          (id) =>
            Math.abs(topology.vertices[id * 3 + 2] - 0.27000001072883606) <
            0.00001,
        ),
    );
  expect(inner).toHaveLength(2);
  const first = inner[0].loop;
  const centerX =
    first.reduce((sum, id) => sum + topology.vertices[id * 3], 0) /
    first.length;
  const find = (sign: number) =>
    first.findIndex(
      (id) =>
        Math.abs(topology.vertices[id * 3] - centerX - sign * 2.12132025) <
          0.00001 &&
        Math.abs(topology.vertices[id * 3 + 1] - sign * 2.12132025) < 0.00001,
    );
  const request: ScanEditRequest = {
    kind: "scanEdit",
    action: "fillHoles",
    positions,
    mode: "partial",
    algorithm: "tangent",
    indices: inner.map((x) => x.index),
    start: find(1),
    end: find(-1),
    tolerance: fixture.tolerance,
  };
  const cache: NonNullable<MeshProcessingOptions["topologyCache"]> = {};
  const result = runScanEdit(request, { topologyCache: cache });
  expect(result.diagnostics.filledHoles).toBe(2);
  const fresh = analyzeMesh(result.positions!, {
    tolerance: fixture.tolerance,
  });
  expect(cache.topology!.triangles.length).toBe(fresh.triangles.length);
  expect(cache.topology!.boundaryEdges).toBe(fresh.boundaryEdges);
  expect(cache.topology!.nonManifoldEdges).toBe(fresh.nonManifoldEdges);
});

it("rejects crossing partial patches within one multi-boundary request atomically", () => {
  const rotated = fixture.source.map((x, i) => (i % 3 === 0 ? x : -x));
  const positions = Float32Array.from([...fixture.source, ...rotated]);
  const before = positions.slice();
  const topology = analyzeMesh(positions, { tolerance: fixture.tolerance });
  const inner = topology.boundaryLoops
    .map((loop, index) => ({ loop, index }))
    .filter(
      ({ loop }) =>
        loop.length === 32 &&
        loop.every(
          (id) =>
            Math.abs(
              Math.abs(topology.vertices[id * 3 + 2]) - 0.27000001072883606,
            ) < 0.00001,
        ),
    );
  expect(inner).toHaveLength(2);
  const first = inner.find(
    ({ loop }) => topology.vertices[loop[0] * 3 + 2] > 0,
  )!.loop;
  const target = (sign: number) =>
    first.findIndex(
      (id) =>
        Math.abs(topology.vertices[id * 3] - sign * 2.12132025) < 0.00001 &&
        Math.abs(topology.vertices[id * 3 + 1] - sign * 2.12132025) < 0.00001,
    );
  const ordered = [...inner].sort(
    (a, b) =>
      topology.vertices[b.loop[0] * 3 + 2] -
      topology.vertices[a.loop[0] * 3 + 2],
  );
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      mode: "partial",
      algorithm: "tangent",
      indices: ordered.map((x) => x.index),
      start: target(1),
      end: target(-1),
      tolerance: fixture.tolerance,
    }),
  ).toThrow(/intersect|tolerance/i);
  expect(positions).toEqual(before);
});

it("constructs a partial tangent rim without enumerating all source edges", () => {
  const topology = analyzeMesh(Float32Array.from(fixture.source), {
    tolerance: fixture.tolerance,
  });
  const loop = topology.boundaryLoops.find(
    (ids) =>
      ids.length === 32 &&
      ids.every(
        (id) =>
          Math.abs(topology.vertices[id * 3 + 2] - 0.27000001072883606) <
          0.00001,
      ),
  )!;
  const edges = new Proxy(topology.edges, {
    get(target, property) {
      if (
        property === Symbol.iterator ||
        property === "entries" ||
        property === "forEach"
      )
        throw Error("Full edge enumeration is forbidden");
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = partialTangentRim(
    { ...topology, edges },
    loop.slice(0, 5),
    computeAngleWeightedNormals(topology),
  );
  expect(result.topology.edges.size).toBeLessThan(topology.edges.size);
  expect(result.rim.length).toBeGreaterThanOrEqual(5);
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let i = 0; i < 4; i++) {
    const id = key(loop[i], loop[i + 1]);
    expect(result.topology.edges.get(id)).toEqual(topology.edges.get(id));
  }
  for (let i = 4; i < result.rim.length; i++) {
    const from = result.rim[i],
      to = result.rim[(i + 1) % result.rim.length];
    expect(result.topology.edges.get(key(from, to))).toEqual([
      { face: -1, from, to },
    ]);
  }
});
