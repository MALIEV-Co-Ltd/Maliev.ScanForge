import { expect, it } from "vitest";
import native from "./fixtures/noise-octree-query.json";
import { noiseTriangleDistance } from "../src/scan-noise-deviation";
import {
  queryNoiseOctree,
  type NoiseBounds,
  type NoiseQueryNode,
} from "../src/scan-noise-octree-query";

function bounds(values: number[]): NoiseBounds {
  if (values.length !== 6) throw new Error("Fixture requires six bounds");
  return [values[0], values[1], values[2], values[3], values[4], values[5]];
}

it("reproduces native octree signed winners on captured caller-built nodes", () => {
  const nodes: NoiseQueryNode[] = native.nodes.map((n) => ({
    bounds: bounds(n.bounds),
    center: n.center as [number, number, number],
    mode: n.mode,
    triangles: n.triangles,
    children: {},
  }));
  native.nodes.forEach((n, id) => {
    nodes[id].children = Object.fromEntries(
      Object.entries(n.children).map(([child, index]) => [child, nodes[index]]),
    );
  });
  const triangles = native.triangles.map((points) => ({
    bounds: bounds([
      ...[0, 1, 2].map((a) => Math.min(...points.map((p) => p[a]))),
      ...[0, 1, 2].map((a) => Math.max(...points.map((p) => p[a]))),
    ]),
  }));
  for (const sample of native.samples) {
    const hit = queryNoiseOctree(
      nodes[sample.tree],
      sample.p,
      sample.radius,
      triangles,
      (id, radius) => {
        const [a, b, c] = native.triangles[id];
        return noiseTriangleDistance(sample.p, a, b, c, radius);
      },
    );
    expect(hit?.triangle ?? null, sample.name).toBe(sample.winner);
    expect(hit?.distance ?? null, sample.name).toBe(sample.distance);
  }
  expect(native.samples).toHaveLength(33);
  expect(native.provenance.constructionParity).toBe(false);
});
