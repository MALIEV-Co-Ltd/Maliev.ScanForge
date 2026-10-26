import { expect, it } from "vitest";
import fixture from "./fixtures/bridge-observed-flat-annulus.json";
import shortFixture from "./fixtures/bridge-observed-flat-short-annulus.json";
import { runScanEdit } from "../src/scan-edit";
import { analyzeMesh } from "../src/mesh-processing";
import { refineFlatBridgeStrip } from "../src/scan-bridge-geometry";
import { Vector2 } from "three";

function orientedFaces(positions: ArrayLike<number>) {
  const faces: string[] = [];
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map((offset) =>
      [0, 1, 2].map((axis) => positions[i + offset + axis]).join(","),
    );
    faces.push(
      [0, 1, 2]
        .map((offset) =>
          [...vertices.slice(offset), ...vertices.slice(0, offset)].join(";"),
        )
        .sort()[0],
    );
  }
  return faces.sort();
}

it.each([fixture, shortFixture])(
  "matches native Flat Bridge with $nativeTriangles facets",
  (fixture) => {
    const source = Float32Array.from(fixture.source);
    const before = source.slice();
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: source,
      indices: [fixture.boundary],
      mode: "bridge",
      algorithm: "flat",
      start: fixture.start,
      end: fixture.end,
      tolerance: 0.001,
    });
    expect(source).toEqual(before);
    expect(result.positions!.slice(0, source.length)).toEqual(source);
    expect(result.positions).toHaveLength(fixture.nativeTriangles * 9);
    expect(orientedFaces(result.positions!)).toEqual(
      orientedFaces(fixture.native),
    );
    const topology = analyzeMesh(result.positions!, { tolerance: 0.001 });
    expect(topology.boundaryLoops).toHaveLength(3);
    expect(topology.nonManifoldEdges + topology.inconsistentEdges).toBe(0);
  },
);

it("cancels during Flat rail insertion without mutating the canonical scan", () => {
  const source = Float32Array.from(fixture.source),
    before = source.slice();
  const controller = new AbortController();
  expect(() =>
    runScanEdit(
      {
        kind: "scanEdit",
        action: "fillHoles",
        positions: source,
        mode: "bridge",
        algorithm: "flat",
        indices: [fixture.boundary],
        start: fixture.start,
        end: fixture.end,
        tolerance: 0.001,
      },
      {
        signal: controller.signal,
        onProgress: (_fraction, stage) => {
          if (stage === "Interpolating flat bridge rails") controller.abort();
        },
      },
    ),
  ).toThrow(/cancel/i);
  expect(controller.signal.aborted).toBe(true);
  expect(source).toEqual(before);
});

it("rejects excessive Flat rail density before allocating patch vertices", () => {
  const points: [number, number, number][] = [
    [0, 0, 0],
    [1e-8, 0, 0],
    [1e-8, 3, 0],
    [0, 3, 0],
  ];
  const projected = points.map(([x, y]) => new Vector2(x, y));
  expect(() => refineFlatBridgeStrip(points, projected, [0, 0, 1], {})).toThrow(
    /boundary size/,
  );
  expect(points).toHaveLength(4);
  expect(projected).toHaveLength(4);
});

it("rejects quadratic Flat clipping work before allocating a long narrow strip", () => {
  const points: [number, number, number][] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 2000, 0],
    [0, 2000, 0],
  ];
  const projected = points.map(([x, y]) => new Vector2(x, y));
  expect(() =>
    refineFlatBridgeStrip(points, projected, [0, 0, 1], {
      onProgress() {
        throw Error("Unexpected rail allocation before admission");
      },
    }),
  ).toThrow(/boundary size/);
  expect(points).toHaveLength(4);
});

it("does not reuse a retained diagonal as a new Flat bridge interior edge", () => {
  const a = [0, 0, 0],
    b = [3, 0, 0],
    c = [3, 2, 0],
    d = [0, 2, 0];
  const source = Float32Array.from(
    [b, a, [1, -1, 0], d, c, [1, 3, 0], b, d, [1, 1, 1]].flat(),
  );
  const before = source.slice(),
    topology = analyzeMesh(source);
  const paths = [...topology.boundaryLoops, ...topology.boundaryChains];
  const edge = (from: number[], to: number[]) => {
    for (const [boundary, path] of paths.entries()) {
      const count =
        path.length - (boundary < topology.boundaryLoops.length ? 0 : 1);
      for (let index = 0; index < count; index++) {
        const matches = (id: number, p: number[]) =>
          p.every((v, k) => topology.vertices[id * 3 + k] === v);
        const x = path[index],
          y = path[(index + 1) % path.length];
        if (
          (matches(x, from) && matches(y, to)) ||
          (matches(x, to) && matches(y, from))
        )
          return { boundary, index };
      }
    }
    throw Error("Missing retained attachment");
  };
  const start = edge(a, b),
    end = edge(c, d);
  expect(() =>
    runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions: source,
      mode: "bridge",
      algorithm: "flat",
      indices: [start.boundary],
      endBoundary: end.boundary,
      start: start.index,
      end: end.index,
    }),
  ).toThrow(/intersect|retained|triangulation/i);
  expect(source).toEqual(before);
  const after = analyzeMesh(source);
  expect(after.nonManifoldEdges).toBe(topology.nonManifoldEdges);
  expect(after.inconsistentEdges).toBe(topology.inconsistentEdges);
});
