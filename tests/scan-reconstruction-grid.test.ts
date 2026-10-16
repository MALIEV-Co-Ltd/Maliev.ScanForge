import { expect, it } from "vitest";
import { Triangle, Vector3, Line3 } from "three";
import {
  GridBits,
  closeReconstructionGrid,
  triangleDistanceSquared,
} from "../src/scan-reconstruction-grid";
import { analyzeMesh, sheetSummary } from "../src/mesh-processing";
import { verifyReconstructionTopology } from "../src/scan-reconstruction-topology";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";
it("matches independent closest-triangle distance including collapsed facets", () => {
  let seed = 31;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32) * 4 - 2;
  };
  for (let i = 0; i < 1200; i++) {
    const points = Array.from({ length: 9 }, random),
      p = new Vector3(random(), random(), random());
    if (i % 3 === 0) points.splice(3, 3, ...points.slice(0, 3));
    const triangle = new Triangle(
      new Vector3(...(points.slice(0, 3) as [number, number, number])),
      new Vector3(...(points.slice(3, 6) as [number, number, number])),
      new Vector3(...(points.slice(6, 9) as [number, number, number])),
    );
    const nearest =
      i % 3 === 0
        ? new Line3(triangle.a, triangle.c).closestPointToPoint(
            p,
            true,
            new Vector3(),
          )
        : triangle.closestPointToPoint(p, new Vector3());
    const distance = nearest.distanceToSquared(p);
    expect(triangleDistanceSquared(p.x, p.y, p.z, points, 0)).toBeCloseTo(
      distance,
      9,
    );
  }
});
it("bitsets preserve 31/32 boundaries and span flooding matches a dense reference", () => {
  let seed = 7;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let run = 0; run < 70; run++) {
    const dims = [7, 8, 9],
      total = 504,
      bits = new GridBits(total),
      occupied = new Uint8Array(total),
      outside = new Uint8Array(total),
      queue: number[] = [];
    for (let z = 1; z < 8; z++)
      for (let y = 1; y < 7; y++)
        for (let x = 1; x < 6; x++)
          if (random() < 0.6) {
            const id = x + y * 7 + z * 56;
            bits.set(id);
            occupied[id] = 1;
          }
    for (let id = 0; id < total; id++) expect(bits.get(id)).toBe(occupied[id]);
    outside[0] = 1;
    queue.push(0);
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head],
        x = id % 7,
        y = Math.floor(id / 7) % 8,
        z = Math.floor(id / 56);
      for (const next of [
        x ? id - 1 : -1,
        x < 6 ? id + 1 : -1,
        y ? id - 7 : -1,
        y < 7 ? id + 7 : -1,
        z ? id - 56 : -1,
        z < 8 ? id + 56 : -1,
      ])
        if (next >= 0 && !occupied[next] && !outside[next]) {
          outside[next] = 1;
          queue.push(next);
        }
    }
    const filled = closeReconstructionGrid(bits, dims, () => {});
    let expected = 0;
    for (let id = 0; id < total; id++) {
      expect(bits.get(id)).toBe(outside[id] ? 0 : 1);
      if (!outside[id] && !occupied[id]) expected++;
    }
    expect(filled).toBe(expected);
  }
});
it("typed verification agrees with the independent analyzer on reconstruction outputs", () => {
  for (let k = 1; k <= 9; k++) {
    const p = [0, 0, 0, 3, 0, 0, 0, 3, k / 2];
    const result = repolygonizeScanMesh(p, { resolution: 0.5 });
    expect(result.topology).toEqual(
      sheetSummary(analyzeMesh(result.positions)),
    );
  }
});
it("rejects winding errors, duplicates, open edges and disconnected vertex fans", () => {
  const tetra = [
    0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0,
    1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1,
  ];
  const verify = (p: number[]) =>
    verifyReconstructionTopology(
      Float32Array.from(p),
      [-2, -2, -2],
      [6, 6, 6],
      1,
      () => {},
    );
  expect(verify(tetra).watertight).toBe(true);
  expect(() => verify(tetra.slice(9))).toThrow(/boundary/);
  expect(() => verify([...tetra, ...tetra.slice(0, 9)])).toThrow(/nonmanifold/);
  const reversed = [...tetra];
  reversed.splice(
    0,
    9,
    ...tetra.slice(0, 3),
    ...tetra.slice(6, 9),
    ...tetra.slice(3, 6),
  );
  expect(() => verify(reversed)).toThrow(/winding/);
  expect(() => verify([...tetra, ...tetra.map((v) => -v)])).toThrow(
    /vertices=/,
  );
});
