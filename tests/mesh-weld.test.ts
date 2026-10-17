import { expect, it } from "vitest";
import { weldMeshPositions } from "../src/mesh-weld";

// Frozen pre-optimization 27-cell search. Its ordering is part of the contract.
function reference(p: ArrayLike<number>, tolerance: number) {
  const vertices: number[] = [],
    triangles = new Uint32Array(p.length / 3);
  const cells = new Map<string, number[]>();
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i],
      y = p[i + 1],
      z = p[i + 2];
    const cx = Math.floor((x - p[0]) / tolerance),
      cy = Math.floor((y - p[1]) / tolerance),
      cz = Math.floor((z - p[2]) / tolerance);
    let id = -1;
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const candidate of cells.get(
            `${cx + dx},${cy + dy},${cz + dz}`,
          ) ?? [])
            if (
              Math.hypot(
                vertices[candidate * 3] - x,
                vertices[candidate * 3 + 1] - y,
                vertices[candidate * 3 + 2] - z,
              ) <= tolerance
            ) {
              id = candidate;
              break search;
            }
    if (id < 0) {
      id = vertices.length / 3;
      vertices.push(x, y, z);
      const key = `${cx},${cy},${cz}`;
      const cell = cells.get(key);
      if (cell) cell.push(id);
      else cells.set(key, [id]);
    }
    triangles[i / 3] = id;
  }
  return { vertices: new Float64Array(vertices), triangles };
}

it("preserves representative and corner order across rehashes and nontransitive welds", () => {
  let seed = 37;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const tolerance of [0.001, 1e-6, 1, 1e-100, 1e100]) {
    const p: number[] = [];
    for (let i = 0; i < 6000; i++) {
      const v =
        i % 5 === 0
          ? [-0, 0, 0]
          : [0, 1, 2].map(
              () =>
                Math.floor(random() * 100) * tolerance +
                (random() - 0.5) * tolerance,
            );
      p.push(...v);
    }
    expect(weldMeshPositions(p, tolerance)).toEqual(reference(p, tolerance));
  }
});
it("retains all 53 bits of cell coordinates instead of aliasing 32-bit hashes", () => {
  const p = [
    0,
    0,
    0,
    2 ** 40,
    0,
    0,
    2 ** 40 + 0.5,
    0,
    0,
    -(2 ** 40),
    0,
    0,
    0,
    2 ** 40,
    0,
    0,
    0,
    2 ** 40,
  ];
  expect(weldMeshPositions(p, 1)).toEqual(reference(p, 1));
});
it("checks precision, coordinates, tolerance, and cancellation without mutating input", () => {
  const p = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const before = p.slice();
  expect(() => weldMeshPositions(p, 0)).toThrow(/tolerance/i);
  expect(() =>
    weldMeshPositions([0, 0, 0, Infinity, 0, 0, 0, 1, 0], 1),
  ).toThrow(/finite/i);
  expect(() => weldMeshPositions([0, 0, 0, 1e30, 0, 0, 0, 1, 0], 1)).toThrow(
    /precision/i,
  );
  expect(() =>
    weldMeshPositions(p, 1, () => {
      throw new Error("cancelled");
    }),
  ).toThrow("cancelled");
  expect(p).toEqual(before);
});
