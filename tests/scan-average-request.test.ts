import { expect, it } from "vitest";
import { bindAverageMeshes } from "../src/scan-average-request";
import type { Entity } from "../src/types";

it("admits numeric carriers before transport and bounds unused indexed vertices", () => {
  const a = mesh("a", 1),
    b = mesh("b", 1);
  expect(() =>
    bindAverageMeshes(
      a,
      [b.id],
      [a, { ...b, positions: { length: 27_000_000 } as Float32Array }],
    ),
  ).toThrow(/limit/);
  expect(() =>
    bindAverageMeshes(
      a,
      [b.id],
      [
        a,
        {
          ...b,
          indexedMesh: {
            vertices: { length: 27_000_001 } as Float32Array,
            triangles: [0, 1, 2],
          },
        },
      ],
    ),
  ).toThrow(/Indexed reference/);
});

const mesh = (id: string, facets: number): Entity => ({
  id,
  name: id,
  kind: "mesh",
  visible: true,
  color: "#aaaaaa",
  opacity: 1,
  positions: new Float32Array(
    Array.from({ length: facets }, () => [0, 0, 0, 1, 0, 0, 0, 1, 0]).flat(),
  ),
});

it("chooses the greatest facet count, retaining scene order for ties and contributions", () => {
  const a = mesh("a", 2),
    b = mesh("b", 3),
    c = mesh("c", 3);
  const scene = [a, b, c];
  const bound = bindAverageMeshes(a, [c.id, b.id], scene);
  expect(bound.source).toBe(b);
  expect(bound.references).toEqual([a, c]);
  expect(scene).toEqual([a, b, c]);
});

it("rejects stale, repeated, self and non-mesh references", () => {
  const a = mesh("a", 1),
    b = mesh("b", 1);
  for (const ids of [[], ["missing"], [a.id], [b.id, b.id]])
    expect(() => bindAverageMeshes(a, ids, [a, b])).toThrow();
  expect(() =>
    bindAverageMeshes(a, [b.id], [a, { ...b, kernelId: "exact" }]),
  ).toThrow(/mesh/i);
});
